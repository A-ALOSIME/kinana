// Prevents additional console window on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod clipboard;
mod wincred;
mod credential_store;

use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;

use kinana_core::{
    account_ops::{
        apply_account_update, extract_pin_from_notes, generate_password_string, pack_account_notes,
        strip_pin_lines, unpack_account_notes, AccountUpdateInput,
    },
    journal::{create_pre_import_archive, TransactionJournal},
    models::{Account, AccountKind, SecretString, Service, VaultSummary},
    storage::{VaultSession, VaultStorage},
};

use tauri::{AppHandle, Emitter, Manager, State};
use serde::{Deserialize, Serialize};
use zeroize::Zeroizing;

pub struct AppState {
    pub session: Mutex<Option<VaultSession>>,
    pub last_activity: Mutex<std::time::Instant>,
    pub auto_lock_timeout_secs: Mutex<Option<u64>>,
    pub current_recovery_key: Mutex<Option<SecretString>>,
    pub last_clipboard_seq: Mutex<Option<u32>>,
}

pub struct TrayMenuState {
    pub open_item: Mutex<Option<tauri::menu::MenuItem<tauri::Wry>>>,
    pub quit_item: Mutex<Option<tauri::menu::MenuItem<tauri::Wry>>>,
}

#[tauri::command]
fn set_tray_language(language: String, state: State<'_, TrayMenuState>) -> Result<(), String> {
    let lang = language.trim().to_ascii_lowercase();
    let (open_label, quit_label) = match lang.as_str() {
        "ar" => ("فتح Kinana", "إغلاق"),
        "fa" => ("باز کردن Kinana", "خروج"),
        "ur" => ("Kinana کھولیں", "بند کریں"),
        "he" => ("פתח את Kinana", "יציאה"),
        "es" => ("Abrir Kinana", "Salir"),
        "fr" => ("Ouvrir Kinana", "Quitter"),
        "de" => ("Kinana öffnen", "Beenden"),
        "pt-br" | "pt_br" | "pt" => ("Abrir Kinana", "Sair"),
        "zh-cn" | "zh_cn" | "zh-hans" => ("打开 Kinana", "退出"),
        "zh-tw" | "zh_tw" | "zh-hant" | "zh-hk" => ("開啟 Kinana", "結束"),
        "ja" => ("Kinana を開く", "終了"),
        "ko" => ("Kinana 열기", "종료"),
        "ru" => ("Открыть Kinana", "Выход"),
        "tr" => ("Kinana'yı Aç", "Çıkış"),
        "it" => ("Apri Kinana", "Esci"),
        "id" => ("Buka Kinana", "Keluar"),
        "hi" => ("Kinana खोलें", "बाहर निकलें"),
        "vi" => ("Mở Kinana", "Thoát"),
        "pl" => ("Otwórz Kinana", "Zakończ"),
        "uk" => ("Відкрити Kinana", "Вийти"),
        "th" => ("เปิด Kinana", "ออก"),
        _ => {
            if lang.starts_with("ar") {
                ("فتح Kinana", "إغلاق")
            } else if lang.starts_with("fa") {
                ("باز کردن Kinana", "خروج")
            } else if lang.starts_with("ur") {
                ("Kinana کھولیں", "بند کریں")
            } else if lang.starts_with("he") || lang.starts_with("iw") {
                ("פתח את Kinana", "יציאה")
            } else if lang.starts_with("es") {
                ("Abrir Kinana", "Salir")
            } else if lang.starts_with("fr") {
                ("Ouvrir Kinana", "Quitter")
            } else if lang.starts_with("de") {
                ("Kinana öffnen", "Beenden")
            } else if lang.starts_with("pt") {
                ("Abrir Kinana", "Sair")
            } else if lang.starts_with("zh") {
                ("打开 Kinana", "退出")
            } else if lang.starts_with("ja") {
                ("Kinana を開く", "終了")
            } else if lang.starts_with("ko") {
                ("Kinana 열기", "종료")
            } else if lang.starts_with("ru") {
                ("Открыть Kinana", "Выход")
            } else if lang.starts_with("tr") {
                ("Kinana'yı Aç", "Çıkış")
            } else if lang.starts_with("it") {
                ("Apri Kinana", "Esci")
            } else if lang.starts_with("id") {
                ("Buka Kinana", "Keluar")
            } else if lang.starts_with("hi") {
                ("Kinana खोलें", "बाहر निकलें")
            } else if lang.starts_with("vi") {
                ("Mở Kinana", "Thoát")
            } else if lang.starts_with("pl") {
                ("Otwórz Kinana", "Zakończ")
            } else if lang.starts_with("uk") {
                ("Відкрити Kinana", "Вийти")
            } else if lang.starts_with("th") {
                ("เปิด Kinana", "ออก")
            } else {
                ("Open Kinana", "Quit")
            }
        }
    };

    if let Ok(guard) = state.open_item.lock() {
        if let Some(ref item) = *guard {
            let _ = item.set_text(open_label);
        }
    }
    if let Ok(guard) = state.quit_item.lock() {
        if let Some(ref item) = *guard {
            let _ = item.set_text(quit_label);
        }
    }
    Ok(())
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct VaultOperationResult {
    pub success: bool,
    pub warning: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ImportVaultResult {
    pub success: bool,
    pub source_path: Option<String>,
    pub warning: Option<String>,
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

    let saved_key = match credential_store::read_credential() {
        Ok(k) => k,
        Err(_) => return Ok(false),
    };

    let vault_path = get_vault_path(&app)?;
    let storage = VaultStorage::new(&vault_path);
    if !storage.exists() {
        return Ok(false);
    }

    let mut session = storage.unlock(&saved_key).map_err(|e| e.to_string())?;

    // تطبيق آلية المواءمة والمعالجة الذاتية (Self-Healing) لملف الاسترداد في مسار الفتح التلقائي أيضاً
    let rec_code = synchronize_and_heal_recovery_file(&app, &storage, &mut session, &saved_key)?;

    if let Ok(mut rec_lock) = state.current_recovery_key.lock() {
        *rec_lock = Some(SecretString::new(rec_code));
    }

    let mut lock = state.session.lock().map_err(|e| e.to_string())?;
    *lock = Some(session);
    update_activity(&state);

    Ok(true)
}

#[tauri::command]
fn is_auto_unlock_supported() -> bool {
    credential_store::is_supported()
}

#[tauri::command]
fn get_auto_unlock_status() -> credential_store::KeyringSupportStatus {
    credential_store::check_support_status()
}

#[tauri::command]
async fn is_auto_unlock_enabled() -> bool {
    credential_store::has_stored_credential()
}

#[tauri::command]
async fn disable_auto_unlock() -> Result<(), String> {
    credential_store::delete_credential()
}

#[tauri::command]
async fn enable_auto_unlock(
    password: String,
    app: AppHandle,
) -> Result<(), String> {
    let password = Zeroizing::new(password);
    let vault_path = get_vault_path(&app)?;
    let storage = VaultStorage::new(&vault_path);
    let _ = storage.unlock(&password).map_err(|e| e.to_string())?;
    credential_store::store_credential(&password)?;
    Ok(())
}

#[tauri::command]
async fn create_vault(
    password: String,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<(), String> {
    let password = Zeroizing::new(password);
    if password.trim().len() < 8 {
        return Err("يجب أن تتكون كلمة المرور الرئيسية أو رمز الدخول من 8 خانات على الأقل لضمان حماية الخزنة ضد التخمين.".to_string());
    }

    let vault_path = get_vault_path(&app)?;
    let storage = VaultStorage::new(&vault_path);

    if storage.exists() {
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

    let password = Zeroizing::new(password);
    let vault_path = get_vault_path(&app)?;
    let storage = VaultStorage::new(&vault_path);

    let mut session = storage.unlock(&password).map_err(|e| e.to_string())?;

    let rec_code = synchronize_and_heal_recovery_file(&app, &storage, &mut session, &password)?;

    if let Ok(mut rec_lock) = state.current_recovery_key.lock() {
        *rec_lock = Some(SecretString::new(rec_code));
    }

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
    if let Ok(mut seq_lock) = state.last_clipboard_seq.lock() {
        if let Some(expected_seq) = seq_lock.take() {
            unsafe {
                clipboard::clear_clipboard_if_sequence_matches(expected_seq);
            }
        }
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

        Zeroizing::new(pwd.to_string())
    };

    update_activity(&state);

    // Interacts securely with Win32 clipboard memory pointers
    let seq = unsafe { clipboard::copy_to_windows_clipboard_secure(&pwd_to_copy)? };

    if let Ok(mut seq_guard) = state.last_clipboard_seq.lock() {
        *seq_guard = Some(seq);
    }

    // Auto-clear clipboard after 15 seconds in background IF content was not overwritten
    tokio::spawn(async move {
        tokio::time::sleep(Duration::from_secs(15)).await;
        unsafe {
            clipboard::clear_clipboard_if_sequence_matches(seq);
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
            account_kind: acc.account_kind,
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

    // Ensure NO recovery code is stored in credential store (strictly offline user recovery key)
    credential_store::delete_recovery_credential();

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
) -> Result<VaultOperationResult, String> {
    let new_password = Zeroizing::new(new_password);
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
            let _ = journal.rollback_and_cleanup(&journal_path);
            e.to_string()
        })?;
    let new_key = kinana_core::crypto::derive_key(&new_password, &new_header.salt, &new_header.argon2_params)
        .map_err(|e| {
            let _ = journal.rollback_and_cleanup(&journal_path);
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
        let _ = journal.rollback_and_cleanup(&journal_path);
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
            return Err(format!(
                "خطأ حرج: تعذر تحديث ملف الاسترداد ({}) وفشلت استعادة ملف الخزنة السابق ({}). تم الاحتفاظ بدفتر المعاملات ونسخة الأمان في: {}",
                err_rec, vault_err, rekey_backup.display()
            ));
        }

        if let Err(rec_err) = restore_rec_res {
            return Err(format!(
                "تعذر تحديث ملف الاسترداد ({}) واستُعيدت الخزنة بنجاح لكن تعذرت استعادة ملف الاسترداد السابق ({}). تم الاحتفاظ بدفتر المعاملات ونسخة الاسترداد في: {}",
                err_rec, rec_err, rec_backup.display()
            ));
        }

        // تم استعادة والتحقق من الملفين بنجاح قطعي: الآن فقط يُغلق الدفتر وتُنظف نسخ الأمان
        if let Err(e) = journal.rollback_and_cleanup(&journal_path) {
            eprintln!("WARNING: Failed to cleanup after rollback: {}", e);
        }

        session.header = old_header;
        session.key = old_key;
        return Err(format!(
            "فشل كتابة ملف الاسترداد بالمفتاح الجديد: {}. تم التراجع الذري بنجاح واستعادة الخزنة وملف الاسترداد والتحقق قطعيّاً من سلامتهما بكلمة المرور القديمة.",
            err_rec
        ));
    }

    // 1. إغلاق دفتر المعاملة بنجاح وتوثيق الالتزام المكتمل على القرص
    journal.commit(&journal_path)
        .map_err(|e| format!("فشل توثيق إتمام معاملة تغيير كلمة المرور: {}", e))?;

    // 2. تنظيف ملفات الأمان والدفتر مع رصد أي فشل لإبلاغ المستخدم
    let cleanup_err = journal.cleanup(&journal_path).err();

    if let Ok(mut rec_lock) = state.current_recovery_key.lock() {
        *rec_lock = Some(SecretString::new(recovery_code));
    }

    // 3. إذا كان الفتح التلقائي مفعلاً مسبقاً، حدّث المفتاح في مخزن الاعتمادات مع فحص الخطأ
    if credential_store::has_stored_credential() {
        if let Err(e) = credential_store::store_credential(&new_password) {
            return Err(format!("تم حفظ الخزنة بالمفتاح الجديد ولكن تعذر تحديث الفتح التلقائي: {}", e));
        }
    }

    // 4. تنظيف النسخ الاحتياطية القديمة لمنع فكها بكلمة المرور السابقة
    let backup_safety = vault_path.with_extension("dat.bak");
    let mut bak_del_err = None;
    if backup_safety.exists() {
        if let Err(e) = std::fs::remove_file(&backup_safety) {
            eprintln!("WARNING: Failed to remove old vault backup {}: {}", backup_safety.display(), e);
            bak_del_err = Some(format!("النسخة الاحتياطية '{}' ({})", backup_safety.display(), e));
        }
    }

    update_activity(&state);

    // 5. إذا نجح التغيير والتشفير لكن تعذر تنظيف بعض الملفات القديمة، نبلّغ المستخدم بتحذير منظم مع اعتماد نجاح العملية
    let warning = if cleanup_err.is_some() || bak_del_err.is_some() {
        let mut details = Vec::new();
        if let Some(ce) = cleanup_err {
            details.push(ce.to_string());
        }
        if let Some(be) = bak_del_err {
            details.push(be);
        }
        Some(format!(
            "تعذر حذف بعض ملفات الأمان المؤقتة السابقة: {}. يرجى حذفها يدوياً لحماية سرية بياناتك السابقة.",
            details.join("; ")
        ))
    } else {
        None
    };

    Ok(VaultOperationResult {
        success: true,
        warning,
    })
}

#[tauri::command]
async fn get_current_saved_password(state: State<'_, AppState>) -> Result<String, String> {
    let lock = state.session.lock().map_err(|e| e.to_string())?;
    if lock.is_none() {
        return Err("الخزنة مقفلة".to_string());
    }
    credential_store::read_credential().map(|k| k.to_string())
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

    let clean_code = Zeroizing::new(recovery_code.trim().to_uppercase());
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

    let master_pwd = Zeroizing::new(
        String::from_utf8(plaintext.to_vec()).map_err(|_| "فشل فك تشفير كلمة المرور".to_string())?
    );

    let vault_path = get_vault_path(&app)?;
    let storage = VaultStorage::new(&vault_path);
    let mut session = storage.unlock(&master_pwd).map_err(|e| e.to_string())?;

    // Ensure session data recovery code matches the key used; avoid unnecessary disk writes if already matching.
    if session.data.recovery_code.as_deref() != Some(&clean_code) {
        let old_code = session.data.recovery_code.clone();
        session.data.recovery_code = Some(clean_code.to_string());
        if let Err(e) = storage.save(&mut session) {
            session.data.recovery_code = old_code;
            return Err(format!("فشل تحديث رمز الاسترداد في الخزنة: {}", e));
        }
    }

    // Keep recovery key in memory for this session and delete any old unencrypted credential entry
    credential_store::delete_recovery_credential();

    if let Ok(mut rec_lock) = state.current_recovery_key.lock() {
        *rec_lock = Some(SecretString::new(clean_code.to_string()));
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
    pub account_kind: AccountKind,
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
            let has_pin = notes.lines().any(|l| l.trim().starts_with("PIN:"));
            let has_notes = !notes.trim().is_empty();
            let safe_notes = if has_pin {
                let stripped = strip_pin_lines(&notes);
                if stripped.is_empty() { None } else { Some(stripped) }
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
                account_kind: acc.resolve_kind(&service.name),
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
    let pin = extract_pin_from_notes(&notes).unwrap_or_default();
    update_activity(&state);
    Ok(pin)
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
async fn copy_vault_recovery_key(
    state: State<'_, AppState>,
) -> Result<(), String> {
    let key = get_or_generate_recovery_key(state.clone()).await?;
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

    let text_buf = Zeroizing::new(text);
    let seq = unsafe {
        clipboard::copy_to_windows_clipboard_secure(&text_buf)?
    };

    if let Ok(mut seq_guard) = state.last_clipboard_seq.lock() {
        *seq_guard = Some(seq);
    }

    tokio::spawn(async move {
        tokio::time::sleep(Duration::from_secs(15)).await;
        unsafe {
            clipboard::clear_clipboard_if_sequence_matches(seq);
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
    account_kind: Option<AccountKind>,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<VaultSummary, String> {
    let secret_password = if let Some(p) = password {
        SecretString::new(p)
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

    let inferred_kind = account_kind.unwrap_or_else(|| {
        if notes.as_deref().map_or(false, |n| n.contains("[CARD]")) {
            AccountKind::Card
        } else {
            AccountKind::Login
        }
    });

    let account_id = uuid::Uuid::new_v4().to_string();
    let new_account = Account {
        id: account_id,
        label: label.unwrap_or_else(|| "الحساب الرئيسي".to_string()),
        username: username.unwrap_or_default(),
        password: secret_password,
        notes: packed_notes,
        url: clean_url,
        account_kind: Some(inferred_kind),
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
    clear_password: Option<bool>,
    account_kind: Option<AccountKind>,
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

    apply_account_update(
        account,
        AccountUpdateInput {
            label,
            username,
            password,
            email,
            recovery_key,
            notes,
            url,
            clear_recovery_key,
            clear_pin,
            clear_password,
            account_kind,
        },
    );

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
    generate_password_string(length, use_symbols)
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
) -> Result<ImportVaultResult, String> {
    let password = Zeroizing::new(password);
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
            return Err("الملف المختار تالف أو ليس ملف خزنة كنانة صالح.".to_string());
        }
        const MAX_VAULT_IMPORT_BYTES: u64 = 50 * 1024 * 1024; // 50 MB
        if file_meta.len() > MAX_VAULT_IMPORT_BYTES {
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
                let _ = journal.rollback_and_cleanup(&journal_path);
                format!("فشل كتابة الملف المؤقت للاستيراد: {}", e)
            })?;

        // 7. استبدال ذري للخزنة بعد ثبوت صحتها 100%
        if let Err(e) = std::fs::rename(&tmp_import_path, &vault_path) {
            let _ = std::fs::remove_file(&tmp_import_path);
            let _ = journal.rollback_and_cleanup(&journal_path);
            return Err(format!("فشل تثبيت ملف الخزنة المستوردة: {}", e));
        }

        // 8. تحديث ملف الاسترداد للخزنة المستوردة بمفتاح الاسترداد الخاص بها مع معالجة الفشل
        if let Err(err_rec) = write_recovery_file(&app, &password, &rec_code) {
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
                if let Err(e) = journal.rollback_and_cleanup(&journal_path) {
                    eprintln!("WARNING: Failed to cleanup after rollback: {}", e);
                }

                return Err(format!(
                    "فشل تأمين ملف استرداد الخزنة المستوردة: {}. تم التراجع بنجاح واستعادة الخزنة وملف الاسترداد السابقين وتأكيد سلامتهما.",
                    err_rec
                ));
            } else {
                // حالة الاستيراد لأول مرة: تنظيف أي ملف جزئي تم إنشاؤه لمنع ترك خزنة تالفة أو غير متناسقة
                let _ = std::fs::remove_file(&vault_path);
                let _ = std::fs::remove_file(&rec_path);
                if let Err(e) = journal.rollback_and_cleanup(&journal_path) {
                    eprintln!("WARNING: Failed to cleanup after rollback: {}", e);
                }
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

        // 2. تأكيد إتمام المعاملة رسمياً على القرص بحالة Committed قبل المساس بنسخ الأمان
        journal.commit(&journal_path)
            .map_err(|e| format!("فشل توثيق إتمام معاملة الاستيراد: {}", e))?;

        // 3. أرشفة الخزنة السابقة من نسخ الأمان الموجودة فعلياً على القرص قبل تنظيفها
        let mut archive_err = None;
        if had_existing_vault {
            if let Err(e) = create_pre_import_archive(
                &vault_path,
                &backup_safety,
                &rec_path,
                if had_existing_recovery { Some(&rec_safety) } else { None },
            ) {
                eprintln!("WARNING: Failed to archive previous vault backup: {}", e);
                archive_err = Some(e.to_string());
            }
        }

        // إذا تعذرت الأرشفة الوقائية لأي سبب، نحافظ قطعياً على نسخ الأمان الأصلية على القرص
        // ونفك ارتباطها من دفتر المعاملات ونحفظ الدفتر المحدّث على القرص فوراً لمنع أي عملية تنظيف
        // لاحقة أو عملية recover() عند إعادة تشغيل التطبيق من حذف نسخ الأمان إذا تعذر حذف الدفتر.
        if archive_err.is_some() {
            if let Err(e) = journal.release_safety_backups(&journal_path) {
                eprintln!("WARNING: Failed to persist safety backup release to journal: {}", e);
            }
        }

        // 4. الآن وبعد إتمام الأرشفة، ننظف دفتر المعاملة (وحذف ملفات الأمان فقط إن كانت الأرشفة قد نجحت)
        let cleanup_err = journal.cleanup(&journal_path).err();

        let warning = if cleanup_err.is_some() || archive_err.is_some() {
            let mut details = Vec::new();
            if let Some(ae) = archive_err {
                details.push(format!(
                    "تعذر إنشاء نسخة الأرشيف الوقائي ({}) ولكن تم الاحتفاظ بنسخة الخزنة السابقة كاملةً بأمان في: {}",
                    ae,
                    backup_safety.display()
                ));
            }
            if let Some(ce) = cleanup_err {
                details.push(format!("تنظيف الملفات المؤقتة ({})", ce));
            }
            Some(details.join(" | "))
        } else {
            None
        };

        Ok(ImportVaultResult {
            success: true,
            source_path: Some(source_path.to_string_lossy().to_string()),
            warning,
        })
    } else {
        Ok(ImportVaultResult {
            success: false,
            source_path: None,
            warning: None,
        })
    }
}

#[tauri::command]
async fn open_vault_folder(app: AppHandle) -> Result<(), String> {
    let vault_path = get_vault_path(&app)?;
    reveal_path_in_file_manager(&vault_path, &app)
}

fn reveal_path_in_file_manager(vault_path: &Path, app: &AppHandle) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
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
    }

    #[cfg(target_os = "macos")]
    {
        if vault_path.exists() {
            std::process::Command::new("open")
                .args(["-R", &vault_path.to_string_lossy()])
                .spawn()
                .map_err(|e| format!("فشل فتح Finder: {}", e))?;
        } else {
            let app_dir = app
                .path()
                .app_data_dir()
                .map_err(|e| format!("فشل تحديد المجلد: {}", e))?;
            let _ = std::fs::create_dir_all(&app_dir);
            std::process::Command::new("open")
                .arg(&app_dir)
                .spawn()
                .map_err(|e| format!("فشل فتح Finder: {}", e))?;
        }
    }

    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        let target_dir: std::path::PathBuf = if vault_path.exists() {
            vault_path.parent().map(|p| p.to_path_buf()).unwrap_or_else(|| vault_path.to_path_buf())
        } else {
            let app_dir = app
                .path()
                .app_data_dir()
                .map_err(|e| format!("فشل تحديد المجلد: {}", e))?;
            let _ = std::fs::create_dir_all(&app_dir);
            app_dir
        };

        // 1. Try gio open (standard GLib/GIO desktop opener)
        let mut gio_cmd = std::process::Command::new("gio");
        gio_cmd.args(["open", &target_dir.to_string_lossy()]);
        sanitize_linux_host_command(&mut gio_cmd);
        if let Ok(mut child) = gio_cmd.spawn() {
            std::thread::sleep(std::time::Duration::from_millis(300));
            match child.try_wait() {
                Ok(Some(status)) if status.success() => return Ok(()),
                Ok(None) => return Ok(()),
                _ => {}
            }
        }

        // 2. Try xdg-open with sanitized environment
        let mut xdg_cmd = std::process::Command::new("xdg-open");
        xdg_cmd.arg(&target_dir);
        sanitize_linux_host_command(&mut xdg_cmd);
        if let Ok(mut child) = xdg_cmd.spawn() {
            std::thread::sleep(std::time::Duration::from_millis(300));
            match child.try_wait() {
                Ok(Some(status)) if status.success() => return Ok(()),
                Ok(None) => return Ok(()),
                _ => {}
            }
        }

        // 3. Fallback directly to native desktop file managers (Nemo for Linux Mint, Nautilus, Dolphin, Thunar, PCManFM)
        for fm in &["nemo", "nautilus", "dolphin", "thunar", "pcmanfm"] {
            let mut fm_cmd = std::process::Command::new(fm);
            fm_cmd.arg(&target_dir);
            sanitize_linux_host_command(&mut fm_cmd);
            if let Ok(mut child) = fm_cmd.spawn() {
                std::thread::sleep(std::time::Duration::from_millis(300));
                match child.try_wait() {
                    Ok(Some(status)) if status.success() => return Ok(()),
                    Ok(None) => return Ok(()),
                    _ => {}
                }
            }
        }

        Err("تعذر فتح مدير الملفات على النظام. يرجى فتح المجلد يدوياً.".to_string())
    }

    #[cfg(any(target_os = "windows", target_os = "macos"))]
    {
        Ok(())
    }
}

#[cfg(not(any(target_os = "windows", target_os = "macos")))]
fn sanitize_linux_host_command(cmd: &mut std::process::Command) {
    if let Ok(ld_path) = std::env::var("LD_LIBRARY_PATH") {
        let appdir = std::env::var("APPDIR").unwrap_or_default();
        let cleaned: Vec<&str> = ld_path
            .split(':')
            .filter(|p| {
                let p_str = *p;
                if p_str.is_empty() {
                    return false;
                }
                if p_str.contains("/.mount_") || p_str.contains("/tmp/.mount") {
                    return false;
                }
                if !appdir.is_empty() && p_str.starts_with(&appdir) {
                    return false;
                }
                true
            })
            .collect();

        if cleaned.is_empty() {
            cmd.env_remove("LD_LIBRARY_PATH");
        } else {
            cmd.env("LD_LIBRARY_PATH", cleaned.join(":"));
        }
    } else {
        cmd.env_remove("LD_LIBRARY_PATH");
    }

    for var in &[
        "LD_PRELOAD",
        "GIO_MODULE_DIR",
        "GTK_PATH",
        "GTK_DATA_PREFIX",
        "GTK_EXE_PREFIX",
        "QT_PLUGIN_PATH",
        "PYTHONHOME",
        "PYTHONPATH",
    ] {
        if let Ok(val) = std::env::var(var) {
            if val.contains("/.mount_") || val.contains("/tmp/.mount") {
                cmd.env_remove(var);
            }
        }
    }

    #[cfg(target_os = "linux")]
    if APP_SET_WEBKIT_FORCE_SHM.load(std::sync::atomic::Ordering::Relaxed) {
        cmd.env_remove("WEBKIT_DMABUF_RENDERER_FORCE_SHM");
    }
}

#[cfg(target_os = "linux")]
static APP_SET_WEBKIT_FORCE_SHM: std::sync::atomic::AtomicBool =
    std::sync::atomic::AtomicBool::new(false);

#[tauri::command]
async fn open_url(url: String) -> Result<(), String> {
    let mut target = url.trim().to_string();
    if !target.starts_with("http://") && !target.starts_with("https://") {
        target = format!("https://{}", target);
    }
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("rundll32")
            .args(["url.dll,FileProtocolHandler", &target])
            .spawn()
            .map_err(|e| format!("فشل فتح الرابط في المتصفح: {}", e))?;
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&target)
            .spawn()
            .map_err(|e| format!("فشل فتح الرابط في المتصفح: {}", e))?;
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        let mut cmd = std::process::Command::new("xdg-open");
        cmd.arg(&target);
        sanitize_linux_host_command(&mut cmd);
        cmd.spawn()
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
    #[cfg(target_os = "linux")]
    {
        // Work around WebKitGTK DMA-BUF partial tile corruption on NVIDIA/Mesa X11 compositors
        // without disabling GPU acceleration or animations globally.
        if std::env::var_os("WEBKIT_DMABUF_RENDERER_FORCE_SHM").is_none()
            && std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_none()
            && std::env::var_os("WEBKIT_DISABLE_COMPOSITING_MODE").is_none()
        {
            std::env::set_var("WEBKIT_DMABUF_RENDERER_FORCE_SHM", "1");
            APP_SET_WEBKIT_FORCE_SHM.store(true, std::sync::atomic::Ordering::Relaxed);
        }
    }

    #[cfg(windows)]
    {
        let flags = "--disable-features=msWebOOUI,msPdfOOUI,msEdgeSharedStorage --disable-background-networking --disable-component-update --disable-breakpad --renderer-process-limit=1";
        std::env::set_var("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS", flags);
        credential_store::delete_recovery_credential();
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
            let candidates = ["Kinana\0", "كنانة\0", "كِنانة\0"];
            let mut hwnd = std::ptr::null_mut();
            for candidate in candidates {
                let title_utf16: Vec<u16> = candidate.encode_utf16().collect();
                hwnd = unsafe { FindWindowW(std::ptr::null_mut(), title_utf16.as_ptr()) };
                if !hwnd.is_null() {
                    break;
                }
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
            last_clipboard_seq: Mutex::new(None),
        })
        .manage(TrayMenuState {
            open_item: Mutex::new(None),
            quit_item: Mutex::new(None),
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

                // Disable WebView2 general form autofill & password autosave popups while keeping
                // localStorage / UI preferences intact.
                let _ = window.with_webview(|webview| unsafe {
                    use webview2_com::Microsoft::Web::WebView2::Win32::{
                        ICoreWebView2Profile2, ICoreWebView2Profile6, ICoreWebView2Settings4,
                        ICoreWebView2_13, COREWEBVIEW2_BROWSING_DATA_KINDS_GENERAL_AUTOFILL,
                        COREWEBVIEW2_BROWSING_DATA_KINDS_PASSWORD_AUTOSAVE,
                    };
                    use webview2_com::ClearBrowsingDataCompletedHandler;
                    use windows_core::Interface;

                    if let Ok(core) = webview.controller().CoreWebView2() {
                        if let Ok(settings) = core.Settings() {
                            if let Ok(settings4) = settings.cast::<ICoreWebView2Settings4>() {
                                let _ = settings4.SetIsGeneralAutofillEnabled(false);
                                let _ = settings4.SetIsPasswordAutosaveEnabled(false);
                            }
                        }

                        if let Ok(core13) = core.cast::<ICoreWebView2_13>() {
                            if let Ok(profile) = core13.Profile() {
                                if let Ok(profile6) = profile.cast::<ICoreWebView2Profile6>() {
                                    let _ = profile6.SetIsGeneralAutofillEnabled(false);
                                    let _ = profile6.SetIsPasswordAutosaveEnabled(false);
                                }
                                if let Ok(profile2) = profile.cast::<ICoreWebView2Profile2>() {
                                    let handler = ClearBrowsingDataCompletedHandler::create(
                                        Box::new(|_| Ok(())),
                                    );
                                    let _ = profile2.ClearBrowsingData(
                                        COREWEBVIEW2_BROWSING_DATA_KINDS_GENERAL_AUTOFILL
                                            | COREWEBVIEW2_BROWSING_DATA_KINDS_PASSWORD_AUTOSAVE,
                                        &handler,
                                    );
                                }
                            }
                        }
                    }
                });
            }

            use tauri::menu::{Menu, MenuItem};
            use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};

            let open_item = MenuItem::with_id(app, "open_kinana", "فتح Kinana", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "إغلاق", true, None::<&str>)?;
            let tray_menu = Menu::with_items(app, &[&open_item, &quit_item])?;
            {
                let tray_state = app.state::<TrayMenuState>();
                if let Ok(mut guard) = tray_state.open_item.lock() {
                    *guard = Some(open_item.clone());
                }
                if let Ok(mut guard) = tray_state.quit_item.lock() {
                    *guard = Some(quit_item.clone());
                };
            }

            let mut tray_builder = TrayIconBuilder::new()
                .tooltip("Kinana")
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
                        if let Ok(mut seq_lock) = state.last_clipboard_seq.lock() {
                            if let Some(expected_seq) = seq_lock.take() {
                                unsafe {
                                    clipboard::clear_clipboard_if_sequence_matches(expected_seq);
                                }
                            }
                        }
                        let _ = app_handle.emit("vault-auto-locked", ());
                    }
                }
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            vault_exists,
            is_auto_unlock_supported,
            get_auto_unlock_status,
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
            copy_vault_recovery_key,
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
            set_tray_language,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}



