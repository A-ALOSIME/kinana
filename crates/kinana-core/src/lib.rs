pub mod account_ops;
pub mod benchmark;
pub mod crypto;
pub mod error;
pub mod journal;
pub mod models;
pub mod storage;

pub use account_ops::{
    apply_account_update, extract_pin_from_notes, generate_password_string, pack_account_notes,
    strip_pin_lines, unpack_account_notes, AccountMetaPayload, AccountUpdateInput,
};

pub use benchmark::{benchmark_system_argon2, BenchmarkReport};
pub use crypto::{
    decrypt_payload, derive_key, encrypt_payload, Argon2Parameters, DerivedKey, VaultHeader,
    CURRENT_VERSION, HEADER_SIZE, MAGIC_BYTES, MAX_M_COST, MAX_P_COST, MAX_T_COST,
    MIN_M_COST, MIN_P_COST, MIN_T_COST, MIN_VAULT_FILE_SIZE,
};
pub use error::VaultError;
pub use journal::{atomic_replace, create_pre_import_archive, TransactionJournal, TransactionState};
pub use models::{Account, AccountSummary, SecretString, Service, ServiceSummary, VaultData, VaultSummary};
pub use storage::{purge_local_vault_artifacts, VaultSession, VaultStorage};
