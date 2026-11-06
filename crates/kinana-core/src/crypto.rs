use aes_gcm::{
    aead::{Aead, KeyInit, Payload},
    Aes256Gcm, Nonce,
};
use argon2::{Algorithm, Argon2, Params, Version};
use rand::{rngs::OsRng, RngCore};
use zeroize::Zeroizing;

use crate::error::VaultError;

pub const MAGIC_BYTES: &[u8; 8] = b"PORTVLT1";
pub const CURRENT_VERSION: u16 = 1;
pub const HEADER_SIZE: usize = 8 + 2 + 4 + 4 + 4 + 32 + 12; // 66 bytes
pub const TAG_SIZE: usize = 16;
pub const MIN_VAULT_FILE_SIZE: usize = HEADER_SIZE + TAG_SIZE; // 82 bytes (header + minimum auth tag)

// Defensive parameter bounds to prevent DoS / Memory Exhaustion attacks from tampered headers
pub const MIN_M_COST: u32 = 16 * 1024;   // 16 MiB
pub const MAX_M_COST: u32 = 512 * 1024;  // 512 MiB
pub const MIN_T_COST: u32 = 1;           // 1 iteration
pub const MAX_T_COST: u32 = 10;          // 10 iterations
pub const MIN_P_COST: u32 = 1;           // 1 thread
pub const MAX_P_COST: u32 = 16;          // 16 threads

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Argon2Parameters {
    pub m_cost: u32,
    pub t_cost: u32,
    pub p_cost: u32,
}

impl Default for Argon2Parameters {
    fn default() -> Self {
        // High-security desktop default: 64 MiB, 3 iterations, 4 threads
        Self {
            m_cost: 64 * 1024,
            t_cost: 3,
            p_cost: 4,
        }
    }
}

impl Argon2Parameters {
    pub fn validate(&self) -> Result<(), VaultError> {
        if self.m_cost < MIN_M_COST || self.m_cost > MAX_M_COST {
            return Err(VaultError::InvalidArgon2Parameters(format!(
                "m_cost {} KiB is outside acceptable bounds [{}..={}]",
                self.m_cost, MIN_M_COST, MAX_M_COST
            )));
        }
        if self.t_cost < MIN_T_COST || self.t_cost > MAX_T_COST {
            return Err(VaultError::InvalidArgon2Parameters(format!(
                "t_cost {} is outside acceptable bounds [{}..={}]",
                self.t_cost, MIN_T_COST, MAX_T_COST
            )));
        }
        if self.p_cost < MIN_P_COST || self.p_cost > MAX_P_COST {
            return Err(VaultError::InvalidArgon2Parameters(format!(
                "p_cost {} is outside acceptable bounds [{}..={}]",
                self.p_cost, MIN_P_COST, MAX_P_COST
            )));
        }
        Ok(())
    }
}

/// The binary header of a vault file.
/// Contains metadata, Argon2 parameters, Salt, and Nonce.
/// Note: The entire header is passed as AAD (Additional Authenticated Data) to AES-256-GCM.
#[derive(Debug)]
pub struct VaultHeader {
    pub magic: [u8; 8],
    pub version: u16,
    pub argon2_params: Argon2Parameters,
    pub salt: [u8; 32],
    pub nonce: [u8; 12],
}

impl VaultHeader {
    /// Create a new header for a new vault with a fresh salt and fresh nonce from OsRng
    pub fn new_with_fresh_salts(argon2_params: Argon2Parameters) -> Result<Self, VaultError> {
        argon2_params.validate()?;

        let mut salt = [0u8; 32];
        let mut nonce = [0u8; 12];
        OsRng.fill_bytes(&mut salt);
        OsRng.fill_bytes(&mut nonce);

        Ok(Self {
            magic: *MAGIC_BYTES,
            version: CURRENT_VERSION,
            argon2_params,
            salt,
            nonce,
        })
    }

    /// Refresh the nonce using OsRng for each save operation (mandatory rule: never reuse nonce)
    pub fn refresh_nonce(&mut self) {
        OsRng.fill_bytes(&mut self.nonce);
    }

    /// Serialize header to 66 bytes binary format
    pub fn to_bytes(&self) -> [u8; HEADER_SIZE] {
        let mut buf = [0u8; HEADER_SIZE];
        buf[0..8].copy_from_slice(&self.magic);
        buf[8..10].copy_from_slice(&self.version.to_be_bytes());
        buf[10..14].copy_from_slice(&self.argon2_params.m_cost.to_be_bytes());
        buf[14..18].copy_from_slice(&self.argon2_params.t_cost.to_be_bytes());
        buf[18..22].copy_from_slice(&self.argon2_params.p_cost.to_be_bytes());
        buf[22..54].copy_from_slice(&self.salt);
        buf[54..66].copy_from_slice(&self.nonce);
        buf
    }

    /// Parse and validate header from raw bytes.
    /// Strictly rejects invalid magic, unsupported version, or out-of-bounds Argon2 params
    /// BEFORE any key derivation or memory allocation occurs.
    pub fn from_bytes(bytes: &[u8]) -> Result<Self, VaultError> {
        if bytes.len() < HEADER_SIZE {
            return Err(VaultError::FileTooShort(bytes.len(), MIN_VAULT_FILE_SIZE));
        }

        let mut magic = [0u8; 8];
        magic.copy_from_slice(&bytes[0..8]);
        if &magic != MAGIC_BYTES {
            return Err(VaultError::InvalidMagic(magic.to_vec()));
        }

        let version = u16::from_be_bytes([bytes[8], bytes[9]]);
        if version != CURRENT_VERSION {
            return Err(VaultError::UnsupportedVersion(version));
        }

        let m_cost = u32::from_be_bytes([bytes[10], bytes[11], bytes[12], bytes[13]]);
        let t_cost = u32::from_be_bytes([bytes[14], bytes[15], bytes[16], bytes[17]]);
        let p_cost = u32::from_be_bytes([bytes[18], bytes[19], bytes[20], bytes[21]]);

        let params = Argon2Parameters {
            m_cost,
            t_cost,
            p_cost,
        };
        params.validate()?;

        let mut salt = [0u8; 32];
        salt.copy_from_slice(&bytes[22..54]);

        let mut nonce = [0u8; 12];
        nonce.copy_from_slice(&bytes[54..66]);

        Ok(Self {
            magic,
            version,
            argon2_params: params,
            salt,
            nonce,
        })
    }
}

/// A 256-bit derived cryptographic key.
/// Security guarantees:
/// 1. ZeroizeOnDrop: Key bytes are wiped from memory via volatile write on drop.
/// 2. Non-Cloneable: Explicitly DOES NOT implement Clone or Copy to prevent memory duplication.
pub struct DerivedKey(Zeroizing<[u8; 32]>);

impl DerivedKey {
    pub fn new(key: [u8; 32]) -> Self {
        Self(Zeroizing::new(key))
    }

    pub fn as_bytes(&self) -> &[u8; 32] {
        &self.0
    }
}

impl std::fmt::Debug for DerivedKey {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "DerivedKey(***REDACTED***)")
    }
}

use unicode_normalization::UnicodeNormalization;

/// Derive a 256-bit encryption key using Argon2id with strict memory zeroization on drop.
/// Normalizes the master password using Unicode NFKC to ensure identical key derivation across platforms.
/// Returns a non-cloneable DerivedKey.
pub fn derive_key(
    password: &str,
    salt: &[u8; 32],
    params: &Argon2Parameters,
) -> Result<DerivedKey, VaultError> {
    if password.is_empty() {
        return Err(VaultError::EmptyPassword);
    }
    params.validate()?;

    // Unicode NFKC normalization (Compatibility Decomposition + Canonical Composition)
    let normalized_pwd: Zeroizing<String> = Zeroizing::new(password.nfkc().collect());

    let argon2_params = Params::new(
        params.m_cost,
        params.t_cost,
        params.p_cost,
        Some(32), // 256-bit key output
    )
    .map_err(|e| VaultError::InvalidArgon2Parameters(e.to_string()))?;

    let argon2 = Argon2::new(Algorithm::Argon2id, Version::V0x13, argon2_params);

    let mut key_bytes = Zeroizing::new([0u8; 32]);
    argon2
        .hash_password_into(normalized_pwd.as_bytes(), salt, key_bytes.as_mut())
        .map_err(|_| VaultError::DecryptionFailed)?;

    Ok(DerivedKey(key_bytes))
}

/// Encrypt plaintext using AES-256-GCM.
/// The entire 66-byte header is authenticated via AAD (Associated Authenticated Data).
pub fn encrypt_payload(
    plaintext: &[u8],
    key: &DerivedKey,
    header: &VaultHeader,
) -> Result<Vec<u8>, VaultError> {
    let cipher = Aes256Gcm::new_from_slice(key.as_bytes())
        .map_err(|_| VaultError::DecryptionFailed)?;

    let nonce = Nonce::from_slice(&header.nonce);
    let header_bytes = header.to_bytes();

    let payload = Payload {
        msg: plaintext,
        aad: &header_bytes,
    };

    let ciphertext = cipher
        .encrypt(nonce, payload)
        .map_err(|_| VaultError::DecryptionFailed)?;

    let mut complete_file = Vec::with_capacity(HEADER_SIZE + ciphertext.len());
    complete_file.extend_from_slice(&header_bytes);
    complete_file.extend_from_slice(&ciphertext);

    Ok(complete_file)
}

/// Decrypt raw vault file bytes using AES-256-GCM.
/// Strictly verifies that the header matches the AAD and that the ciphertext authentication tag is valid.
pub fn decrypt_payload(
    raw_file_bytes: &[u8],
    key: &DerivedKey,
) -> Result<(VaultHeader, Zeroizing<Vec<u8>>), VaultError> {
    if raw_file_bytes.len() < MIN_VAULT_FILE_SIZE {
        return Err(VaultError::FileTooShort(
            raw_file_bytes.len(),
            MIN_VAULT_FILE_SIZE,
        ));
    }

    let header = VaultHeader::from_bytes(&raw_file_bytes[0..HEADER_SIZE])?;
    let header_bytes = header.to_bytes();
    let ciphertext = &raw_file_bytes[HEADER_SIZE..];

    let cipher = Aes256Gcm::new_from_slice(key.as_bytes())
        .map_err(|_| VaultError::DecryptionFailed)?;

    let nonce = Nonce::from_slice(&header.nonce);
    let payload = Payload {
        msg: ciphertext,
        aad: &header_bytes,
    };

    let decrypted_bytes = cipher
        .decrypt(nonce, payload)
        .map_err(|_| VaultError::DecryptionFailed)?;

    // Wrap plaintext in Zeroizing to clean memory automatically on drop
    Ok((header, Zeroizing::new(decrypted_bytes)))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_derive_key_empty_password_fails() {
        let salt = [0u8; 32];
        let params = Argon2Parameters::default();
        let res = derive_key("", &salt, &params);
        assert!(matches!(res, Err(VaultError::EmptyPassword)));
    }

    #[test]
    fn test_derive_key_deterministic() {
        let salt = [42u8; 32];
        let params = Argon2Parameters {
            m_cost: 16 * 1024,
            t_cost: 1,
            p_cost: 1,
        };
        let key1 = derive_key("master_password_123", &salt, &params).unwrap();
        let key2 = derive_key("master_password_123", &salt, &params).unwrap();
        assert_eq!(key1.as_bytes(), key2.as_bytes());
    }

    #[test]
    fn test_derive_key_nfkc_normalization() {
        let salt = [77u8; 32];
        let params = Argon2Parameters {
            m_cost: 16 * 1024,
            t_cost: 1,
            p_cost: 1,
        };
        // "\u{FB01}" is the single Unicode ligature 'ﬁ'
        // "file" uses standard ASCII 'f' + 'i'
        let key_ligature = derive_key("\u{FB01}le", &salt, &params).unwrap();
        let key_decomposed = derive_key("file", &salt, &params).unwrap();
        assert_eq!(key_ligature.as_bytes(), key_decomposed.as_bytes());
    }

    #[test]
    fn test_encrypt_decrypt_roundtrip() {
        let params = Argon2Parameters {
            m_cost: 16 * 1024,
            t_cost: 1,
            p_cost: 1,
        };
        let header = VaultHeader::new_with_fresh_salts(params).unwrap();
        let key = derive_key("roundtrip_password", &header.salt, &params).unwrap();
        let plaintext = b"Strict secret data inside vault payload!";

        let encrypted = encrypt_payload(plaintext, &key, &header).unwrap();
        let (dec_header, decrypted) = decrypt_payload(&encrypted, &key).unwrap();

        assert_eq!(dec_header.magic, header.magic);
        assert_eq!(dec_header.salt, header.salt);
        assert_eq!(dec_header.nonce, header.nonce);
        assert_eq!(&decrypted[..], plaintext);
    }

    #[test]
    fn test_decrypt_payload_wrong_key_fails() {
        let params = Argon2Parameters {
            m_cost: 16 * 1024,
            t_cost: 1,
            p_cost: 1,
        };
        let header = VaultHeader::new_with_fresh_salts(params).unwrap();
        let correct_key = derive_key("correct_password", &header.salt, &params).unwrap();
        let wrong_key = derive_key("wrong_password", &header.salt, &params).unwrap();

        let encrypted = encrypt_payload(b"secret", &correct_key, &header).unwrap();
        let res = decrypt_payload(&encrypted, &wrong_key);

        assert!(matches!(res, Err(VaultError::DecryptionFailed)));
    }

    #[test]
    fn test_decrypt_payload_tampered_aad_fails() {
        let params = Argon2Parameters {
            m_cost: 16 * 1024,
            t_cost: 1,
            p_cost: 1,
        };
        let header = VaultHeader::new_with_fresh_salts(params).unwrap();
        let key = derive_key("authenticated_data_password", &header.salt, &params).unwrap();

        let mut encrypted = encrypt_payload(b"secret payload", &key, &header).unwrap();

        // Alter a valid byte in the header part (byte 25 is within salt [22..54])
        // This keeps the header parseable by from_bytes, but alters the AAD supplied to AES-256-GCM
        encrypted[25] ^= 0x01;

        let res = decrypt_payload(&encrypted, &key);
        assert!(matches!(res, Err(VaultError::DecryptionFailed)));
    }

    #[test]
    fn test_header_from_bytes_invalid_magic() {
        let params = Argon2Parameters::default();
        let header = VaultHeader::new_with_fresh_salts(params).unwrap();
        let mut bytes = header.to_bytes();
        bytes[0] = b'B';
        bytes[1] = b'A';
        bytes[2] = b'D';

        let res = VaultHeader::from_bytes(&bytes);
        assert!(matches!(res, Err(VaultError::InvalidMagic(_))));
    }

    #[test]
    fn test_header_from_bytes_excessive_m_cost_rejected() {
        let params = Argon2Parameters::default();
        let header = VaultHeader::new_with_fresh_salts(params).unwrap();
        let mut bytes = header.to_bytes();

        // 10 GiB in KiB is 10 * 1024 * 1024 = 10,485,760 KiB (far exceeds MAX_M_COST = 524,288)
        let huge_m_cost: u32 = 10 * 1024 * 1024;
        bytes[10..14].copy_from_slice(&huge_m_cost.to_be_bytes());

        let res = VaultHeader::from_bytes(&bytes);
        assert!(matches!(res, Err(VaultError::InvalidArgon2Parameters(_))));

        // Also test with u32::MAX
        bytes[10..14].copy_from_slice(&u32::MAX.to_be_bytes());
        let res_max = VaultHeader::from_bytes(&bytes);
        assert!(matches!(res_max, Err(VaultError::InvalidArgon2Parameters(_))));
    }
}
