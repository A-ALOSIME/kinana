pub mod benchmark;
pub mod crypto;
pub mod error;
pub mod models;
pub mod storage;

pub use benchmark::{benchmark_system_argon2, BenchmarkReport};
pub use crypto::{
    decrypt_payload, derive_key, encrypt_payload, Argon2Parameters, DerivedKey, VaultHeader,
    CURRENT_VERSION, HEADER_SIZE, MAGIC_BYTES, MAX_M_COST, MAX_P_COST, MAX_T_COST,
    MIN_M_COST, MIN_P_COST, MIN_T_COST, MIN_VAULT_FILE_SIZE,
};
pub use error::VaultError;
pub use models::{Account, AccountSummary, SecretString, Service, ServiceSummary, VaultData, VaultSummary};
pub use storage::{VaultSession, VaultStorage};
