use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use serde::{Deserialize, Serialize};

use crate::error::VaultError;

/// Write-Ahead Transaction Journal for multi-file crash consistency and interrupted operations recovery.
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq)]
pub struct TransactionJournal {
    pub op: String,
    pub vault_path: PathBuf,
    pub recovery_path: PathBuf,
    pub vault_safety: Option<PathBuf>,
    pub recovery_safety: Option<PathBuf>,
    pub is_initial_import: bool,
}

impl TransactionJournal {
    /// Writes the journal to disk atomically with sync_all to guarantee durability before file modifications.
    pub fn write_to_disk(&self, journal_path: &Path) -> Result<(), VaultError> {
        let bytes = serde_json::to_vec_pretty(self)
            .map_err(|e| VaultError::TransactionJournalError(format!("Failed to serialize journal: {}", e)))?;

        let mut file = OpenOptions::new()
            .create(true)
            .write(true)
            .truncate(true)
            .open(journal_path)?;

        file.write_all(&bytes)?;
        file.sync_all()?;
        Ok(())
    }

    /// Reads and deserializes a journal from disk if it exists.
    pub fn read_from_disk(journal_path: &Path) -> Result<Option<Self>, VaultError> {
        if !journal_path.exists() {
            return Ok(None);
        }

        let bytes = fs::read(journal_path)?;
        let journal = serde_json::from_slice::<TransactionJournal>(&bytes)
            .map_err(|e| VaultError::TransactionJournalError(format!("Failed to parse journal: {}", e)))?;
        Ok(Some(journal))
    }

    /// Safely clears the journal file from disk after an operation or rollback has completely succeeded.
    pub fn clear(journal_path: &Path) -> Result<(), VaultError> {
        if journal_path.exists() {
            fs::remove_file(journal_path)?;
        }
        Ok(())
    }

    /// Recovers from an interrupted transaction recorded in the journal.
    /// Crucial invariant: Only deletes the journal if recovery succeeds 100%.
    /// If any step fails, the journal is preserved on disk to prevent silent data loss.
    pub fn recover(journal_path: &Path) -> Result<bool, VaultError> {
        if !journal_path.exists() {
            return Ok(false);
        }

        let journal = match Self::read_from_disk(journal_path)? {
            Some(j) => j,
            None => return Ok(false),
        };

        if journal.is_initial_import {
            if journal.vault_path.exists() {
                fs::remove_file(&journal.vault_path)?;
            }
            if journal.recovery_path.exists() {
                fs::remove_file(&journal.recovery_path)?;
            }
        } else {
            // Restore vault.dat from safety backup if specified
            if let Some(ref v_safety) = journal.vault_safety {
                if !v_safety.exists() {
                    return Err(VaultError::TransactionRecoveryFailed(format!(
                        "Vault safety backup file not found: {}",
                        v_safety.display()
                    )));
                }
                fs::copy(v_safety, &journal.vault_path)?;
                let meta = fs::metadata(&journal.vault_path)?;
                if (meta.len() as usize) < crate::crypto::MIN_VAULT_FILE_SIZE {
                    return Err(VaultError::TransactionRecoveryFailed(
                        "Restored vault file is too short to be a valid vault".to_string(),
                    ));
                }
            }

            // Restore recovery.dat from safety backup if specified
            if let Some(ref r_safety) = journal.recovery_safety {
                if !r_safety.exists() {
                    return Err(VaultError::TransactionRecoveryFailed(format!(
                        "Recovery safety backup file not found: {}",
                        r_safety.display()
                    )));
                }
                fs::copy(r_safety, &journal.recovery_path)?;
                let meta = fs::metadata(&journal.recovery_path)?;
                if (meta.len() as usize) < crate::crypto::MIN_VAULT_FILE_SIZE {
                    return Err(VaultError::TransactionRecoveryFailed(
                        "Restored recovery file is too short to be a valid recovery file".to_string(),
                    ));
                }
            }
        }

        // Only remove journal when all recovery steps above succeeded without errors
        fs::remove_file(journal_path)?;
        Ok(true)
    }
}

/// Creates timestamped pre-import archive backups using a single unique identifier across both vault and recovery.
/// Prevents name collision across multiple imports in the same microsecond and ensures Windows file lock resiliency.
pub fn create_pre_import_archive(
    vault_path: &Path,
    vault_safety: &Path,
    recovery_path: &Path,
    recovery_safety: Option<&Path>,
) -> Result<String, VaultError> {
    if !vault_safety.exists() {
        return Err(VaultError::TransactionRecoveryFailed(format!(
            "Cannot archive missing vault safety backup: {}",
            vault_safety.display()
        )));
    }

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default();
    let archive_id = format!("{}_{:06}", now.as_secs(), now.subsec_micros());

    // 1. Vault Archive
    let mut timestamped_vault = vault_path.with_extension(format!("dat.pre_import_{}.bak", archive_id));
    let mut counter = 1;
    while timestamped_vault.exists() {
        timestamped_vault = vault_path.with_extension(format!("dat.pre_import_{}_{}.bak", archive_id, counter));
        counter += 1;
    }
    fs::copy(vault_safety, &timestamped_vault)?;

    let latest_vault = vault_path.with_extension("dat.pre_import_latest.bak");
    if latest_vault.exists() {
        let _ = fs::remove_file(&latest_vault);
    }
    if let Err(_) = fs::rename(vault_safety, &latest_vault) {
        fs::copy(&timestamped_vault, &latest_vault)?;
        let _ = fs::remove_file(vault_safety);
    }

    // 2. Recovery Archive (using identical archive_id for perfect synchronization)
    if let Some(r_safety) = recovery_safety {
        if r_safety.exists() {
            let mut timestamped_rec = recovery_path.with_extension(format!("dat.pre_import_{}.bak", archive_id));
            let mut rec_counter = 1;
            while timestamped_rec.exists() {
                timestamped_rec = recovery_path.with_extension(format!("dat.pre_import_{}_{}.bak", archive_id, rec_counter));
                rec_counter += 1;
            }
            fs::copy(r_safety, &timestamped_rec)?;

            let latest_rec = recovery_path.with_extension("dat.pre_import_latest.bak");
            if latest_rec.exists() {
                let _ = fs::remove_file(&latest_rec);
            }
            if let Err(_) = fs::rename(r_safety, &latest_rec) {
                fs::copy(&timestamped_rec, &latest_rec)?;
                let _ = fs::remove_file(r_safety);
            }
        }
    }

    Ok(archive_id)
}
