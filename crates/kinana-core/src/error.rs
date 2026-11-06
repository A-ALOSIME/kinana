use thiserror::Error;

#[derive(Error, Debug)]
pub enum VaultError {
    #[error("Vault file does not exist: {0}")]
    FileNotFound(String),

    #[error("File is too short to be a valid vault (size: {0} bytes, minimum required: {1} bytes)")]
    FileTooShort(usize, usize),

    #[error("Invalid magic bytes: expected PORTVLT1, found {0:?}")]
    InvalidMagic(Vec<u8>),

    #[error("Unsupported vault version: {0} (current supported version is 1)")]
    UnsupportedVersion(u16),

    #[error("Invalid Argon2 parameters in header: {0}")]
    InvalidArgon2Parameters(String),

    #[error("Master password cannot be empty")]
    EmptyPassword,

    #[error("Cryptographic derivation or decryption failed: authentication tag mismatch or invalid password")]
    DecryptionFailed,

    #[error("Read-back verification failed: newly written vault could not be decrypted")]
    ReadbackVerificationFailed,

    #[error("Serialization error: {0}")]
    SerializationError(String),

    #[error("I/O error: {0}")]
    IoError(#[from] std::io::Error),

    #[error("Atomic rename failed after retries: {0}")]
    AtomicRenameFailed(String),

    #[error("Account not found: service_id={0}, account_id={1}")]
    AccountNotFound(String, String),

    #[error("Existing vault file is corrupted or cannot be authenticated: {0}. Save aborted to protect data.")]
    ExistingVaultCorrupted(String),
}
