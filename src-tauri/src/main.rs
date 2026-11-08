// Prevents additional console window on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Duration;

use kinana_core::{
    journal::{create_pre_import_archive, TransactionJournal},
    models::{Account, SecretString, Service, VaultSummary},
    storage::{VaultSession, VaultStorage},
};

use tauri::{AppHandle, Emitter, Manager, State};
use zeroize::Zeroize;

pub struct AppState {
    pub session: Mutex<Option<VaultSession>>,
    pub last_activity: Mutex<std::time::Instant>,
    pub auto_lock_timeout_secs: Mutex<Option<u64>>,
    pub current_recovery_key: Mutex<Option<SecretString>>,
}

fn update_activity(state: &AppState) {
    if let Ok(mut last) = state.last_activity.lock() {
        *last = std::time::Instant::now();
    }
}


/// Helper function to resolve the standard vault file path in app_data_dir
fn get_vault_path(app: &AppHandle) -> Result<PathBuf, String> {
    let app_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to resolve app data directory: {}", e))?;

    if !app_dir.exists() {
        std::fs::create_dir_all(&app_dir)
            .map_err(|e| format!("Failed to create app data directory: {}", e))?;
    }

    Ok(app_dir.join("vault.dat"))
}

/// Native Windows Clipboard helper with security formats.
///
/// SAFETY:
/// Calling Win32 native clipboard functions (OpenClipboard, EmptyClipboard, SetClipboardData, CloseClipboard)
/// and memory allocation functions (GlobalAlloc, GlobalLock, GlobalUnlock) requires `unsafe`.
/// We are manually managing global memory blocks allocated via the Win32 subsystem, ensuring
/// pointers are valid and that clipboard ownership is properly transferred to the Windows OS.
unsafe fn copy_to_windows_clipboard_secure(text: &str) -> Result<u32, String> {
    use windows_sys::Win32::System::DataExchange::{
        CloseClipboard, EmptyClipboard, GetClipboardSequenceNumber, OpenClipboard, RegisterClipboardFormatW, SetClipboardData,
    };
    use windows_sys::Win32::System::Memory::{
        GlobalAlloc, GlobalLock, GlobalUnlock, GMEM_MOVEABLE, GMEM_ZEROINIT,
    };

    if OpenClipboard(std::ptr::null_mut()) == 0 {
        return Err("Failed to open Windows clipboard".to_string());
    }

    EmptyClipboard();

    // 1. Exclude from Windows 10/11 Clipboard History (Win + V):
    // Documented Microsoft format: DWORD = 0 prevents inclusion in clipboard history
    let hist_fmt_name: Vec<u16> = "CanIncludeInClipboardHistory\0".encode_utf16().collect();
    let cf_history = RegisterClipboardFormatW(hist_fmt_name.as_ptr());
    if cf_history != 0 {
        let hmem = GlobalAlloc(GMEM_MOVEABLE | GMEM_ZEROINIT, std::mem::size_of::<u32>());
        if !hmem.is_null() {
            SetClipboardData(cf_history, hmem as _);
        }
    }

    // 2. Prevent uploading/syncing to Microsoft Cloud Clipboard:
    // Documented Microsoft format: DWORD = 0 prevents cross-device sync
    let cloud_fmt_name: Vec<u16> = "CanUploadToCloudClipboard\0".encode_utf16().collect();
    let cf_cloud = RegisterClipboardFormatW(cloud_fmt_name.as_ptr());
    if cf_cloud != 0 {
        let hmem = GlobalAlloc(GMEM_MOVEABLE | GMEM_ZEROINIT, std::mem::size_of::<u32>());
        if !hmem.is_null() {
            SetClipboardData(cf_cloud, hmem as _);
        }
    }

    // 3. Write plaintext to clipboard as CF_UNICODETEXT (ID 13)
    let utf16: Vec<u16> = text.encode_utf16().chain(std::iter::once(0)).collect();
    let byte_len = utf16.len() * std::mem::size_of::<u16>();
    let hmem_text = GlobalAlloc(GMEM_MOVEABLE, byte_len);
    if hmem_text.is_null() {
        CloseClipboard();
        return Err("Failed to allocate global memory for clipboard text".to_string());
    }

    let ptr = GlobalLock(hmem_text) as *mut u16;
    if ptr.is_null() {
        CloseClipboard();
        return Err("Failed to lock global memory for clipboard text".to_string());
    }
    std::ptr::copy_nonoverlapping(utf16.as_ptr(), ptr, utf16.len());
    GlobalUnlock(hmem_text);

    SetClipboardData(13 /* CF_UNICODETEXT */, hmem_text as _);

    CloseClipboard();
    let seq = GetClipboardSequenceNumber();
    Ok(seq)
}

/// Clears Windows clipboard.
/// SAFETY: Opens and empties clipboard using standard Win32 API.
unsafe fn clear_windows_clipboard() {
    use windows_sys::Win32::System::DataExchange::{CloseClipboard, EmptyClipboard, OpenClipboard};
    if OpenClipboard(std::ptr::null_mut()) != 0 {
        EmptyClipboard();
        CloseClipboard();
    }
}

// =========================================================================
// WINDOWS CREDENTIAL MANAGER HELPERS (WinCred API)
// =========================================================================

const KINANA_CRED_TARGET: &str = "kinana_vault_key\0";

unsafe fn store_vault_key_wincred(key: &str) -> Result<(), String> {
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

unsafe fn read_vault_key_wincred() -> Result<String, String> {
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
    Ok(key_str)
}

unsafe fn delete_vault_key_wincred() -> Result<(), String> {
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

const KINANA_RECOVERY_CRED_TARGET: &str = "kinana_recovery_code\0";

/// Cleans up any legacy recovery code from Windows Credential Store to ensure
/// that the emergency recovery code is strictly offline and never accessible locally by processes.
unsafe fn delete_recovery_code_wincred() {
    use windows_sys::Win32::Security::Credentials::{CredDeleteW, CRED_TYPE_GENERIC};
    let target_name: Vec<u16> = KINANA_RECOVERY_CRED_TARGET.encode_utf16().collect();
    let _ = CredDeleteW(target_name.as_ptr(), CRED_TYPE_GENERIC, 0);
}

// =========================================================================
// TAURI IPC COMMANDS
// =========================================================================

#[tauri::command]
async fn vault_exists(app: AppHandle) -> bool {
    match get_vault_path(&app) {
        Ok(path) => path.exists(),
        Err(_) => false,
    }
}

fn get_journal_path(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    let vault_path = get_vault_path(app)?;
    Ok(vault_path.with_extension("tx.journal"))
}

fn recover_interrupted_transactions_if_any(app: &AppHandle) -> Result<bool, String> {
    let journal_path = get_journal_path(app)?;
    TransactionJournal::recover(&journal_path).map_err(|e| e.to_string())
}

fn synchronize_and_heal_recovery_file(
    app: &AppHandle,
    storage: &VaultStorage,
    session: &mut VaultSession,
    password: &str,
) -> Result<String, String> {
    let rec_code = if let Some(ref code) = session.data.recovery_code {
        let c = code.clone();
        let recovery_path = get_recovery_file_path(app)?;
        
        // فحص التحقق والمواءمة الذاتية (Self-Healing Validation)
        // يكشف ويعالج تلقائياً أي انقطاع مفاجئ أو تلف سابق أدى لعدم تطابق recovery.dat مع الخزنة الحالية
        let mut needs_sync = !recovery_path.exists();
        if !needs_sync {
            match std::fs::read(&recovery_path) {
                Ok(rec_bytes) => {
                    if rec_bytes.len() >= kinana_core::crypto::MIN_VAULT_FILE_SIZE {
                        if let Ok(rec_hdr) = kinana_core::crypto::VaultHeader::from_bytes(&rec_bytes[0..kinana_core::crypto::HEADER_SIZE]) {
                            if let Ok(rec_key) = kinana_core::crypto::derive_key(&c, &rec_hdr.salt, &rec_hdr.argon2_params) {
                                match kinana_core::crypto::decrypt_payload(&rec_bytes, &rec_key) {
                                    Ok((_, decrypted_pwd)) => {
                                        if decrypted_pwd.as_slice() != password.as_bytes() {
                                            needs_sync = true;
                                        }
                                    }
                                    Err(_) => {
                                        needs_sync = true;
                                    }
                                }
                            } else {
                                needs_sync = true;
                            }
                        } else {
                            needs_sync = true;
                        }
                    } else {
                        needs_sync = true;
                    }
                }
                Err(_) => {
                    needs_sync = true;
                }
            }
        }

        if needs_sync {
            write_recovery_file(app, password, &c)
                .map_err(|e| format!("فشل تأمين ومواءمة ملف الاسترداد للخزنة: {}", e))?;
        }
        c
    } else {
        let new_code = generate_emergency_recovery_code();
        session.data.recovery_code = Some(new_code.clone());
        storage.save(session)
            .map_err(|e| format!("فشل ترقية بيانات الخزنة برمز الاسترداد الجديد: {}", e))?;
        write_recovery_file(app, password, &new_code)
            .map_err(|e| format!("فشل كتابة ملف الاسترداد الجديد للخزنة: {}", e))?;
        new_code
    };

    Ok(rec_code)
}

#[tauri::command]
async fn auto_unlock_vault(
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<bool, String> {
    recover_interrupted_transactions_if_any(&app)
        .map_err(|e| format!("خطأ أمني حرج: توجد معاملة سابقة غير مكتملة وفشلت استعادتها تلقائياً ({})", e))?;

    let saved_key = match unsafe { read_vault_key_wincred() } {
        Ok(k) => k,
        Err(_) => return Ok(false),
    };

    let vault_path = get_vault_path(&app)?;
    let storage = VaultStorage::new(&vault_path);
    if !storage.exists() {
        return Ok(false);
    }

    let mut saved_key = saved_key;
    let mut session = match storage.unlock(&saved_key) {
        Ok(s) => s,
        Err(e) => {
            saved_key.zeroize();
            return Err(e.to_string());
        }
    };

    // تطبيق آلية المواءمة والمعالجة الذاتية (Self-Healing) لملف الاسترداد في مسار الفتح التلقائي أيضاً
    let rec_code = match synchronize_and_heal_recovery_file(&app, &storage, &mut session, &saved_key) {
        Ok(c) => c,
        Err(e) => {
            saved_key.zeroize();
            return Err(e);
        }
    };
    saved_key.zeroize();

    if let Ok(mut rec_lock) = state.current_recovery_key.lock() {
        *rec_lock = Some(SecretString::new(rec_code));
    }

    let mut lock = state.session.lock().map_err(|e| e.to_string())?;
    *lock = Some(session);
    update_activity(&state);

    Ok(true)
}

#[tauri::command]
async fn is_auto_unlock_enabled() -> bool {
    unsafe { read_vault_key_wincred().is_ok() }
}

#[tauri::command]
async fn disable_auto_unlock() -> Result<(), String> {
    unsafe { delete_vault_key_wincred() }
}

#[tauri::command]
async fn enable_auto_unlock(
    password: String,
    app: AppHandle,
) -> Result<(), String> {
    let mut password = password;
    let vault_path = get_vault_path(&app)?;
    let storage = VaultStorage::new(&vault_path);
    let _ = storage.unlock(&password).map_err(|e| e.to_string())?;
    unsafe { store_vault_key_wincred(&password)? };
    password.zeroize();
    Ok(())
}

#[tauri::command]
async fn create_vault(
    password: String,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<(), String> {
    let mut password = password;
    if password.trim().len() < 8 {
        return Err("يجب أن تتكون كلمة المرور الرئيسية أو رمز الدخول من 8 خانات على الأقل لضمان حماية الخزنة ضد التخمين.".to_string());
    }

    let vault_path = get_vault_path(&app)?;
    let storage = VaultStorage::new(&vault_path);

    if storage.exists() {
        password.zeroize();
        return Err("Vault already exists. Use unlock instead.".to_string());
    }

    let mut session = storage
        .create_new_vault(&password, None)
        .map_err(|e| e.to_string())?;

    // Create fresh recovery code, embed into encrypted vault data, and save vault
    let code = generate_emergency_recovery_code();
    session.data.recovery_code = Some(code.clone());
    storage.save(&mut session).map_err(|e| e.to_string())?;

    // Create emergency recovery file with this exact recovery key
    write_recovery_file(&app, &password, &code)?;
    if let Ok(mut rec_lock) = state.current_recovery_key.lock() {
        *rec_lock = Some(SecretString::new(code));
    }

    // Zeroize password immediately after use
    password.zeroize();

    let mut lock = state.session.lock().map_err(|e| e.to_string())?;
    *lock = Some(session);
    update_activity(&state);

    Ok(())
}

#[tauri::command]
async fn unlock_vault(
    password: String,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<(), String> {
    recover_interrupted_transactions_if_any(&app)
        .map_err(|e| format!("خطأ أمني حرج: توجد معاملة سابقة غير مكتملة وفشلت استعادتها تلقائياً ({})", e))?;

    let mut password = password;
    let vault_path = get_vault_path(&app)?;
    let storage = VaultStorage::new(&vault_path);

    let mut session = storage.unlock(&password).map_err(|e| e.to_string())?;

    let rec_code = match synchronize_and_heal_recovery_file(&app, &storage, &mut session, &password) {
        Ok(c) => c,
        Err(e) => {
            password.zeroize();
            return Err(e);
        }
    };

    if let Ok(mut rec_lock) = state.current_recovery_key.lock() {
        *rec_lock = Some(SecretString::new(rec_code));
    }

    // Zeroize password immediately after use
    password.zeroize();

    let mut lock = state.session.lock().map_err(|e| e.to_string())?;
    *lock = Some(session);
    update_activity(&state);

    Ok(())
}

#[tauri::command]
async fn lock_vault(state: State<'_, AppState>) -> Result<(), String> {
    if let Ok(mut lock) = state.session.lock() {
        *lock = None;
    }
    if let Ok(mut rec_lock) = state.current_recovery_key.lock() {
        *rec_lock = None;
    }
    Ok(())
}

#[tauri::command]
async fn get_vault_summary(state: State<'_, AppState>) -> Result<VaultSummary, String> {
    let lock = state.session.lock().map_err(|e| e.to_string())?;
    let session = lock
        .as_ref()
        .ok_or_else(|| "No active vault session. Vault is locked.".to_string())?;

    update_activity(&state);

    // Returns sanitized summary only (zero passwords sent to JavaScript)
    Ok(session.data.to_summary())
}

#[tauri::command]
async fn copy_password(
    service_id: String,
    account_id: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let pwd_to_copy = {
        let lock = state.session.lock().map_err(|e| e.to_string())?;
        let session = lock
            .as_ref()
            .ok_or_else(|| "No active vault session. Vault is locked.".to_string())?;

        let pwd = session
            .data
            .get_account_password(&service_id, &account_id)
            .ok_or_else(|| format!("Account {} not found in service {}", account_id, service_id))?;

        if pwd.is_empty() {
            return Err("لا توجد كلمة مرور محفوظة لهذا الحساب".to_string());
        }

        pwd.to_string()
    };

    update_activity(&state);

    // Unsafe block: Interacts directly with Win32 clipboard memory pointers
    let seq = unsafe { copy_to_windows_clipboard_secure(&pwd_to_copy)? };

    // Wipe temporary string buffer
    let mut pwd_to_copy = pwd_to_copy;
    pwd_to_copy.zeroize();

    // Auto-clear clipboard after 15 seconds in background IF content was not overwritten
    tokio::spawn(async move {
        tokio::time::sleep(Duration::from_secs(15)).await;
        unsafe {
            use windows_sys::Win32::System::DataExchange::GetClipboardSequenceNumber;
            if GetClipboardSequenceNumber() == seq {
                clear_windows_clipboard();
            }
        }
    });

    Ok(())
}


#[tauri::command]
async fn add_service(
    name: String,
    icon_base64: Option<String>,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<VaultSummary, String> {
    if let Some(ref icon) = icon_base64 {
        if icon.len() > 500_000 {
            return Err("حجم الصورة يتجاوز الحد الأقصى المسموح (500 كيلوبايت)".to_string());
        }
    }

    let trimmed_name = name.trim();
    if trimmed_name.is_empty() {
        return Err("Service name cannot be empty".to_string());
    }

    let vault_path = get_vault_path(&app)?;
    let storage = VaultStorage::new(&vault_path);

    let mut lock = state.session.lock().map_err(|e| e.to_string())?;
    let session = lock
        .as_mut()
        .ok_or_else(|| "No active vault session. Vault is locked.".to_string())?;

    let service_id = uuid::Uuid::new_v4().to_string();
    let new_service = Service {
        id: service_id,
        name: trimmed_name.to_string(),
        icon_data: icon_base64,
        accounts: Vec::new(),
    };

    session.data.services.push(new_service);
    session.data.updated_at = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);

    storage.save(session).map_err(|e| e.to_string())?;
    update_activity(&state);

    Ok(session.data.to_summary())
}

#[tauri::command]
async fn delete_service(
    service_id: String,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<VaultSummary, String> {
    let vault_path = get_vault_path(&app)?;
    let storage = VaultStorage::new(&vault_path);

    let mut lock = state.session.lock().map_err(|e| e.to_string())?;
    let session = lock
        .as_mut()
        .ok_or_else(|| "No active vault session. Vault is locked.".to_string())?;

    let initial_len = session.data.services.len();
    session.data.services.retain(|s| s.id != service_id);

    if session.data.services.len() == initial_len {
        return Err(format!("Service with ID '{}' not found", service_id));
    }

    session.data.updated_at = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);

    storage.save(session).map_err(|e| e.to_string())?;
    update_activity(&state);

    Ok(session.data.to_summary())
}

#[tauri::command]
async fn delete_multiple_services(
    service_ids: Vec<String>,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<VaultSummary, String> {
    let vault_path = get_vault_path(&app)?;
    let storage = VaultStorage::new(&vault_path);

    let mut lock = state.session.lock().map_err(|e| e.to_string())?;
    let session = lock
        .as_mut()
        .ok_or_else(|| "الخزنة مقفلة. يرجى فتح الخزنة أولاً.".to_string())?;

    let set: std::collections::HashSet<String> = service_ids.into_iter().collect();
    session.data.services.retain(|s| !set.contains(&s.id));

    session.data.updated_at = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);

    storage.save(session).map_err(|e| e.to_string())?;
    update_activity(&state);

    Ok(session.data.to_summary())
}

#[tauri::command]
async fn duplicate_service(
    service_id: String,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<VaultSummary, String> {
    let vault_path = get_vault_path(&app)?;
    let storage = VaultStorage::new(&vault_path);

    let mut lock = state.session.lock().map_err(|e| e.to_string())?;
    let session = lock
        .as_mut()
        .ok_or_else(|| "الخزنة مقفلة. يرجى فتح الخزنة أولاً.".to_string())?;

    let source_index = session
        .data
        .services
        .iter()
        .position(|s| s.id == service_id)
        .ok_or_else(|| format!("الخدمة بالمعرف '{}' غير موجودة", service_id))?;

    let source = &session.data.services[source_index];

    let cloned_accounts = source
        .accounts
        .iter()
        .map(|acc| Account {
            id: uuid::Uuid::new_v4().to_string(),
            label: acc.label.clone(),
            username: acc.username.clone(),
            password: SecretString::new(acc.password.as_str().to_string()),
            notes: acc.notes.clone(),
            url: acc.url.clone(),
        })
        .collect();

    let cloned_service = Service {
        id: uuid::Uuid::new_v4().to_string(),
        name: format!("{} (نسخة)", source.name),
        icon_data: source.icon_data.clone(),
        accounts: cloned_accounts,
    };

    session.data.services.insert(source_index + 1, cloned_service);
    session.data.updated_at = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);

    storage.save(session).map_err(|e| e.to_string())?;
    update_activity(&state);

    Ok(session.data.to_summary())
}

#[tauri::command]
async fn reorder_services(
    service_ids: Vec<String>,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<VaultSummary, String> {
    let vault_path = get_vault_path(&app)?;
    let storage = VaultStorage::new(&vault_path);

    let mut lock = state.session.lock().map_err(|e| e.to_string())?;
    let session = lock
        .as_mut()
        .ok_or_else(|| "No active vault session. Vault is locked.".to_string())?;

    let mut ordered: Vec<Service> = Vec::with_capacity(session.data.services.len());
    let mut remaining = std::mem::take(&mut session.data.services);

    for id in service_ids {
        if let Some(pos) = remaining.iter().position(|s| s.id == id) {
            ordered.push(remaining.swap_remove(pos));
        }
    }
    ordered.append(&mut remaining);

    session.data.services = ordered;
    session.data.updated_at = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);

    storage.save(session).map_err(|e| e.to_string())?;
    update_activity(&state);

    Ok(session.data.to_summary())
}

#[tauri::command]
fn ping_activity(state: State<'_, AppState>) -> Result<(), String> {
    update_activity(&state);
    Ok(())
}

#[tauri::command]
fn set_auto_lock_timeout(seconds: Option<u64>, state: State<'_, AppState>) -> Result<(), String> {
    if let Ok(mut timeout) = state.auto_lock_timeout_secs.lock() {
        *timeout = seconds;
    }
    update_activity(&state);
    Ok(())
}

#[tauri::command]
fn get_auto_lock_timeout(state: State<'_, AppState>) -> Result<Option<u64>, String> {
    state
        .auto_lock_timeout_secs
        .lock()
        .map(|guard| *guard)
        .map_err(|e| e.to_string())
}

fn get_recovery_file_path(app: &AppHandle) -> Result<PathBuf, String> {
    let app_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to resolve app data directory: {}", e))?;
    Ok(app_dir.join("recovery.dat"))
}

#[derive(serde::Serialize, serde::Deserialize)]
struct RecoveryDataFile {
    recovery_code: String,
    encrypted_payload: Vec<u8>,
}

fn generate_emergency_recovery_code() -> String {
    use rand::RngCore;
    use rand::rngs::OsRng;
    let chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let mut rng = OsRng;
    let mut code_parts = Vec::new();
    for _ in 0..4 {
        let part: String = (0..4).map(|_| {
            let idx = (rng.next_u32() as usize) % chars.len();
            chars.chars().nth(idx).unwrap()
        }).collect();
        code_parts.push(part);
    }
    format!("KN-{}", code_parts.join("-"))
}

fn write_recovery_file(app: &AppHandle, master_password: &str, recovery_code: &str) -> Result<(), String> {
    let recovery_path = get_recovery_file_path(app)?;
    let clean_code = recovery_code.trim().to_uppercase();

    let params = kinana_core::crypto::Argon2Parameters::default();
    let header = kinana_core::crypto::VaultHeader::new_with_fresh_salts(params).map_err(|e| e.to_string())?;
    let key = kinana_core::crypto::derive_key(&clean_code, &header.salt, &header.argon2_params).map_err(|e| e.to_string())?;
    let encrypted_payload = kinana_core::crypto::encrypt_payload(master_password.as_bytes(), &key, &header)
        .map_err(|e| e.to_string())?;

    // Write raw encrypted binary payload atomically via temporary file
    let tmp_path = recovery_path.with_extension("dat.tmp");
    std::fs::write(&tmp_path, &encrypted_payload).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp_path, &recovery_path).map_err(|e| e.to_string())?;

    // Ensure NO recovery code is stored in Windows Credential Store (strictly offline user recovery key)
    unsafe { delete_recovery_code_wincred(); }

    Ok(())
}

#[tauri::command]
async fn update_service(
    service_id: String,
    name: String,
    icon_base64: Option<String>,
    keep_existing_icon: bool,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<VaultSummary, String> {
    if let Some(ref icon) = icon_base64 {
        if icon.len() > 500_000 {
            return Err("حجم الصورة يتجاوز الحد الأقصى المسموح (500 كيلوبايت)".to_string());
        }
    }

    let trimmed_name = name.trim();
    if trimmed_name.is_empty() {
        return Err("اسم الخدمة لا يمكن أن يكون فارغاً".to_string());
    }

    let vault_path = get_vault_path(&app)?;
    let storage = VaultStorage::new(&vault_path);

    let mut lock = state.session.lock().map_err(|e| e.to_string())?;
    let session = lock
        .as_mut()
        .ok_or_else(|| "الخزنة مقفلة. يرجى فتح الخزنة أولاً.".to_string())?;

    let service = session
        .data
        .services
        .iter_mut()
        .find(|s| s.id == service_id)
        .ok_or_else(|| format!("الخدمة بالمعرف '{}' غير موجودة", service_id))?;

    service.name = trimmed_name.to_string();
    if !keep_existing_icon {
        service.icon_data = icon_base64;
    }

    session.data.updated_at = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);

    storage.save(session).map_err(|e| e.to_string())?;
    update_activity(&state);

    Ok(session.data.to_summary())
}

#[tauri::command]
async fn change_master_password(
    new_password: String,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<(), String> {
    let mut new_password = new_password;
    if new_password.trim().len() < 8 {
        return Err("يجب أن تتكون كلمة المرور الرئيسية أو رمز الدخول الجديد من 8 خانات على الأقل لضمان حماية الخزنة ضد التخمين.".to_string());
    }

    let vault_path = get_vault_path(&app)?;
    let storage = VaultStorage::new(&vault_path);

    let mut lock = state.session.lock().map_err(|e| e.to_string())?;
    let session = lock
        .as_mut()
        .ok_or_else(|| "الخزنة مقفلة. يرجى فتح الخزنة أولاً لتغيير كلمة المرور.".to_string())?;

    // 1. احفظ المفتاح القديم والهيدر مؤقتاً
    let old_key = kinana_core::crypto::DerivedKey::new(*session.key.as_bytes());
    let old_header = kinana_core::crypto::VaultHeader {
        magic: session.header.magic,
        version: session.header.version,
        argon2_params: session.header.argon2_params,
        salt: session.header.salt,
        nonce: session.header.nonce,
    };

    // 2. تأمين نسخة احتياطية مخصصة ومستقلة للتراجع (Rollback Safety Backup)
    let rekey_backup = vault_path.with_extension("dat.rekey_safety");
    std::fs::copy(&vault_path, &rekey_backup)
        .map_err(|e| format!("فشل تأمين نسخة أمان قبل تغيير كلمة المرور: {}", e))?;

    let rec_path = get_recovery_file_path(&app)?;
    let had_recovery_file = rec_path.exists();
    let rec_backup = rec_path.with_extension("dat.rekey_safety");
    if had_recovery_file {
        if let Err(e) = std::fs::copy(&rec_path, &rec_backup) {
            let _ = std::fs::remove_file(&rekey_backup);
            return Err(format!("فشل تأمين نسخة احتياطية من ملف الاسترداد: {}", e));
        }
    }

    // 2.5 تسجيل المعاملة في دفتر المعاملات الذري لضمان التعافي التلقائي عند انقطاع التيار (Transaction Journal)
    let journal_path = get_journal_path(&app)?;
    let mut journal = TransactionJournal::new(
        "rekey",
        vault_path.clone(),
        rec_path.clone(),
        Some(rekey_backup.clone()),
        if had_recovery_file { Some(rec_backup.clone()) } else { None },
        false,
    ).map_err(|e| format!("فشل حساب بصمات الأمان للمعاملة: {}", e))?;

    journal.write_to_disk(&journal_path).map_err(|e| {
        let _ = std::fs::remove_file(&rekey_backup);
        if had_recovery_file { let _ = std::fs::remove_file(&rec_backup); }
        format!("فشل تسجيل دفتر المعاملات لضمان التعافي من الانهيار: {}", e)
    })?;

    // 3. أنشئ هيدر ومفتاح جديدين
    let new_header = kinana_core::crypto::VaultHeader::new_with_fresh_salts(session.header.argon2_params)
        .map_err(|e| {
            let _ = journal.commit_and_cleanup(&journal_path);
            e.to_string()
        })?;
    let new_key = kinana_core::crypto::derive_key(&new_password, &new_header.salt, &new_header.argon2_params)
        .map_err(|e| {
            let _ = journal.commit_and_cleanup(&journal_path);
            e.to_string()
        })?;

    session.header = new_header;
    session.key = new_key;
    session.data.updated_at = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);

    // 4. احفظ بالمفتاح الجديد ذرياً
    if let Err(e) = storage.save_rekey(session, &old_key) {
        let _ = journal.commit_and_cleanup(&journal_path);
        session.key = old_key;
        session.header = old_header;
        return Err(format!("فشل حفظ الخزنة بالمفتاح الجديد: {}", e));
    }

    // 5. تحديث ملف الاسترداد وإذا فشل التحديث، يتم التراجع المفحوص بدقة قطعية
    let recovery_code = if let Some(ref c) = session.data.recovery_code {
        c.clone()
    } else {
        let fresh = generate_emergency_recovery_code();
        session.data.recovery_code = Some(fresh.clone());
        fresh
    };

    if let Err(err_rec) = write_recovery_file(&app, &new_password, &recovery_code) {
        // لا نحذف دفتر المعاملات هنا، بل نتركه حياً لضمان التعافي عند الإقلاع في حال انقطاع التيار أثناء التراجع
        let tmp_rollback = vault_path.with_extension("dat.rollback_tmp");
        let copy_tmp_res = std::fs::copy(&rekey_backup, &tmp_rollback);
        
        let restore_vault_res = copy_tmp_res
            .map_err(|e| e.to_string())
            .and_then(|_| {
                // فحص عملي: التأكد من فك تشفير الملف المستعاد بالمفتاح القديم قبل الاستبدال الذري
                let bytes = std::fs::read(&tmp_rollback).map_err(|e| e.to_string())?;
                kinana_core::crypto::decrypt_payload(&bytes, &old_key).map_err(|e| e.to_string())?;
                // استبدال ذري للملف عبر rename
                std::fs::rename(&tmp_rollback, &vault_path).map_err(|e| e.to_string())
            });

        let restore_rec_res = if had_recovery_file && rec_backup.exists() {
            let tmp_rec_rollback = rec_path.with_extension("dat.rollback_tmp");
            match std::fs::copy(&rec_backup, &tmp_rec_rollback) {
                Ok(_) => {
                    let res = std::fs::rename(&tmp_rec_rollback, &rec_path);
                    let _ = std::fs::remove_file(&tmp_rec_rollback);
                    res.map_err(|e| e.to_string())
                }
                Err(e) => Err(e.to_string()),
            }
        } else {
            Ok(())
        };

        if let Err(vault_err) = restore_vault_res {
            let _ = std::fs::remove_file(&tmp_rollback);
            new_password.zeroize();
            return Err(format!(
                "خطأ حرج: تعذر تحديث ملف الاسترداد ({}) وفشلت استعادة ملف الخزنة السابق ({}). تم الاحتفاظ بدفتر المعاملات ونسخة الأمان في: {}",
                err_rec, vault_err, rekey_backup.display()
            ));
        }

        if let Err(rec_err) = restore_rec_res {
            new_password.zeroize();
            return Err(format!(
                "تعذر تحديث ملف الاسترداد ({}) واستُعيدت الخزنة بنجاح لكن تعذرت استعادة ملف الاسترداد السابق ({}). تم الاحتفاظ بدفتر المعاملات ونسخة الاسترداد في: {}",
                err_rec, rec_err, rec_backup.display()
            ));
        }

        // تم استعادة والتحقق من الملفين بنجاح قطعي: الآن فقط يُغلق الدفتر وتُنظف نسخ الأمان
        let _ = journal.rollback_and_cleanup(&journal_path);

        session.header = old_header;
        session.key = old_key;
        new_password.zeroize();
        return Err(format!(
            "فشل كتابة ملف الاسترداد بالمفتاح الجديد: {}. تم التراجع الذري بنجاح واستعادة الخزنة وملف الاسترداد والتحقق قطعيّاً من سلامتهما بكلمة المرور القديمة.",
            err_rec
        ));
    }

    // إغلاق دفتر المعاملة بنجاح وتنظيف ملفات الأمان المؤقتة
    let _ = journal.commit_and_cleanup(&journal_path);

    if let Ok(mut rec_lock) = state.current_recovery_key.lock() {
        *rec_lock = Some(SecretString::new(recovery_code));
    }

    // 5. إذا كان الفتح التلقائي مفعلاً مسبقاً، حدّث المفتاح في WinCred مع فحص الخطأ
    if unsafe { read_vault_key_wincred().is_ok() } {
        if let Err(e) = unsafe { store_vault_key_wincred(&new_password) } {
            return Err(format!("تم حفظ الخزنة بالمفتاح الجديد ولكن تعذر تحديث الفتح التلقائي: {}", e));
        }
    }

    // 6. تنظيف النسخ الاحتياطية القديمة لمنع فكها بكلمة المرور السابقة
    let backup_safety = vault_path.with_extension("dat.bak");
    if backup_safety.exists() {
        let _ = std::fs::remove_file(backup_safety);
    }

    new_password.zeroize();
    update_activity(&state);

    Ok(())
}

#[tauri::command]
async fn get_current_saved_password(state: State<'_, AppState>) -> Result<String, String> {
    let lock = state.session.lock().map_err(|e| e.to_string())?;
    if lock.is_none() {
        return Err("الخزنة مقفلة".to_string());
    }
    unsafe { read_vault_key_wincred() }
}

#[tauri::command]
async fn get_or_generate_recovery_key(
    state: State<'_, AppState>,
) -> Result<String, String> {
    let lock = state.session.lock().map_err(|e| e.to_string())?;
    let session = lock
        .as_ref()
        .ok_or_else(|| "الخزنة مقفلة. يرجى فتح الخزنة أولاً لعرض مفتاح الاسترداد.".to_string())?;

    if let Ok(rec_lock) = state.current_recovery_key.lock() {
        if let Some(ref key) = *rec_lock {
            return Ok(key.as_str().to_string());
        }
    }

    if let Some(ref code) = session.data.recovery_code {
        if let Ok(mut rec_lock) = state.current_recovery_key.lock() {
            *rec_lock = Some(SecretString::new(code.clone()));
        }
        return Ok(code.clone());
    }

    Err("لم يتم العثور على مفتاح استرداد للخزنة.".to_string())
}

#[tauri::command]
async fn recover_vault_with_key(
    recovery_code: String,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<(), String> {
    recover_interrupted_transactions_if_any(&app)
        .map_err(|e| format!("خطأ أمني حرج: توجد معاملة سابقة غير مكتملة وفشلت استعادتها تلقائياً ({})", e))?;

    let clean_code = recovery_code.trim().to_uppercase();
    let recovery_path = get_recovery_file_path(&app)?;
    if !recovery_path.exists() {
        return Err("ملف الاسترداد غير موجود على هذا الجهاز.".to_string());
    }

    let bytes = std::fs::read(&recovery_path).map_err(|e| e.to_string())?;
    
    // Support pure encrypted binary payload (standard) or legacy JSON migration
    let payload = if bytes.starts_with(kinana_core::crypto::MAGIC_BYTES) {
        bytes
    } else if let Ok(file_data) = serde_json::from_slice::<RecoveryDataFile>(&bytes) {
        file_data.encrypted_payload
    } else {
        bytes
    };

    if payload.len() < kinana_core::crypto::MIN_VAULT_FILE_SIZE {
        return Err("بيانات الاسترداد تالفة أو قصيرة جداً".to_string());
    }

    let header = kinana_core::crypto::VaultHeader::from_bytes(&payload[0..kinana_core::crypto::HEADER_SIZE])
        .map_err(|_| "بيانات ترويسة الاسترداد غير صالحة".to_string())?;

    let key = kinana_core::crypto::derive_key(&clean_code, &header.salt, &header.argon2_params)
        .map_err(|_| "مفتاح الاسترداد غير صحيح".to_string())?;

    let (_header, plaintext) = kinana_core::crypto::decrypt_payload(&payload, &key)
        .map_err(|_| "مفتاح الاسترداد المدخل غير مطابق أو غير صحيح!".to_string())?;

    let master_pwd = String::from_utf8(plaintext.to_vec()).map_err(|_| "فشل فك تشفير كلمة المرور".to_string())?;

    let vault_path = get_vault_path(&app)?;
    let storage = VaultStorage::new(&vault_path);
    let mut session = storage.unlock(&master_pwd).map_err(|e| e.to_string())?;

    // Ensure session data recovery code matches the key used
    if session.data.recovery_code.as_deref() != Some(&clean_code) {
        session.data.recovery_code = Some(clean_code.clone());
        let _ = storage.save(&mut session);
    }

    // Keep recovery key in memory for this session and delete any old unencrypted WinCred entry
    unsafe { delete_recovery_code_wincred(); }

    if let Ok(mut rec_lock) = state.current_recovery_key.lock() {
        *rec_lock = Some(SecretString::new(clean_code));
    }

    let mut lock = state.session.lock().map_err(|e| e.to_string())?;
    *lock = Some(session);
    update_activity(&state);

    Ok(())
}

#[derive(serde::Serialize, serde::Deserialize, Debug, Clone)]
pub struct AccountDetail {
    pub id: String,
    pub label: String,
    pub username: String,
    pub email: String,
    pub url: String,
    pub has_password: bool,
    pub has_recovery_key: bool,
    pub has_notes: bool,
    pub has_pin: bool,
    pub password: Option<String>,
    pub recovery_key: Option<String>,
    pub notes: Option<String>,
}

#[derive(serde::Serialize, serde::Deserialize, Default)]
struct AccountMetaPayload {
    #[serde(default)]
    email: String,
    #[serde(default)]
    recovery_key: String,
    #[serde(default)]
    notes: String,
}

fn unpack_account_notes(raw_notes: Option<&str>) -> (String, String, String) {
    if let Some(s) = raw_notes {
        let trimmed = s.trim();
        if trimmed.starts_with('{') && trimmed.ends_with('}') {
            if let Ok(meta) = serde_json::from_str::<AccountMetaPayload>(trimmed) {
                return (meta.email, meta.recovery_key, meta.notes);
            }
        }
        (String::new(), String::new(), trimmed.to_string())
    } else {
        (String::new(), String::new(), String::new())
    }
}

fn pack_account_notes(email: &str, recovery_key: &str, notes: &str) -> Option<String> {
    let email_t = email.trim();
    let rec_t = recovery_key.trim();
    let notes_t = notes.trim();

    if email_t.is_empty() && rec_t.is_empty() && notes_t.is_empty() {
        return None;
    }

    if email_t.is_empty() && rec_t.is_empty() {
        return Some(notes_t.to_string());
    }

    let meta = AccountMetaPayload {
        email: email_t.to_string(),
        recovery_key: rec_t.to_string(),
        notes: notes_t.to_string(),
    };

    serde_json::to_string(&meta).ok()
}

#[tauri::command]
async fn get_service_accounts(
    service_id: String,
    state: State<'_, AppState>,
) -> Result<Vec<AccountDetail>, String> {
    let lock = state.session.lock().map_err(|e| e.to_string())?;
    let session = lock
        .as_ref()
        .ok_or_else(|| "الخزنة مقفلة. يرجى فتح الخزنة أولاً.".to_string())?;

    let service = session
        .data
        .services
        .iter()
        .find(|s| s.id == service_id)
        .ok_or_else(|| format!("الخدمة بالمعرف '{}' غير موجودة", service_id))?;

    let accounts = service
        .accounts
        .iter()
        .map(|acc| {
            let (email, recovery_key, notes) = unpack_account_notes(acc.notes.as_deref());
            let has_rec = !recovery_key.trim().is_empty();
            let has_pin = notes.contains("PIN:");
            let has_notes = !notes.trim().is_empty();
            let safe_notes = if has_pin {
                let filtered: Vec<&str> = notes.lines().filter(|l| !l.trim().starts_with("PIN:")).collect();
                if filtered.is_empty() { None } else { Some(filtered.join("\n")) }
            } else if has_notes {
                Some(notes)
            } else {
                None
            };

            AccountDetail {
                id: acc.id.clone(),
                label: acc.label.clone(),
                username: acc.username.clone(),
                email,
                url: acc.url.clone().unwrap_or_default(),
                has_password: !acc.password.0.is_empty(),
                has_recovery_key: has_rec,
                has_notes,
                has_pin,
                password: None,
                recovery_key: None,
                notes: safe_notes,
            }
        })
        .collect();

    update_activity(&state);
    Ok(accounts)
}

#[tauri::command]
async fn get_account_password(
    service_id: String,
    account_id: String,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let lock = state.session.lock().map_err(|e| e.to_string())?;
    let session = lock
        .as_ref()
        .ok_or_else(|| "الخزنة مقفلة. يرجى فتح الخزنة أولاً.".to_string())?;

    let pwd = session
        .data
        .get_account_password(&service_id, &account_id)
        .ok_or_else(|| format!("Account {} not found in service {}", account_id, service_id))?;

    update_activity(&state);
    Ok(pwd.to_string())
}

#[tauri::command]
async fn get_account_recovery_key(
    service_id: String,
    account_id: String,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let lock = state.session.lock().map_err(|e| e.to_string())?;
    let session = lock
        .as_ref()
        .ok_or_else(|| "الخزنة مقفلة. يرجى فتح الخزنة أولاً.".to_string())?;

    let service = session
        .data
        .services
        .iter()
        .find(|s| s.id == service_id)
        .ok_or_else(|| format!("الخدمة بالمعرف '{}' غير موجودة", service_id))?;

    let acc = service
        .accounts
        .iter()
        .find(|a| a.id == account_id)
        .ok_or_else(|| format!("الحساب بالمعرف '{}' غير موجود", account_id))?;

    let (_, recovery_key, _) = unpack_account_notes(acc.notes.as_deref());
    update_activity(&state);
    Ok(recovery_key)
}

#[tauri::command]
async fn get_account_pin(
    service_id: String,
    account_id: String,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let lock = state.session.lock().map_err(|e| e.to_string())?;
    let session = lock
        .as_ref()
        .ok_or_else(|| "الخزنة مقفلة. يرجى فتح الخزنة أولاً.".to_string())?;

    let service = session
        .data
        .services
        .iter()
        .find(|s| s.id == service_id)
        .ok_or_else(|| format!("الخدمة بالمعرف '{}' غير موجودة", service_id))?;

    let acc = service
        .accounts
        .iter()
        .find(|a| a.id == account_id)
        .ok_or_else(|| format!("الحساب بالمعرف '{}' غير موجود", account_id))?;

    let (_, _, notes) = unpack_account_notes(acc.notes.as_deref());
    for line in notes.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with("PIN:") {
            let pin = trimmed["PIN:".len()..].trim();
            update_activity(&state);
            return Ok(pin.to_string());
        }
    }
    update_activity(&state);
    Ok(String::new())
}

#[tauri::command]
async fn copy_account_recovery_key(
    service_id: String,
    account_id: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let key = get_account_recovery_key(service_id, account_id, state.clone()).await?;
    copy_secure_text(key, state).await
}

#[tauri::command]
async fn copy_account_pin(
    service_id: String,
    account_id: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let pin = get_account_pin(service_id, account_id, state.clone()).await?;
    copy_secure_text(pin, state).await
}

#[tauri::command]
async fn copy_secure_text(
    text: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    if text.is_empty() {
        return Err("النص المراد نسخه فارغ".to_string());
    }

    update_activity(&state);

    let mut text_buf = text;
    let seq = unsafe {
        copy_to_windows_clipboard_secure(&text_buf)?
    };
    text_buf.zeroize();

    tokio::spawn(async move {
        tokio::time::sleep(Duration::from_secs(15)).await;
        unsafe {
            use windows_sys::Win32::System::DataExchange::GetClipboardSequenceNumber;
            if GetClipboardSequenceNumber() == seq {
                clear_windows_clipboard();
            }
        }
    });

    Ok(())
}

#[tauri::command]
async fn add_account(
    service_id: String,
    label: Option<String>,
    username: Option<String>,
    password: Option<String>,
    email: Option<String>,
    recovery_key: Option<String>,
    notes: Option<String>,
    url: Option<String>,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<VaultSummary, String> {
    let secret_password = if let Some(mut p) = password {
        let sec = SecretString::new(p.clone());
        p.zeroize();
        sec
    } else {
        SecretString::new(String::new())
    };

    let packed_notes = pack_account_notes(
        email.as_deref().unwrap_or(""),
        recovery_key.as_deref().unwrap_or(""),
        notes.as_deref().unwrap_or(""),
    );

    let clean_url = url.and_then(|u| {
        let trimmed = u.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed.to_string())
        }
    });

    let vault_path = get_vault_path(&app)?;
    let storage = VaultStorage::new(&vault_path);

    let mut lock = state.session.lock().map_err(|e| e.to_string())?;
    let session = lock
        .as_mut()
        .ok_or_else(|| "No active vault session. Vault is locked.".to_string())?;

    let service = session
        .data
        .services
        .iter_mut()
        .find(|s| s.id == service_id)
        .ok_or_else(|| format!("Service with ID '{}' not found", service_id))?;

    let account_id = uuid::Uuid::new_v4().to_string();
    let new_account = Account {
        id: account_id,
        label: label.unwrap_or_else(|| "الحساب الرئيسي".to_string()),
        username: username.unwrap_or_default(),
        password: secret_password,
        notes: packed_notes,
        url: clean_url,
    };

    service.accounts.push(new_account);
    session.data.updated_at = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);

    storage.save(session).map_err(|e| e.to_string())?;
    update_activity(&state);

    Ok(session.data.to_summary())
}

#[tauri::command]
async fn delete_account(
    service_id: String,
    account_id: String,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<VaultSummary, String> {
    let vault_path = get_vault_path(&app)?;
    let storage = VaultStorage::new(&vault_path);

    let mut lock = state.session.lock().map_err(|e| e.to_string())?;
    let session = lock
        .as_mut()
        .ok_or_else(|| "No active vault session. Vault is locked.".to_string())?;

    let service = session
        .data
        .services
        .iter_mut()
        .find(|s| s.id == service_id)
        .ok_or_else(|| format!("Service with ID '{}' not found", service_id))?;

    let initial_len = service.accounts.len();
    service.accounts.retain(|a| a.id != account_id);

    if service.accounts.len() == initial_len {
        return Err(format!(
            "Account with ID '{}' not found in service '{}'",
            account_id, service_id
        ));
    }

    session.data.updated_at = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);

    storage.save(session).map_err(|e| e.to_string())?;
    update_activity(&state);

    Ok(session.data.to_summary())
}

#[tauri::command]
async fn update_account(
    service_id: String,
    account_id: String,
    label: Option<String>,
    username: Option<String>,
    password: Option<String>,
    email: Option<String>,
    recovery_key: Option<String>,
    notes: Option<String>,
    url: Option<String>,
    clear_recovery_key: Option<bool>,
    clear_pin: Option<bool>,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<VaultSummary, String> {
    let mut password = password;
    let new_secret_pwd = if let Some(ref mut p) = password {
        let sec = SecretString::new(p.clone());
        p.zeroize();
        Some(sec)
    } else {
        None
    };

    let vault_path = get_vault_path(&app)?;
    let storage = VaultStorage::new(&vault_path);

    let mut lock = state.session.lock().map_err(|e| e.to_string())?;
    let session = lock
        .as_mut()
        .ok_or_else(|| "No active vault session. Vault is locked.".to_string())?;

    let service = session
        .data
        .services
        .iter_mut()
        .find(|s| s.id == service_id)
        .ok_or_else(|| format!("Service with ID '{}' not found", service_id))?;

    let account = service
        .accounts
        .iter_mut()
        .find(|a| a.id == account_id)
        .ok_or_else(|| {
            format!(
                "Account with ID '{}' not found in service '{}'",
                account_id, service_id
            )
        })?;

    let (existing_email, existing_recovery_key, existing_notes) = unpack_account_notes(account.notes.as_deref());

    let final_email = email.unwrap_or(existing_email);

    // Three-state logic for recovery key (CVV or account recovery key):
    // 1. Explicit clear (clear_recovery_key == true) -> ""
    // 2. Explicit update (non-empty recovery_key provided) -> new value
    // 3. Keep existing (empty/None without explicit clear) -> existing_recovery_key
    let final_recovery_key = if clear_recovery_key.unwrap_or(false) {
        String::new()
    } else {
        match recovery_key {
            Some(r) => {
                let trimmed = r.trim().to_string();
                if trimmed.is_empty() {
                    existing_recovery_key
                } else {
                    trimmed
                }
            }
            None => existing_recovery_key,
        }
    };

    // Three-state logic for card PIN:
    let should_clear_pin = clear_pin.unwrap_or(false);
    let existing_pin_line = if should_clear_pin {
        None
    } else {
        existing_notes
            .lines()
            .find(|l| l.trim().starts_with("PIN:"))
            .map(|l| l.trim().to_string())
    };

    let final_notes = match notes {
        Some(n) => {
            let trimmed = n.trim().to_string();
            if should_clear_pin {
                let clean: Vec<&str> = trimmed.lines().filter(|l| !l.trim().starts_with("PIN:")).collect();
                clean.join("\n")
            } else if trimmed.is_empty() {
                if let Some(pin) = existing_pin_line {
                    pin
                } else {
                    String::new()
                }
            } else if !trimmed.contains("PIN:") && existing_pin_line.is_some() {
                let pin = existing_pin_line.unwrap();
                if trimmed.starts_with("[CARD]") {
                    let rest = trimmed["[CARD]".len()..].trim();
                    if rest.is_empty() {
                        format!("[CARD]\n{}", pin)
                    } else {
                        format!("[CARD]\n{}\n{}", pin, rest)
                    }
                } else {
                    format!("{}\n{}", pin, trimmed)
                }
            } else {
                trimmed
            }
        }
        None => {
            if should_clear_pin {
                let clean: Vec<&str> = existing_notes.lines().filter(|l| !l.trim().starts_with("PIN:")).collect();
                clean.join("\n")
            } else {
                existing_notes
            }
        }
    };

    let packed_notes = pack_account_notes(&final_email, &final_recovery_key, &final_notes);

    let clean_url = url.and_then(|u| {
        let trimmed = u.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed.to_string())
        }
    });

    if let Some(lbl) = label {
        account.label = lbl;
    }
    if let Some(user) = username {
        account.username = user;
    }
    if let Some(sec) = new_secret_pwd {
        account.password = sec;
    }
    account.notes = packed_notes;
    account.url = clean_url;

    session.data.updated_at = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);

    storage.save(session).map_err(|e| e.to_string())?;
    update_activity(&state);

    Ok(session.data.to_summary())
}

#[tauri::command]
async fn generate_password(length: u8, use_symbols: bool) -> Result<String, String> {
    if !(12..=64).contains(&length) {
        return Err("Password length must be between 12 and 64 characters".to_string());
    }

    let mut charset: Vec<u8> = b"abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789".to_vec();
    if use_symbols {
        charset.extend_from_slice(b"!@#$%^&*");
    }

    use rand::RngCore;
    let mut rng = rand::rngs::OsRng;
    let len = charset.len();
    let max_valid = 256 - (256 % len);
    let mut result = String::with_capacity(length as usize);

    for _ in 0..length {
        let mut byte = [0u8; 1];
        loop {
            rng.fill_bytes(&mut byte);
            let val = byte[0] as usize;
            if val < max_valid {
                result.push(charset[val % len] as char);
                break;
            }
        }
    }

    Ok(result)
}

#[tauri::command]
async fn toggle_fullscreen(window: tauri::WebviewWindow) -> Result<bool, String> {
    let current = window.is_fullscreen().map_err(|e| e.to_string())?;
    let next = !current;
    if next {
        let _ = window.set_decorations(false);
        window.set_fullscreen(true).map_err(|e| e.to_string())?;
    } else {
        window.set_fullscreen(false).map_err(|e| e.to_string())?;
        let _ = window.set_decorations(true);
    }
    Ok(next)
}

#[tauri::command]
async fn is_fullscreen(window: tauri::WebviewWindow) -> Result<bool, String> {
    window.is_fullscreen().map_err(|e| e.to_string())
}

#[tauri::command]
async fn export_vault_backup(app: AppHandle) -> Result<Option<String>, String> {
    let vault_path = get_vault_path(&app)?;
    if !vault_path.exists() {
        return Err("لا توجد بيانات خزنة محفوظة لتصديرها حالياً.".to_string());
    }

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let default_name = format!("kinana_vault_backup_{}.dat", now);

    let file_dest = rfd::AsyncFileDialog::new()
        .set_title("تصدير وحفظ نسخة احتياطية مشفرة من الخزنة")
        .add_filter("ملف خزنة كنانة (*.dat, *.kinana)", &["dat", "kinana"])
        .set_file_name(&default_name)
        .save_file()
        .await;

    if let Some(file_handle) = file_dest {
        let dest_path = file_handle.path();
        std::fs::copy(&vault_path, dest_path).map_err(|e| format!("فشل نسخ ملف الخزنة: {}", e))?;
        Ok(Some(dest_path.to_string_lossy().to_string()))
    } else {
        Ok(None)
    }
}

#[tauri::command]
async fn import_vault_backup(
    password: String,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<Option<String>, String> {
    let mut password = password;
    if password.trim().is_empty() {
        return Err("يرجى إدخال كلمة المرور الخاصة بالخزنة المستوردة للتحقق من سلامة التشفير.".to_string());
    }

    let file_picked = rfd::AsyncFileDialog::new()
        .set_title("اختر ملف نسخة الخزنة الاحتياطية لاستيراده")
        .add_filter("ملف خزنة كنانة (*.dat, *.kinana)", &["dat", "kinana"])
        .pick_file()
        .await;

    if let Some(file_handle) = file_picked {
        let source_path = file_handle.path();
        
        // 1. فحص الحجم المسموح به لمنع استهلاك الذاكرة (بين الحد الأدنى و50 ميجابايت كحد أقصى)
        let file_meta = std::fs::metadata(source_path).map_err(|e| format!("فشل قراءة معلومات الملف: {}", e))?;
        if (file_meta.len() as usize) < kinana_core::crypto::MIN_VAULT_FILE_SIZE {
            password.zeroize();
            return Err("الملف المختار تالف أو ليس ملف خزنة كنانة صالح.".to_string());
        }
        const MAX_VAULT_IMPORT_BYTES: u64 = 50 * 1024 * 1024; // 50 MB
        if file_meta.len() > MAX_VAULT_IMPORT_BYTES {
            password.zeroize();
            return Err("حجم الملف المختار يتجاوز الحد الأقصى المسموح به (50 ميجابايت).".to_string());
        }

        let bytes = std::fs::read(source_path).map_err(|e| format!("فشل قراءة الملف المختار: {}", e))?;

        // 2. فحص ترويسة التشفير
        let header = kinana_core::crypto::VaultHeader::from_bytes(&bytes[0..kinana_core::crypto::HEADER_SIZE])
            .map_err(|_| "ترويسة ملف الخزنة غير صالحة أو غير متوافقة مع هذا الإصدار.".to_string())?;

        // 3. التحقق بفك تشفير الحمولة المشفرة في الذاكرة بالكامل لضمان صحة كلمة المرور وسلامة التشفير
        let key = kinana_core::crypto::derive_key(&password, &header.salt, &header.argon2_params)
            .map_err(|e| format!("فشل اشتقاق مفتاح التشفير: {}", e))?;

        let (_hdr, payload_bytes) = kinana_core::crypto::decrypt_payload(&bytes, &key)
            .map_err(|_| "كلمة المرور غير صحيحة، أو ملف الخزنة المستورد تالف وغير قابل لفك التشفير.".to_string())?;

        // 4. التحقق من صحة بنية JSON الداخلية
        let mut imported_data: kinana_core::models::VaultData = serde_json::from_slice(payload_bytes.as_slice())
            .map_err(|_| "بنية بيانات الخزنة المستوردة تالفة أو غير متوافقة.".to_string())?;

        let was_legacy = imported_data.recovery_code.is_none();
        let rec_code = if let Some(ref code) = imported_data.recovery_code {
            code.clone()
        } else {
            let code = generate_emergency_recovery_code();
            imported_data.recovery_code = Some(code.clone());
            code
        };

        // إذا كانت الخزنة المستوردة قديمة (لا تحتوي رمز استرداد)، نعيد تشفيرها بالرمز الجديد
        // ليتم حفظه داخل ملف vault.dat الفعلي على القرص منعاً لأي اختلاف مع recovery.dat
        let bytes_to_write = if was_legacy {
            let mut upgrade_header = kinana_core::crypto::VaultHeader {
                magic: header.magic,
                version: header.version,
                argon2_params: header.argon2_params,
                salt: header.salt,
                nonce: header.nonce,
            };
            upgrade_header.refresh_nonce();
            let json_bytes = zeroize::Zeroizing::new(
                serde_json::to_vec(&imported_data)
                    .map_err(|e| format!("فشل تسلسل بيانات الخزنة بعد ترقية رمز الاسترداد: {}", e))?
            );
            let encrypted = kinana_core::crypto::encrypt_payload(&json_bytes, &key, &upgrade_header)
                .map_err(|e| format!("فشل إعادة تشفير الخزنة بعد الترقية: {}", e))?;

            // فحص التحقق الذاتي للتأكد من نجاح التشفير ومطابقة رمز الاسترداد
            let (_, test_decrypted) = kinana_core::crypto::decrypt_payload(&encrypted, &key)
                .map_err(|_| "فشل التحقق من صحة تشفير الخزنة بعد الترقية.".to_string())?;
            let test_data: kinana_core::models::VaultData = serde_json::from_slice(test_decrypted.as_slice())
                .map_err(|_| "فشل التحقق من بنية البيانات بعد الترقية.".to_string())?;
            if test_data.recovery_code.as_deref() != Some(&rec_code) {
                return Err("رمز الاسترداد في الخزنة المرقّاة غير متطابق مع البيانات.".to_string());
            }
            encrypted
        } else {
            bytes
        };

        let vault_path = get_vault_path(&app)?;
        let had_existing_vault = vault_path.exists();
        let backup_safety = vault_path.with_extension("dat.import_safety");

        let rec_path = get_recovery_file_path(&app)?;
        let had_existing_recovery = rec_path.exists();
        let rec_safety = rec_path.with_extension("dat.import_safety");

        let tmp_import_path = vault_path.with_extension("dat.import_tmp");

        // 5. تأمين نسخة احتياطية للخزنة القائمة وملف الاسترداد إن وُجدا مع التحقق من نجاح النسخ
        if had_existing_vault {
            std::fs::copy(&vault_path, &backup_safety)
                .map_err(|e| format!("تعذر تأمين نسخة احتياطية من الخزنة الحالية: {}", e))?;
        }
        if had_existing_recovery {
            std::fs::copy(&rec_path, &rec_safety)
                .map_err(|e| format!("تعذر تأمين نسخة احتياطية من ملف الاسترداد الحالي: {}", e))?;
        }

        // تسجيل معاملة الاستيراد في دفتر المعاملات لضمان التعافي التلقائي عند انقطاع التيار (Transaction Journal)
        let journal_path = get_journal_path(&app)?;
        let mut journal = TransactionJournal::new(
            "import",
            vault_path.clone(),
            rec_path.clone(),
            if had_existing_vault { Some(backup_safety.clone()) } else { None },
            if had_existing_recovery { Some(rec_safety.clone()) } else { None },
            !had_existing_vault,
        ).map_err(|e| format!("فشل حساب بصمات الأمان للاستيراد: {}", e))?;

        journal.write_to_disk(&journal_path).map_err(|e| {
            if had_existing_vault { let _ = std::fs::remove_file(&backup_safety); }
            if had_existing_recovery { let _ = std::fs::remove_file(&rec_safety); }
            format!("فشل تسجيل دفتر المعاملات لضمان التعافي من الانهيار: {}", e)
        })?;

        // 6. كتابة الملف أولاً إلى ملف مؤقت وفحصه
        std::fs::write(&tmp_import_path, &bytes_to_write)
            .map_err(|e| {
                let _ = journal.commit_and_cleanup(&journal_path);
                format!("فشل كتابة الملف المؤقت للاستيراد: {}", e)
            })?;

        // 7. استبدال ذري للخزنة بعد ثبوت صحتها 100%
        if let Err(e) = std::fs::rename(&tmp_import_path, &vault_path) {
            let _ = std::fs::remove_file(&tmp_import_path);
            let _ = journal.commit_and_cleanup(&journal_path);
            password.zeroize();
            return Err(format!("فشل تثبيت ملف الخزنة المستوردة: {}", e));
        }

        // 8. تحديث ملف الاسترداد للخزنة المستوردة بمفتاح الاسترداد الخاص بها مع معالجة الفشل
        if let Err(err_rec) = write_recovery_file(&app, &password, &rec_code) {
            password.zeroize();
            if had_existing_vault {
                // حالة استبدال خزنة سابقة: استعادة الخزنة وملف الاسترداد السابقين مع فحص نتائج الاستعادة بدقة
                let restore_vault_res = std::fs::copy(&backup_safety, &vault_path);
                let restore_rec_res = if had_existing_recovery && rec_safety.exists() {
                    Some(std::fs::copy(&rec_safety, &rec_path))
                } else {
                    None
                };

                // التحقق من صحة الاستعادة قبل حذف نسخ الأمان أو الدفتر
                if let Err(copy_err) = restore_vault_res {
                    return Err(format!(
                        "فشل إنشاء ملف الاسترداد للخزنة المستوردة ({}) وفشلت استعادة ملف الخزنة السابق ({}). تم الاحتفاظ بدفتر المعاملات ونسخة الأمان في: {}",
                        err_rec, copy_err, backup_safety.display()
                    ));
                }

                if let Some(Err(rec_copy_err)) = restore_rec_res {
                    return Err(format!(
                        "فشل إنشاء ملف الاسترداد للخزنة المستوردة ({}) واستُعيدت الخزنة بنجاح ولكن تعذرت استعادة ملف الاسترداد السابق ({}). تم الاحتفاظ بدفتر المعاملات ونسخة الأمان في: {}",
                        err_rec, rec_copy_err, rec_safety.display()
                    ));
                }

                // تم التحقق من نجاح استعادة الملفين معاً: الآن فقط يتم إغلاق الدفتر وتنظيف ملفات الأمان
                let _ = journal.rollback_and_cleanup(&journal_path);

                return Err(format!(
                    "فشل تأمين ملف استرداد الخزنة المستوردة: {}. تم التراجع بنجاح واستعادة الخزنة وملف الاسترداد السابقين وتأكيد سلامتهما.",
                    err_rec
                ));
            } else {
                // حالة الاستيراد لأول مرة: تنظيف أي ملف جزئي تم إنشاؤه لمنع ترك خزنة تالفة أو غير متناسقة
                let _ = std::fs::remove_file(&vault_path);
                let _ = std::fs::remove_file(&rec_path);
                let _ = journal.commit_and_cleanup(&journal_path);
                return Err(format!(
                    "فشل تأمين ملف استرداد الخزنة المستوردة: {}. تم إلغاء الاستيراد وتنظيف الملفات الجزئية بالكامل.",
                    err_rec
                ));
            }
        }

        // تم الاستيراد بنجاح تام:
        // 1. أولاً: إلغاء قفل الجلسة القديمة ومزامنة حالة الذاكرة فوراً لمنع أي اختلاف بين الواجهة والقرص
        if let Ok(mut lock) = state.session.lock() {
            *lock = None;
        }
        if let Ok(mut rec_lock) = state.current_recovery_key.lock() {
            *rec_lock = None;
        }
        password.zeroize();

        // 2. إغلاق المعاملة وتنظيف نسخ الأمان بعد تثبيت الخزنة بنجاح
        let _ = journal.commit_and_cleanup(&journal_path);

        // 3. أرشفة الخزنة السابقة كخطوة مستقلة لا تعطل إتمام الاستيراد
        if had_existing_vault {
            if let Err(e) = create_pre_import_archive(
                &vault_path,
                &backup_safety,
                &rec_path,
                if had_existing_recovery { Some(&rec_safety) } else { None },
            ) {
                eprintln!("WARNING: Failed to archive previous vault backup: {}", e);
            }
        }

        Ok(Some(source_path.to_string_lossy().to_string()))
    } else {
        password.zeroize();
        Ok(None)
    }
}

#[tauri::command]
async fn open_vault_folder(app: AppHandle) -> Result<(), String> {
    let vault_path = get_vault_path(&app)?;
    if vault_path.exists() {
        std::process::Command::new("explorer")
            .arg(format!("/select,{}", vault_path.to_string_lossy()))
            .spawn()
            .map_err(|e| format!("فشل فتح متصفح الملفات: {}", e))?;
    } else {
        let app_dir = app
            .path()
            .app_data_dir()
            .map_err(|e| format!("فشل تحديد المجلد: {}", e))?;
        let _ = std::fs::create_dir_all(&app_dir);
        std::process::Command::new("explorer")
            .arg(&app_dir)
            .spawn()
            .map_err(|e| format!("فشل فتح متصفح الملفات: {}", e))?;
    }
    Ok(())
}

#[tauri::command]
async fn open_url(url: String) -> Result<(), String> {
    let mut target = url.trim().to_string();
    if !target.starts_with("http://") && !target.starts_with("https://") {
        target = format!("https://{}", target);
    }
    #[cfg(windows)]
    {
        std::process::Command::new("rundll32")
            .args(["url.dll,FileProtocolHandler", &target])
            .spawn()
            .map_err(|e| format!("فشل فتح الرابط في المتصفح: {}", e))?;
    }
    #[cfg(not(windows))]
    {
        std::process::Command::new("xdg-open")
            .arg(&target)
            .spawn()
            .map_err(|e| format!("فشل فتح الرابط في المتصفح: {}", e))?;
    }
    Ok(())
}


#[cfg(windows)]
pub fn trim_working_set_tree() {
    use windows_sys::Win32::Foundation::{CloseHandle, INVALID_HANDLE_VALUE};
    use windows_sys::Win32::System::Diagnostics::ToolHelp::{
        CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W, TH32CS_SNAPPROCESS,
    };
    use windows_sys::Win32::System::Threading::{
        GetCurrentProcess, GetCurrentProcessId, OpenProcess, SetProcessWorkingSetSize,
        PROCESS_QUERY_INFORMATION, PROCESS_SET_QUOTA,
    };

    unsafe {
        // 1. Trim own host process working set
        SetProcessWorkingSetSize(GetCurrentProcess(), usize::MAX, usize::MAX);

        // 2. Discover WebView2 child processes
        let my_pid = GetCurrentProcessId();
        let snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
        if snapshot != INVALID_HANDLE_VALUE {
            let mut entry: PROCESSENTRY32W = std::mem::zeroed();
            entry.dwSize = std::mem::size_of::<PROCESSENTRY32W>() as u32;

            let mut direct_children = Vec::new();
            if Process32FirstW(snapshot, &mut entry) != 0 {
                loop {
                    if entry.th32ParentProcessID == my_pid {
                        direct_children.push(entry.th32ProcessID);
                    }
                    if Process32NextW(snapshot, &mut entry) == 0 {
                        break;
                    }
                }
            }

            let mut all_pids = direct_children.clone();
            for parent_pid in direct_children {
                if Process32FirstW(snapshot, &mut entry) != 0 {
                    loop {
                        if entry.th32ParentProcessID == parent_pid {
                            all_pids.push(entry.th32ProcessID);
                        }
                        if Process32NextW(snapshot, &mut entry) == 0 {
                            break;
                        }
                    }
                }
            }

            CloseHandle(snapshot);

            // 3. Trim each child process
            for pid in all_pids {
                let h_proc = OpenProcess(PROCESS_QUERY_INFORMATION | PROCESS_SET_QUOTA, 0, pid);
                if !h_proc.is_null() {
                    SetProcessWorkingSetSize(h_proc, usize::MAX, usize::MAX);
                    CloseHandle(h_proc);
                }
            }
        }
    }
}

#[tauri::command]
fn trim_app_memory() -> Result<(), String> {
    #[cfg(windows)]
    trim_working_set_tree();
    Ok(())
}

fn main() {
    #[cfg(windows)]
    {
        let flags = "--disable-features=msWebOOUI,msPdfOOUI,msEdgeSharedStorage --disable-background-networking --disable-component-update --disable-breakpad --renderer-process-limit=1";
        std::env::set_var("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS", flags);
        unsafe { delete_recovery_code_wincred(); }
    }

    #[cfg(windows)]
    let _single_instance_mutex = {
        use windows_sys::Win32::Foundation::{GetLastError, SetLastError, ERROR_ALREADY_EXISTS};
        use windows_sys::Win32::System::Threading::CreateMutexW;
        use windows_sys::Win32::UI::WindowsAndMessaging::{
            FindWindowW, SetForegroundWindow, ShowWindow, SW_RESTORE,
        };

        unsafe { SetLastError(0) };
        let name: Vec<u16> = "Kinana_App_Single_Instance_Mutex\0".encode_utf16().collect();
        let handle = unsafe { CreateMutexW(std::ptr::null_mut(), 1, name.as_ptr()) };
        if handle.is_null() || unsafe { GetLastError() } == ERROR_ALREADY_EXISTS {
            let title: Vec<u16> = "كنانة\0".encode_utf16().collect();
            let mut hwnd = unsafe { FindWindowW(std::ptr::null_mut(), title.as_ptr()) };
            if hwnd.is_null() {
                let old_title: Vec<u16> = "كِنانة\0".encode_utf16().collect();
                hwnd = unsafe { FindWindowW(std::ptr::null_mut(), old_title.as_ptr()) };
            }
            if !hwnd.is_null() {
                unsafe {
                    ShowWindow(hwnd, SW_RESTORE);
                    SetForegroundWindow(hwnd);
                }
            }
            return;
        }
        handle
    };

    tauri::Builder::default()
        .manage(AppState {
            session: Mutex::new(None),
            last_activity: Mutex::new(std::time::Instant::now()),
            auto_lock_timeout_secs: Mutex::new(Some(300)),
            current_recovery_key: Mutex::new(None),
        })
        .on_window_event(|window, event| {
            match event {
                tauri::WindowEvent::CloseRequested { .. } => {
                    window.app_handle().exit(0);
                    std::process::exit(0);
                }
                tauri::WindowEvent::Destroyed => {
                    std::process::exit(0);
                }
                tauri::WindowEvent::Focused(focused) => {
                    if !focused {
                        #[cfg(windows)]
                        trim_working_set_tree();
                    }
                }
                _ => {}
            }
        })
        .setup(|app| {
            // استعادة أي معاملات غير مكتملة بسبب انقطاع تيار أو إغلاق قسري سابق فور إقلاع التطبيق
            if let Err(e) = recover_interrupted_transactions_if_any(&app.handle()) {
                eprintln!("CRITICAL ERROR: Failed to recover interrupted transaction at startup: {}", e);
            }
            #[cfg(target_os = "windows")]
            if let Some(window) = app.get_webview_window("main") {
                if let Ok(hwnd) = window.hwnd() {
                    use windows_sys::Win32::Graphics::Dwm::{
                        DwmSetWindowAttribute, DWMWA_CAPTION_COLOR, DWMWA_TEXT_COLOR,
                        DWMWA_USE_IMMERSIVE_DARK_MODE,
                    };
                    unsafe {
                        let dark_mode: i32 = 1;
                        DwmSetWindowAttribute(
                            hwnd.0 as _,
                            DWMWA_USE_IMMERSIVE_DARK_MODE as _,
                            &dark_mode as *const _ as _,
                            std::mem::size_of::<i32>() as u32,
                        );

                        // Match dark theme background #09090b (COLORREF 0x000B0909)
                        let caption_color: u32 = 0x000B0909;
                        DwmSetWindowAttribute(
                            hwnd.0 as _,
                            DWMWA_CAPTION_COLOR as _,
                            &caption_color as *const _ as _,
                            std::mem::size_of::<u32>() as u32,
                        );

                        // Pure white title text
                        let text_color: u32 = 0x00FFFFFF;
                        DwmSetWindowAttribute(
                            hwnd.0 as _,
                            DWMWA_TEXT_COLOR as _,
                            &text_color as *const _ as _,
                            std::mem::size_of::<u32>() as u32,
                        );
                    }
                }
            }

            use tauri::menu::{Menu, MenuItem};
            use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};

            let open_item = MenuItem::with_id(app, "open_kinana", "فتح كِنانة", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "إغلاق", true, None::<&str>)?;
            let tray_menu = Menu::with_items(app, &[&open_item, &quit_item])?;

            let mut tray_builder = TrayIconBuilder::new()
                .menu(&tray_menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "open_kinana" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.unminimize();
                            let _ = window.set_focus();
                        }
                    }
                    "quit" => {
                        app.exit(0);
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.unminimize();
                            let _ = window.set_focus();
                        }
                    }
                });

            if let Some(icon) = app.default_window_icon() {
                tray_builder = tray_builder.icon(icon.clone());
            }

            let _tray = tray_builder.build(app)?;

            let app_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                let mut ticks: u32 = 0;
                loop {
                    tokio::time::sleep(Duration::from_secs(2)).await;
                    ticks = ticks.wrapping_add(1);
                    if let Some(window) = app_handle.get_webview_window("main") {
                        let is_min = window.is_minimized().unwrap_or(false);
                        let is_vis = window.is_visible().unwrap_or(true);
                        if is_min || !is_vis || (ticks % 15 == 0) {
                            #[cfg(windows)]
                            trim_working_set_tree();
                        }
                    }
                    let state = app_handle.state::<AppState>();
                    let should_lock = {
                        let timeout_secs = state
                            .auto_lock_timeout_secs
                            .lock()
                            .ok()
                            .and_then(|guard| *guard);

                        if let Some(timeout) = timeout_secs {
                            let last = state
                                .last_activity
                                .lock()
                                .map(|t| *t)
                                .unwrap_or_else(|_| std::time::Instant::now());
                            let session_guard = state.session.lock().ok();
                            let has_session = session_guard.as_ref().map(|s| s.is_some()).unwrap_or(false);
                            has_session && last.elapsed() > Duration::from_secs(timeout)
                        } else {
                            false
                        }
                    };

                    if should_lock {
                        if let Ok(mut session_guard) = state.session.lock() {
                            *session_guard = None;
                        }
                        if let Ok(mut rec_guard) = state.current_recovery_key.lock() {
                            *rec_guard = None;
                        }
                        let _ = app_handle.emit("vault-auto-locked", ());
                    }
                }
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            vault_exists,
            auto_unlock_vault,
            is_auto_unlock_enabled,
            disable_auto_unlock,
            enable_auto_unlock,
            create_vault,
            unlock_vault,
            lock_vault,
            get_vault_summary,
            copy_password,
            get_account_password,
            get_account_recovery_key,
            get_account_pin,
            copy_account_recovery_key,
            copy_account_pin,
            add_service,
            update_service,
            delete_service,
            delete_multiple_services,
            duplicate_service,
            reorder_services,
            ping_activity,
            set_auto_lock_timeout,
            get_auto_lock_timeout,
            add_account,
            delete_account,
            update_account,
            generate_password,
            change_master_password,
            get_current_saved_password,
            get_or_generate_recovery_key,
            recover_vault_with_key,
            get_service_accounts,
            copy_secure_text,
            toggle_fullscreen,
            is_fullscreen,
            export_vault_backup,
            import_vault_backup,
            open_vault_folder,
            open_url,
            trim_app_memory,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}



