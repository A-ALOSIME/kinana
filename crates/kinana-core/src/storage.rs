use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::thread;
use std::time::Duration;
use zeroize::Zeroizing;

use crate::crypto::{
    decrypt_payload, derive_key, encrypt_payload, Argon2Parameters, DerivedKey, VaultHeader,
};
use crate::error::VaultError;
use crate::models::VaultData;

/// An active authenticated in-memory session.
/// Holds the derived key, vault header, and decrypted vault data.
/// Strictly non-cloneable.
#[derive(Debug)]
pub struct VaultSession {
    pub key: DerivedKey,
    pub header: VaultHeader,
    pub data: VaultData,
}

impl VaultSession {
    pub fn new(key: DerivedKey, header: VaultHeader, data: VaultData) -> Self {
        Self { key, header, data }
    }
}

pub struct VaultStorage {
    vault_path: PathBuf,
    backup_path: PathBuf,
    tmp_path: PathBuf,
}

impl VaultStorage {
    pub fn new(vault_path: impl AsRef<Path>) -> Self {
        let vault_path = vault_path.as_ref().to_path_buf();
        let backup_path = vault_path.with_extension("dat.bak");
        let tmp_path = vault_path.with_extension("dat.tmp");

        Self {
            vault_path,
            backup_path,
            tmp_path,
        }
    }

    pub fn vault_path(&self) -> &Path {
        &self.vault_path
    }

    pub fn backup_path(&self) -> &Path {
        &self.backup_path
    }

    pub fn exists(&self) -> bool {
        self.vault_path.exists()
    }

    /// Initializes a brand new vault and returns an authenticated VaultSession.
    /// Fails if a vault already exists at vault_path (preventing accidental clobbering).
    pub fn create_new_vault(
        &self,
        master_password: &str,
        preferred_params: Option<Argon2Parameters>,
    ) -> Result<VaultSession, VaultError> {
        if self.vault_path.exists() {
            return Err(VaultError::ExistingVaultCorrupted(
                "A vault file already exists at this path. Use unlock instead.".to_string(),
            ));
        }

        let header = VaultHeader::new_with_fresh_salts(preferred_params.unwrap_or_default())?;
        let key = derive_key(master_password, &header.salt, &header.argon2_params)?;

        let session = VaultSession::new(key, header, VaultData::default());
        Ok(session)
    }

    /// Unlocks an existing vault from disk using the master password.
    /// Strictly verifies:
    /// 1. File existence and minimum size.
    /// 2. Header magic, version, and Argon2 parameter bounds.
    /// 3. AES-256-GCM authentication tag and AAD match.
    /// Returns an authenticated VaultSession holding the key, header, and data.
    pub fn unlock(&self, master_password: &str) -> Result<VaultSession, VaultError> {
        if master_password.is_empty() {
            return Err(VaultError::EmptyPassword);
        }

        if !self.vault_path.exists() {
            return Err(VaultError::FileNotFound(
                self.vault_path.to_string_lossy().to_string(),
            ));
        }

        let file_bytes = fs::read(&self.vault_path)?;
        if file_bytes.len() < crate::crypto::MIN_VAULT_FILE_SIZE {
            return Err(VaultError::FileTooShort(
                file_bytes.len(),
                crate::crypto::MIN_VAULT_FILE_SIZE,
            ));
        }

        // Parse header and validate bounds BEFORE key derivation
        let header = VaultHeader::from_bytes(&file_bytes)?;
        let key = derive_key(master_password, &header.salt, &header.argon2_params)?;
        let (_, decrypted_bytes) = decrypt_payload(&file_bytes, &key)?;

        let vault_data: VaultData = serde_json::from_slice(&decrypted_bytes)
            .map_err(|e| VaultError::SerializationError(e.to_string()))?;

        Ok(VaultSession::new(key, header, vault_data))
    }

    /// Saves the current VaultSession to disk.
    /// Does NOT require password re-entry or Argon2 re-derivation.
    /// Safeguards:
    /// 1. If vault file already exists on disk, it MUST decrypt cleanly with session.key.
    ///    If existing file is corrupt or tag fails, save is REJECTED with ExistingVaultCorrupted.
    /// 2. Only after existing vault is verified, it is safely copied to .bak.
    /// 3. Nonce is refreshed anew via OsRng.
    /// 4. JSON buffer is wrapped in Zeroizing from initial allocation.
    /// 5. Encrypted payload is written to .tmp.
    /// 6. Read-back verification decrypts .tmp to guarantee zero corruption before rename.
    /// 7. Atomic rename replaces vault.dat.
    pub fn save(&self, session: &mut VaultSession) -> Result<(), VaultError> {
        // 1. Verify existing vault integrity if file exists on disk
        if self.vault_path.exists() {
            let existing_bytes = fs::read(&self.vault_path)?;
            if existing_bytes.len() < crate::crypto::MIN_VAULT_FILE_SIZE {
                return Err(VaultError::ExistingVaultCorrupted(format!(
                    "Existing file size ({} bytes) is less than minimum required ({} bytes)",
                    existing_bytes.len(),
                    crate::crypto::MIN_VAULT_FILE_SIZE
                )));
            }

            // Test decryption of existing file with current session key
            match decrypt_payload(&existing_bytes, &session.key) {
                Ok(_) => {
                    // Existing file is authentic and decrypts cleanly with session key!
                    // Safely backup to .bak
                    if let Err(e) = fs::copy(&self.vault_path, &self.backup_path) {
                        return Err(VaultError::IoError(e));
                    }
                }
                Err(_) => {
                    return Err(VaultError::ExistingVaultCorrupted(
                        "Existing vault file cannot be authenticated with current session key. Aborting save to protect data."
                            .to_string(),
                    ));
                }
            }
        }

        // 2. Always refresh nonce for every save operation
        session.header.refresh_nonce();

        // 3. Serialize data to JSON wrapped in Zeroizing from the initial allocation
        let json_bytes = Zeroizing::new(
            serde_json::to_vec(&session.data)
                .map_err(|e| VaultError::SerializationError(e.to_string()))?,
        );

        // 4. Encrypt payload with AES-256-GCM using session.header as AAD
        let encrypted_file_bytes = encrypt_payload(&json_bytes, &session.key, &session.header)?;

        // 5. Write to temporary file
        {
            let mut tmp_file = OpenOptions::new()
                .create(true)
                .write(true)
                .truncate(true)
                .open(&self.tmp_path)?;

            tmp_file.write_all(&encrypted_file_bytes)?;
            tmp_file.flush()?;
            tmp_file.sync_all()?;
        }

        // 6. Read-back verification: test-decrypt tmp file before committing
        let verify_result = self.verify_tmp_file(&session.key);
        if let Err(e) = verify_result {
            let _ = fs::remove_file(&self.tmp_path);
            return Err(e);
        }

        // 7. Atomic rename with Windows file-lock retry loop
        self.atomic_rename_with_retries()?;

        Ok(())
    }

    /// Read-back verification helper: reads and decrypts tmp file
    fn verify_tmp_file(&self, key: &DerivedKey) -> Result<(), VaultError> {
        let tmp_bytes = fs::read(&self.tmp_path)?;
        let (_, decrypted_bytes) = decrypt_payload(&tmp_bytes, key)
            .map_err(|_| VaultError::ReadbackVerificationFailed)?;

        // Verify that decrypted bytes deserialize cleanly to VaultData
        let _: VaultData = serde_json::from_slice(&decrypted_bytes)
            .map_err(|_| VaultError::ReadbackVerificationFailed)?;

        Ok(())
    }

    /// Windows-safe atomic rename with exponential backoff retries
    fn atomic_rename_with_retries(&self) -> Result<(), VaultError> {
        const MAX_RETRIES: u32 = 5;
        let mut backoff_ms = 20;

        for attempt in 0..MAX_RETRIES {
            match fs::rename(&self.tmp_path, &self.vault_path) {
                Ok(_) => return Ok(()),
                Err(e) => {
                    if attempt == MAX_RETRIES - 1 {
                        let _ = fs::remove_file(&self.tmp_path);
                        return Err(VaultError::AtomicRenameFailed(format!(
                            "Failed to replace vault file after {} attempts: {}",
                            MAX_RETRIES, e
                        )));
                    }
                    thread::sleep(Duration::from_millis(backoff_ms));
                    backoff_ms *= 2;
                }
            }
        }

        Ok(())
    }

    /// Restores vault from backup file (`.bak`) in case of disaster
    pub fn restore_from_backup(&self) -> Result<(), VaultError> {
        if !self.backup_path.exists() {
            return Err(VaultError::FileNotFound(
                self.backup_path.to_string_lossy().to_string(),
            ));
        }
        fs::copy(&self.backup_path, &self.vault_path)?;
        Ok(())
    }

    /// Saves vault with new key/header without destroying the current vault file beforehand.
    /// Safely validates the existing file with `old_key`, writes and verifies `.tmp` with new key,
    /// and performs atomic replace.
    pub fn save_rekey(&self, session: &mut VaultSession, old_key: &DerivedKey) -> Result<(), VaultError> {
        if self.vault_path.exists() {
            let existing_bytes = fs::read(&self.vault_path)?;
            if existing_bytes.len() < crate::crypto::MIN_VAULT_FILE_SIZE {
                return Err(VaultError::ExistingVaultCorrupted(format!(
                    "Existing file size ({} bytes) is less than minimum required ({} bytes)",
                    existing_bytes.len(),
                    crate::crypto::MIN_VAULT_FILE_SIZE
                )));
            }

            match decrypt_payload(&existing_bytes, old_key) {
                Ok(_) => {
                    if let Err(e) = fs::copy(&self.vault_path, &self.backup_path) {
                        return Err(VaultError::IoError(e));
                    }
                }
                Err(_) => {
                    return Err(VaultError::ExistingVaultCorrupted(
                        "Existing vault file cannot be authenticated with previous key. Aborting rekey to protect data."
                            .to_string(),
                    ));
                }
            }
        }

        session.header.refresh_nonce();

        let json_bytes = Zeroizing::new(
            serde_json::to_vec(&session.data)
                .map_err(|e| VaultError::SerializationError(e.to_string()))?,
        );

        let encrypted_file_bytes = encrypt_payload(&json_bytes, &session.key, &session.header)?;

        {
            let mut tmp_file = OpenOptions::new()
                .create(true)
                .write(true)
                .truncate(true)
                .open(&self.tmp_path)?;

            tmp_file.write_all(&encrypted_file_bytes)?;
            tmp_file.flush()?;
            tmp_file.sync_all()?;
        }

        let verify_result = self.verify_tmp_file(&session.key);
        if let Err(e) = verify_result {
            let _ = fs::remove_file(&self.tmp_path);
            return Err(e);
        }

        self.atomic_rename_with_retries()?;

        Ok(())
    }
}

/// Safely purges an active local vault and all associated local artifacts (recovery data,
/// journals, safety backups, and pre-import backups) from disk.
/// Never removes files outside verified Kinana vault naming patterns, and never touches parent directories.
pub fn purge_local_vault_artifacts(
    vault_path: &Path,
    recovery_path: &Path,
) -> Result<(), VaultError> {
    let mut failures = Vec::new();

    // 1. Target known exact vault artifact paths
    let candidate_paths = [
        vault_path.to_path_buf(),
        recovery_path.to_path_buf(),
        vault_path.with_extension("tx.journal"),
        recovery_path.with_extension("tx.journal"),
        vault_path.with_extension("dat.safety"),
        recovery_path.with_extension("dat.safety"),
        vault_path.with_extension("dat.tmp"),
        recovery_path.with_extension("dat.tmp"),
        vault_path.with_extension("tmp"),
        recovery_path.with_extension("tmp"),
        vault_path.with_extension("dat.bak"),
        recovery_path.with_extension("dat.bak"),
        vault_path.with_extension("dat.pre_import_latest.bak"),
        recovery_path.with_extension("dat.pre_import_latest.bak"),
    ];

    for path in &candidate_paths {
        if path.exists() {
            if let Err(e) = fs::remove_file(path) {
                if e.kind() != std::io::ErrorKind::NotFound {
                    failures.push(format!("{}: {}", path.display(), e));
                }
            }
        }
    }

    // 2. Safely scan parent directory for timestamped pre-import backups strictly belonging to this vault
    if let Some(parent) = vault_path.parent() {
        if parent.exists() {
            if let Ok(entries) = fs::read_dir(parent) {
                for entry in entries.flatten() {
                    let path = entry.path();
                    if path.is_file() {
                        if let Some(file_name) = path.file_name().and_then(|n| n.to_str()) {
                            let is_vault_pre_import = file_name.starts_with("vault.dat.pre_import_") && file_name.ends_with(".bak");
                            let is_rec_pre_import = file_name.starts_with("recovery.dat.pre_import_") && file_name.ends_with(".bak");
                            if is_vault_pre_import || is_rec_pre_import {
                                if let Err(e) = fs::remove_file(&path) {
                                    if e.kind() != std::io::ErrorKind::NotFound {
                                        failures.push(format!("{}: {}", file_name, e));
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    if !failures.is_empty() {
        return Err(VaultError::VaultResetFailed(format!(
            "Could not remove all vault files during reset: {}",
            failures.join("; ")
        )));
    }

    if vault_path.exists() {
        return Err(VaultError::VaultResetFailed(format!(
            "Active vault file still exists at {}",
            vault_path.display()
        )));
    }

    Ok(())
}
