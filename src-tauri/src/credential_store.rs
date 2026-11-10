//! Platform-agnostic secure credential storage abstraction for Kinana Auto-Unlock.
//!
//! # Platform Implementations
//! - Windows: Windows Credential Manager via native Win32 APIs (`windows-sys`).
//! - Linux: Freedesktop Secret Service API via `keyring` (D-Bus / `sync-secret-service`).
//! - macOS: Explicitly disabled in this release (pending separate Keychain review).
//!
//! # Security Invariants
//! - Secrets are NEVER persisted to plaintext files, unencrypted configs, or browser stores.
//! - Read operations return `Zeroizing<String>` buffers to ensure memory scrubbing upon drop.
//! - Opt-in only: Auto-Unlock is strictly disabled by default until explicitly enabled by the user.

use serde::Serialize;
use zeroize::Zeroizing;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct KeyringSupportStatus {
    pub supported: bool,
    pub platform_name: String,
    pub available: bool,
    pub unavailable_reason: Option<String>,
}

#[cfg(target_os = "windows")]
mod imp {
    use super::*;
    use crate::wincred;

    pub fn is_supported() -> bool {
        true
    }

    pub fn check_support_status() -> KeyringSupportStatus {
        KeyringSupportStatus {
            supported: true,
            platform_name: "Windows Credential Manager".to_string(),
            available: true,
            unavailable_reason: None,
        }
    }

    pub fn has_stored_credential() -> bool {
        unsafe { wincred::has_vault_key_wincred() }
    }

    pub fn store_credential(key: &str) -> Result<(), String> {
        unsafe { wincred::store_vault_key_wincred(key) }
    }

    pub fn read_credential() -> Result<Zeroizing<String>, String> {
        unsafe { wincred::read_vault_key_wincred() }
    }

    pub fn delete_credential() -> Result<(), String> {
        unsafe { wincred::delete_vault_key_wincred() }
    }

    pub fn delete_recovery_credential() {
        unsafe { wincred::delete_recovery_code_wincred() }
    }
}

#[cfg(target_os = "linux")]
mod imp {
    use super::*;
    use keyring::Entry;

    const SERVICE_NAME: &str = "com.kinana.vault";
    const USER_NAME: &str = "vault_master_key";

    pub fn is_supported() -> bool {
        true
    }

    pub fn check_support_status() -> KeyringSupportStatus {
        let entry = match Entry::new(SERVICE_NAME, USER_NAME) {
            Ok(e) => e,
            Err(e) => {
                return KeyringSupportStatus {
                    supported: true,
                    platform_name: "Linux Secret Service".to_string(),
                    available: false,
                    unavailable_reason: Some(format!("Failed to initialize Secret Service: {}", e)),
                };
            }
        };

        match entry.get_password() {
            Ok(_) | Err(keyring::Error::NoEntry) => KeyringSupportStatus {
                supported: true,
                platform_name: "Linux Secret Service".to_string(),
                available: true,
                unavailable_reason: None,
            },
            Err(keyring::Error::NoStorageAccess(e)) => KeyringSupportStatus {
                supported: true,
                platform_name: "Linux Secret Service".to_string(),
                available: false,
                unavailable_reason: Some(format!("Keyring storage unavailable or locked: {}", e)),
            },
            Err(keyring::Error::PlatformFailure(e)) => KeyringSupportStatus {
                supported: true,
                platform_name: "Linux Secret Service".to_string(),
                available: false,
                unavailable_reason: Some(format!("Secret Service platform communication error: {}", e)),
            },
            Err(e) => KeyringSupportStatus {
                supported: true,
                platform_name: "Linux Secret Service".to_string(),
                available: false,
                unavailable_reason: Some(format!("Secret Service unavailable: {}", e)),
            },
        }
    }

    pub fn has_stored_credential() -> bool {
        if let Ok(entry) = Entry::new(SERVICE_NAME, USER_NAME) {
            entry.get_password().is_ok()
        } else {
            false
        }
    }

    pub fn store_credential(key: &str) -> Result<(), String> {
        let entry = Entry::new(SERVICE_NAME, USER_NAME)
            .map_err(|e| format!("Failed to create keyring entry: {}", e))?;
        entry
            .set_password(key)
            .map_err(|e| format!("Failed to save credential in Secret Service: {}", e))
    }

    pub fn read_credential() -> Result<Zeroizing<String>, String> {
        let entry = Entry::new(SERVICE_NAME, USER_NAME)
            .map_err(|e| format!("Failed to create keyring entry: {}", e))?;
        let pwd = entry
            .get_password()
            .map_err(|e| format!("Failed to retrieve credential from Secret Service: {}", e))?;
        Ok(Zeroizing::new(pwd))
    }

    pub fn delete_credential() -> Result<(), String> {
        if let Ok(entry) = Entry::new(SERVICE_NAME, USER_NAME) {
            match entry.delete_password() {
                Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
                Err(e) => Err(format!("Failed to delete credential from Secret Service: {}", e)),
            }
        } else {
            Ok(())
        }
    }

    pub fn delete_recovery_credential() {}
}

#[cfg(not(any(target_os = "windows", target_os = "linux")))]
mod imp {
    use super::*;

    pub fn is_supported() -> bool {
        false
    }

    pub fn check_support_status() -> KeyringSupportStatus {
        KeyringSupportStatus {
            supported: false,
            platform_name: "macOS Keychain".to_string(),
            available: false,
            unavailable_reason: Some("Auto-Unlock is currently under preview development for macOS".to_string()),
        }
    }

    pub fn has_stored_credential() -> bool {
        false
    }

    pub fn store_credential(_key: &str) -> Result<(), String> {
        Err("Auto-Unlock is not supported on macOS in this release".to_string())
    }

    pub fn read_credential() -> Result<Zeroizing<String>, String> {
        Err("Auto-Unlock is not supported on macOS in this release".to_string())
    }

    pub fn delete_credential() -> Result<(), String> {
        Ok(())
    }

    pub fn delete_recovery_credential() {}
}

pub fn is_supported() -> bool {
    imp::is_supported()
}

pub fn check_support_status() -> KeyringSupportStatus {
    imp::check_support_status()
}

pub fn has_stored_credential() -> bool {
    imp::has_stored_credential()
}

pub fn store_credential(key: &str) -> Result<(), String> {
    imp::store_credential(key)
}

pub fn read_credential() -> Result<Zeroizing<String>, String> {
    imp::read_credential()
}

pub fn delete_credential() -> Result<(), String> {
    imp::delete_credential()
}

pub fn delete_recovery_credential() {
    imp::delete_recovery_credential();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_support_status_structure() {
        let status = check_support_status();
        #[cfg(target_os = "windows")]
        {
            assert!(status.supported);
            assert_eq!(status.platform_name, "Windows Credential Manager");
            assert!(status.available);
            assert!(status.unavailable_reason.is_none());
        }
        #[cfg(target_os = "linux")]
        {
            assert!(status.supported);
            assert_eq!(status.platform_name, "Linux Secret Service");
        }
        #[cfg(not(any(target_os = "windows", target_os = "linux")))]
        {
            assert!(!status.supported);
        }
    }
}
