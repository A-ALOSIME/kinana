//! Windows Credential Manager integration for Kinana Auto-Unlock.
//!
//! # Platform Availability
//! Windows Credential Manager is available exclusively on Windows.
//! On non-Windows platforms (macOS, Linux), Auto-Unlock is disabled and these functions
//! return graceful errors, ensuring that secrets are NEVER written to plaintext files or
//! unencrypted browser stores.

use zeroize::Zeroizing;

pub const KINANA_CRED_TARGET: &str = "kinana_vault_key\0";
pub const KINANA_RECOVERY_CRED_TARGET: &str = "kinana_recovery_code\0";

#[cfg(target_os = "windows")]
mod imp {
    use super::*;
    use windows_sys::Win32::Foundation::{GetLastError, ERROR_NOT_FOUND};
    use windows_sys::Win32::Security::Credentials::{
        CredDeleteW, CredFree, CredReadW, CredWriteW, CREDENTIALW, CRED_PERSIST_ENTERPRISE,
        CRED_TYPE_GENERIC,
    };

    pub unsafe fn store_vault_key_wincred(key: &str) -> Result<(), String> {
        let target_name: Vec<u16> = KINANA_CRED_TARGET.encode_utf16().collect();
        let user_name: Vec<u16> = "kinana_user\0".encode_utf16().collect();
        let secret_bytes = key.as_bytes();

        let cred = CREDENTIALW {
            Flags: 0,
            Type: CRED_TYPE_GENERIC,
            TargetName: target_name.as_ptr() as *mut u16,
            Comment: std::ptr::null_mut(),
            LastWritten: std::mem::zeroed(),
            CredentialBlobSize: secret_bytes.len() as u32,
            CredentialBlob: secret_bytes.as_ptr() as *mut u8,
            Persist: CRED_PERSIST_ENTERPRISE,
            AttributeCount: 0,
            Attributes: std::ptr::null_mut(),
            TargetAlias: std::ptr::null_mut(),
            UserName: user_name.as_ptr() as *mut u16,
        };

        if CredWriteW(&cred, 0) == 0 {
            return Err(format!("CredWriteW failed with code {}", GetLastError()));
        }
        Ok(())
    }

    pub unsafe fn has_vault_key_wincred() -> bool {
        let target_name: Vec<u16> = KINANA_CRED_TARGET.encode_utf16().collect();
        let mut cred_ptr: *mut CREDENTIALW = std::ptr::null_mut();

        if CredReadW(target_name.as_ptr(), CRED_TYPE_GENERIC, 0, &mut cred_ptr) == 0 {
            return false;
        }

        if !cred_ptr.is_null() {
            CredFree(cred_ptr as *mut std::ffi::c_void);
            true
        } else {
            false
        }
    }

    pub unsafe fn read_vault_key_wincred() -> Result<Zeroizing<String>, String> {
        let target_name: Vec<u16> = KINANA_CRED_TARGET.encode_utf16().collect();
        let mut cred_ptr: *mut CREDENTIALW = std::ptr::null_mut();

        if CredReadW(target_name.as_ptr(), CRED_TYPE_GENERIC, 0, &mut cred_ptr) == 0 {
            return Err("No saved credential found in Windows Credential Store".to_string());
        }

        if cred_ptr.is_null() {
            return Err("Credential pointer is null".to_string());
        }

        let cred = &*cred_ptr;
        let blob_slice = std::slice::from_raw_parts(cred.CredentialBlob, cred.CredentialBlobSize as usize);
        let key_str = std::str::from_utf8(blob_slice)
            .map_err(|_| "Invalid UTF-8 in credential store blob".to_string())?
            .to_string();

        CredFree(cred_ptr as *mut std::ffi::c_void);
        Ok(Zeroizing::new(key_str))
    }

    pub unsafe fn delete_vault_key_wincred() -> Result<(), String> {
        let target_name: Vec<u16> = KINANA_CRED_TARGET.encode_utf16().collect();
        if CredDeleteW(target_name.as_ptr(), CRED_TYPE_GENERIC, 0) == 0 {
            let err = GetLastError();
            if err != ERROR_NOT_FOUND {
                return Err(format!("CredDeleteW failed with code {}", err));
            }
        }
        Ok(())
    }

    pub unsafe fn delete_recovery_code_wincred() {
        let target_name: Vec<u16> = KINANA_RECOVERY_CRED_TARGET.encode_utf16().collect();
        let _ = CredDeleteW(target_name.as_ptr(), CRED_TYPE_GENERIC, 0);
    }
}

#[cfg(not(target_os = "windows"))]
mod imp {
    use super::*;

    pub unsafe fn store_vault_key_wincred(_key: &str) -> Result<(), String> {
        Err("Auto-Unlock is only supported on Windows in this release".to_string())
    }

    pub unsafe fn has_vault_key_wincred() -> bool {
        false
    }

    pub unsafe fn read_vault_key_wincred() -> Result<Zeroizing<String>, String> {
        Err("Auto-Unlock is only supported on Windows in this release".to_string())
    }

    pub unsafe fn delete_vault_key_wincred() -> Result<(), String> {
        Ok(())
    }

    pub unsafe fn delete_recovery_code_wincred() {}
}

pub unsafe fn store_vault_key_wincred(key: &str) -> Result<(), String> {
    imp::store_vault_key_wincred(key)
}

pub unsafe fn has_vault_key_wincred() -> bool {
    imp::has_vault_key_wincred()
}

pub unsafe fn read_vault_key_wincred() -> Result<Zeroizing<String>, String> {
    imp::read_vault_key_wincred()
}

pub unsafe fn delete_vault_key_wincred() -> Result<(), String> {
    imp::delete_vault_key_wincred()
}

pub unsafe fn delete_recovery_code_wincred() {
    imp::delete_recovery_code_wincred()
}
