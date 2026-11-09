//! Cross-platform secure clipboard abstraction.
//!
//! # Platform Implementations:
//! - Windows: Native Win32 clipboard API with:
//!   * Exclusion from Win 10/11 Clipboard History (CanIncludeInClipboardHistory = 0)
//!   * Exclusion from Microsoft Cloud Clipboard sync (CanUploadToCloudClipboard = 0)
//!   * CF_UNICODETEXT payload with explicit zeroization of temporary buffers
//!   * OS-level sequence numbers via GetClipboardSequenceNumber()
//!
//! - macOS & Linux:
//!   * Clipboard operations via arboard (Cocoa NSPasteboard on macOS, X11/Wayland on Linux)
//!   * Monotonic sequence tokens paired with SHA-256 content hashes
//!   * Conditional clearing: verifies that current clipboard content matches the copied secret's hash
//!     before clearing. If the user copied something else in the interim, their new clipboard data is preserved.
//!   * Zeroization of intermediate text buffers where supported.

#[cfg(target_os = "windows")]
use zeroize::Zeroize;

#[cfg(target_os = "windows")]
mod imp {
    use super::*;
    use windows_sys::Win32::System::DataExchange::{
        CloseClipboard, EmptyClipboard, GetClipboardSequenceNumber, OpenClipboard,
        RegisterClipboardFormatW, SetClipboardData,
    };
    use windows_sys::Win32::System::Memory::{
        GlobalAlloc, GlobalLock, GlobalUnlock, GMEM_MOVEABLE, GMEM_ZEROINIT,
    };

    pub unsafe fn copy_to_clipboard_secure(text: &str) -> Result<u32, String> {
        if OpenClipboard(std::ptr::null_mut()) == 0 {
            return Err("Failed to open Windows clipboard".to_string());
        }

        EmptyClipboard();

        // 1. Exclude from Windows 10/11 Clipboard History (Win + V)
        let hist_fmt_name: Vec<u16> = "CanIncludeInClipboardHistory\0".encode_utf16().collect();
        let cf_history = RegisterClipboardFormatW(hist_fmt_name.as_ptr());
        if cf_history != 0 {
            let hmem = GlobalAlloc(GMEM_MOVEABLE | GMEM_ZEROINIT, std::mem::size_of::<u32>());
            if !hmem.is_null() {
                SetClipboardData(cf_history, hmem as _);
            }
        }

        // 2. Prevent uploading/syncing to Microsoft Cloud Clipboard
        let cloud_fmt_name: Vec<u16> = "CanUploadToCloudClipboard\0".encode_utf16().collect();
        let cf_cloud = RegisterClipboardFormatW(cloud_fmt_name.as_ptr());
        if cf_cloud != 0 {
            let hmem = GlobalAlloc(GMEM_MOVEABLE | GMEM_ZEROINIT, std::mem::size_of::<u32>());
            if !hmem.is_null() {
                SetClipboardData(cf_cloud, hmem as _);
            }
        }

        // 3. Write plaintext to clipboard as CF_UNICODETEXT (ID 13)
        let mut utf16: Vec<u16> = text.encode_utf16().chain(std::iter::once(0)).collect();
        let byte_len = utf16.len() * std::mem::size_of::<u16>();
        let hmem_text = GlobalAlloc(GMEM_MOVEABLE, byte_len);
        if hmem_text.is_null() {
            utf16.zeroize();
            CloseClipboard();
            return Err("Failed to allocate global memory for clipboard text".to_string());
        }

        let ptr = GlobalLock(hmem_text) as *mut u16;
        if ptr.is_null() {
            utf16.zeroize();
            CloseClipboard();
            return Err("Failed to lock global memory for clipboard text".to_string());
        }
        std::ptr::copy_nonoverlapping(utf16.as_ptr(), ptr, utf16.len());
        GlobalUnlock(hmem_text);
        utf16.zeroize();

        SetClipboardData(13 /* CF_UNICODETEXT */, hmem_text as _);
        CloseClipboard();

        let seq = GetClipboardSequenceNumber();
        Ok(seq)
    }

    pub unsafe fn clear_clipboard() {
        if OpenClipboard(std::ptr::null_mut()) != 0 {
            EmptyClipboard();
            CloseClipboard();
        }
    }

    pub unsafe fn clear_clipboard_if_sequence_matches(expected_seq: u32) -> bool {
        if GetClipboardSequenceNumber() == expected_seq {
            clear_clipboard();
            true
        } else {
            false
        }
    }
}

#[cfg(not(target_os = "windows"))]
mod imp {
    use sha2::{Digest, Sha256};
    use std::sync::atomic::{AtomicU32, Ordering};
    use std::sync::Mutex;

    static SEQUENCE_COUNTER: AtomicU32 = AtomicU32::new(1);
    static LAST_COPIED_HASH: Mutex<Option<(u32, [u8; 32])>> = Mutex::new(None);

    fn compute_hash(data: &str) -> [u8; 32] {
        let mut hasher = Sha256::new();
        hasher.update(data.as_bytes());
        hasher.finalize().into()
    }

    pub unsafe fn copy_to_clipboard_secure(text: &str) -> Result<u32, String> {
        let mut clipboard = arboard::Clipboard::new()
            .map_err(|e| format!("Failed to access clipboard: {}", e))?;

        clipboard
            .set_text(text)
            .map_err(|e| format!("Failed to set clipboard text: {}", e))?;

        let hash = compute_hash(text);
        let seq = SEQUENCE_COUNTER.fetch_add(1, Ordering::SeqCst);

        if let Ok(mut guard) = LAST_COPIED_HASH.lock() {
            *guard = Some((seq, hash));
        }

        Ok(seq)
    }

    pub unsafe fn clear_clipboard() {
        if let Ok(mut clipboard) = arboard::Clipboard::new() {
            let _ = clipboard.clear();
        }
        if let Ok(mut guard) = LAST_COPIED_HASH.lock() {
            *guard = None;
        }
    }

    pub unsafe fn clear_clipboard_if_sequence_matches(expected_seq: u32) -> bool {
        let stored_hash = {
            if let Ok(guard) = LAST_COPIED_HASH.lock() {
                if let Some((seq, hash)) = *guard {
                    if seq == expected_seq {
                        Some(hash)
                    } else {
                        None
                    }
                } else {
                    None
                }
            } else {
                None
            }
        };

        let Some(target_hash) = stored_hash else {
            return false;
        };

        // Read current clipboard text to verify it has not been overwritten by another application
        let mut clipboard = match arboard::Clipboard::new() {
            Ok(c) => c,
            Err(_) => return false,
        };

        match clipboard.get_text() {
            Ok(current_text) => {
                let current_hash = compute_hash(&current_text);
                if current_hash == target_hash {
                    let _ = clipboard.clear();
                    if let Ok(mut guard) = LAST_COPIED_HASH.lock() {
                        *guard = None;
                    }
                    true
                } else {
                    // Clipboard content has changed since Kinana copied the secret; preserve new user data
                    false
                }
            }
            Err(_) => {
                // Clipboard empty or non-text content already replaced it
                false
            }
        }
    }
}

pub unsafe fn copy_to_clipboard_secure(text: &str) -> Result<u32, String> {
    imp::copy_to_clipboard_secure(text)
}

pub unsafe fn copy_to_windows_clipboard_secure(text: &str) -> Result<u32, String> {
    copy_to_clipboard_secure(text)
}

#[allow(dead_code)]
pub unsafe fn clear_clipboard() {
    imp::clear_clipboard();
}

#[allow(dead_code)]
pub unsafe fn clear_windows_clipboard() {
    clear_clipboard();
}

pub unsafe fn clear_clipboard_if_sequence_matches(expected_seq: u32) -> bool {
    imp::clear_clipboard_if_sequence_matches(expected_seq)
}
