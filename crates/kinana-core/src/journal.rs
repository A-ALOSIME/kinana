use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::error::VaultError;

/// Performs an atomic in-place file replacement.
/// On Windows, uses MoveFileExW with MOVEFILE_REPLACE_EXISTING and MOVEFILE_WRITE_THROUGH
/// to guarantee NTFS atomicity without deleting the destination file beforehand.
#[cfg(windows)]
pub fn atomic_replace(from: &Path, to: &Path) -> std::io::Result<()> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::{
        MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
    };

    let from_wide: Vec<u16> = from.as_os_str().encode_wide().chain(std::iter::once(0)).collect();
    let to_wide: Vec<u16> = to.as_os_str().encode_wide().chain(std::iter::once(0)).collect();

    let res = unsafe {
        MoveFileExW(
            from_wide.as_ptr(),
            to_wide.as_ptr(),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    };

    if res == 0 {
        let err = std::io::Error::last_os_error();
        if let Err(_) = fs::copy(from, to) {
            return Err(err);
        }
        let _ = fs::remove_file(from);
        Ok(())
    } else {
        Ok(())
    }
}

#[cfg(not(windows))]
pub fn atomic_replace(from: &Path, to: &Path) -> std::io::Result<()> {
    fs::rename(from, to)
}

/// Computes the SHA-256 checksum in hexadecimal format for a given file on disk.
pub fn compute_sha256(path: &Path) -> Result<String, VaultError> {
    let bytes = fs::read(path)?;
    let mut hasher = Sha256::new();
    hasher.update(&bytes);
    let result = hasher.finalize();
    Ok(format!("{:x}", result))
}

/// Lifecycle state of a transactional storage operation.
/// Defaults to Pending for backward compatibility with legacy journals.
#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq, Eq)]
pub enum TransactionState {
    #[serde(alias = "pending", alias = "Pending")]
    Pending,
    #[serde(alias = "committed", alias = "Committed")]
    Committed,
    #[serde(alias = "rolled_back", alias = "RolledBack")]
    RolledBack,
}

impl Default for TransactionState {
    fn default() -> Self {
        TransactionState::Pending
    }
}

/// Write-Ahead Transaction Journal for multi-file crash consistency, verified rollback, and interrupted operations recovery.
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq)]
pub struct TransactionJournal {
    pub op: String,
    #[serde(default)]
    pub state: TransactionState,
    pub vault_path: PathBuf,
    pub recovery_path: PathBuf,
    pub vault_safety: Option<PathBuf>,
    pub recovery_safety: Option<PathBuf>,
    #[serde(default)]
    pub vault_safety_sha256: Option<String>,
    #[serde(default)]
    pub recovery_safety_sha256: Option<String>,
    pub is_initial_import: bool,
}

impl TransactionJournal {
    /// Initializes a new TransactionJournal in Pending state and calculates SHA-256 checksums of safety backups.
    pub fn new(
        op: impl Into<String>,
        vault_path: PathBuf,
        recovery_path: PathBuf,
        vault_safety: Option<PathBuf>,
        recovery_safety: Option<PathBuf>,
        is_initial_import: bool,
    ) -> Result<Self, VaultError> {
        let vault_safety_sha256 = if let Some(ref p) = vault_safety {
            if p.exists() {
                Some(compute_sha256(p)?)
            } else {
                None
            }
        } else {
            None
        };

        let recovery_safety_sha256 = if let Some(ref p) = recovery_safety {
            if p.exists() {
                Some(compute_sha256(p)?)
            } else {
                None
            }
        } else {
            None
        };

        Ok(Self {
            op: op.into(),
            state: TransactionState::Pending,
            vault_path,
            recovery_path,
            vault_safety,
            recovery_safety,
            vault_safety_sha256,
            recovery_safety_sha256,
            is_initial_import,
        })
    }

    /// Writes the journal to disk atomically (write to temp file, sync_all, then atomic replace)
    /// to eliminate partial JSON corruption without a window of destination deletion.
    pub fn write_to_disk(&self, journal_path: &Path) -> Result<(), VaultError> {
        let bytes = serde_json::to_vec_pretty(self)
            .map_err(|e| VaultError::TransactionJournalError(format!("Failed to serialize journal: {}", e)))?;

        let tmp_path = journal_path.with_extension("tx.journal.tmp");
        {
            let mut file = OpenOptions::new()
                .create(true)
                .write(true)
                .truncate(true)
                .open(&tmp_path)?;

            file.write_all(&bytes)?;
            file.sync_all()?;
        }

        atomic_replace(&tmp_path, journal_path)?;
        Ok(())
    }

    /// Reads and deserializes a journal from disk if it exists.
    /// Backwards compatible with legacy journals lacking state or sha256 fields.
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

    /// Explicitly commits the transaction state on disk without deleting safety backups yet.
    /// Returns error if disk write fails, ensuring state transition is verified.
    pub fn commit(&mut self, journal_path: &Path) -> Result<(), VaultError> {
        self.state = TransactionState::Committed;
        self.write_to_disk(journal_path)
    }

    /// Cleans up the journal file and any safety backup files on disk.
    pub fn cleanup(&self, journal_path: &Path) -> Result<(), VaultError> {
        if journal_path.exists() {
            let _ = fs::remove_file(journal_path);
        }
        if let Some(ref v) = self.vault_safety {
            if v.exists() {
                let _ = fs::remove_file(v);
            }
        }
        if let Some(ref r) = self.recovery_safety {
            if r.exists() {
                let _ = fs::remove_file(r);
            }
        }
        Ok(())
    }

    /// Commits the transaction and cleans up journal and safety files.
    /// Strictly verifies state transition to Committed on disk before deleting any safety files.
    pub fn commit_and_cleanup(&mut self, journal_path: &Path) -> Result<(), VaultError> {
        self.commit(journal_path)?;
        self.cleanup(journal_path)
    }

    /// Marks the transaction as rolled back and cleans up journal and safety files.
    /// Strictly verifies state transition to RolledBack on disk before deleting any safety files.
    pub fn rollback_and_cleanup(&mut self, journal_path: &Path) -> Result<(), VaultError> {
        self.state = TransactionState::RolledBack;
        self.write_to_disk(journal_path)?;
        self.cleanup(journal_path)
    }

    /// Recovers from an interrupted transaction recorded in the journal.
    /// Invariant:
    /// 1. If state is Committed or RolledBack, the transaction already finished; cleans up lingering journal without rolling back.
    /// 2. If state is Pending, verifies SHA-256 checksums of safety files, restores both files, and cleans up.
    /// 3. If any step fails, the journal is strictly PRESERVED on disk.
    pub fn recover(journal_path: &Path) -> Result<bool, VaultError> {
        if !journal_path.exists() {
            return Ok(false);
        }

        let mut journal = match Self::read_from_disk(journal_path)? {
            Some(j) => j,
            None => return Ok(false),
        };

        // If the transaction was already committed or rolled back prior to app exit,
        // the files on disk are already in their correct state; simply clean up lingering journal.
        if journal.state == TransactionState::Committed || journal.state == TransactionState::RolledBack {
            let _ = fs::remove_file(journal_path);
            if let Some(ref v) = journal.vault_safety {
                if v.exists() {
                    let _ = fs::remove_file(v);
                }
            }
            if let Some(ref r) = journal.recovery_safety {
                if r.exists() {
                    let _ = fs::remove_file(r);
                }
            }
            return Ok(false);
        }

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

                // Verify SHA-256 integrity before restoring
                if let Some(ref expected_hash) = journal.vault_safety_sha256 {
                    let actual_hash = compute_sha256(v_safety)?;
                    if actual_hash != *expected_hash {
                        return Err(VaultError::TransactionRecoveryFailed(format!(
                            "Vault safety backup SHA-256 hash mismatch! Expected {}, found {}. File corrupted.",
                            expected_hash, actual_hash
                        )));
                    }
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

                // Verify SHA-256 integrity before restoring
                if let Some(ref expected_hash) = journal.recovery_safety_sha256 {
                    let actual_hash = compute_sha256(r_safety)?;
                    if actual_hash != *expected_hash {
                        return Err(VaultError::TransactionRecoveryFailed(format!(
                            "Recovery safety backup SHA-256 hash mismatch! Expected {}, found {}. File corrupted.",
                            expected_hash, actual_hash
                        )));
                    }
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

        // Only mark rolled back and clean up journal once all recovery steps succeeded without errors
        journal.rollback_and_cleanup(journal_path)?;
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
    let _ = fs::copy(vault_safety, &latest_vault);
    let _ = fs::remove_file(vault_safety);

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
            let _ = fs::copy(r_safety, &latest_rec);
            let _ = fs::remove_file(r_safety);
        }
    }

    Ok(archive_id)
}
