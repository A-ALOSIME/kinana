//! Windows Credential Manager integration for Kinana Auto-Unlock.
//!
//! # Security & Trust Model
//! When Auto-Unlock is enabled, the master password is encrypted and stored in Windows Credential Manager
//! (`CredWriteW` with `CRED_PERSIST_ENTERPRISE`).
//!
//! **Trust Assumptions:**
//! 1. Windows Credential Manager isolates credentials across distinct Windows user accounts.
//! 2. Any process running under the *same* Windows user logon session with standard user permissions
//!    can call `CredReadW` to query `kinana_vault_key`.
//! 3. Auto-Unlock is an opt-in feature designed for balance between local convenience and security.
//!    Users requiring maximum isolation should leave Auto-Unlock disabled.
//! 4. Kinana ensures that the emergency recovery code is strictly offline and NEVER stored in WinCred.
//!    `delete_recovery_code_wincred` actively removes any legacy recovery code artifacts.

use zeroize::Zeroizing;

pub const KINANA_CRED_TARGET: &str = "kinana_vault_key\0";
pub const KINANA_RECOVERY_CRED_TARGET: &str = "kinana_recovery_code\0";

/// Stores the vault master password in Windows Credential Manager.
/// SAFETY: Calls Win32 CredWriteW with valid zero-terminated target and credential buffers.
pub unsafe fn store_vault_key_wincred(key: &str) -> Result<(), String> {
    use windows_sys::Win32::Foundation::GetLastError;
    use windows_sys::Win32::Security::Credentials::{
        CredWriteW, CREDENTIALW, CRED_PERSIST_ENTERPRISE, CRED_TYPE_GENERIC,
    };

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

/// Checks whether a vault key exists in Windows Credential Manager without exposing
/// or allocating the secret string in process memory.
/// SAFETY: Calls Win32 CredReadW and immediately frees the credential handle with CredFree.
pub unsafe fn has_vault_key_wincred() -> bool {
    use windows_sys::Win32::Security::Credentials::{CredFree, CredReadW, CREDENTIALW, CRED_TYPE_GENERIC};

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

/// Reads the vault master password from Windows Credential Manager.
/// Returns a `Zeroizing<String>` wrapper to guarantee automatic zeroization on drop.
/// SAFETY: Calls Win32 CredReadW and frees the credential pointer with CredFree.
pub unsafe fn read_vault_key_wincred() -> Result<Zeroizing<String>, String> {
    use windows_sys::Win32::Security::Credentials::{
        CredFree, CredReadW, CREDENTIALW, CRED_TYPE_GENERIC,
    };

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

/// Deletes the vault master password from Windows Credential Manager.
/// SAFETY: Calls Win32 CredDeleteW with valid target name.
pub unsafe fn delete_vault_key_wincred() -> Result<(), String> {
    use windows_sys::Win32::Foundation::{GetLastError, ERROR_NOT_FOUND};
    use windows_sys::Win32::Security::Credentials::{CredDeleteW, CRED_TYPE_GENERIC};

    let target_name: Vec<u16> = KINANA_CRED_TARGET.encode_utf16().collect();
    if CredDeleteW(target_name.as_ptr(), CRED_TYPE_GENERIC, 0) == 0 {
        let err = GetLastError();
        if err != ERROR_NOT_FOUND {
            return Err(format!("CredDeleteW failed with code {}", err));
        }
    }
    Ok(())
}

/// Cleans up any legacy recovery code from Windows Credential Store to ensure
/// that the emergency recovery code is strictly offline and never accessible locally by processes.
/// SAFETY: Calls Win32 CredDeleteW with valid target name.
pub unsafe fn delete_recovery_code_wincred() {
    use windows_sys::Win32::Security::Credentials::{CredDeleteW, CRED_TYPE_GENERIC};
    let target_name: Vec<u16> = KINANA_RECOVERY_CRED_TARGET.encode_utf16().collect();
    let _ = CredDeleteW(target_name.as_ptr(), CRED_TYPE_GENERIC, 0);
}
