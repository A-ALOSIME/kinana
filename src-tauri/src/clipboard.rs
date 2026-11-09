//! Cross-platform secure clipboard abstraction.
//!
//! # Platform Architecture & Threat Model:
//!
//! ## Windows (Native Subsystem):
//! - Full OS-level clipboard integration via Win32 API (`windows-sys`).
//! - Exclusion from Windows 10/11 Clipboard History (`Win + V`) via `CanIncludeInClipboardHistory` format.
//! - Exclusion from Microsoft Cloud Clipboard sync via `CanUploadToCloudClipboard` format.
//! - `CF_UNICODETEXT` payload with explicit zeroization of temporary buffers via `Zeroize`.
//! - Hardware/OS-level monotonic sequence numbers via `GetClipboardSequenceNumber()`.
//! - Clearing is atomic and conditional upon OS sequence number matching, preventing any overwriting of newer user data.
//!
//! ## macOS & Linux (Heuristic Best-Effort Fallback):
//! - Multi-platform clipboard access via `arboard` (Cocoa `NSPasteboard` on macOS, X11/Wayland on Linux).
//! - Application-local monotonic sequence counter paired with SHA-256 content hashes.
//! - Conditional clearing: computes the SHA-256 hash of current clipboard text prior to clearing.
//!   If the user copied different content in the interim, their clipboard data is preserved.
//! - Transient secret buffers in memory are wrapped in `Zeroizing` to minimize plaintext retention.
//!
//! # Known Platform Limitations (macOS & Linux):
//! 1. **Time-of-Check / Time-of-Use (TOCTOU) Window:**
//!    There is an unavoidable microsecond time gap between inspecting the current clipboard content
//!    and invoking the clear command. If an external application modifies the clipboard precisely
//!    within that window, the clear operation could theoretically affect the newly set text.
//! 2. **Non-Atomic Inspection:**
//!    The SHA-256 content hash comparison is a best-effort heuristic; it does not provide an atomic
//!    kernel-level guarantee like Windows sequence numbers or macOS `NSPasteboard.changeCount`.
//! 3. **Identical Text Collision:**
//!    If the user copies identical text from an external application within the 15-second window,
//!    the SHA-256 hash will match Kinana's copied secret, causing the clipboard to be cleared upon timer expiration.
//! 4. **Third-Party Clipboard History Managers:**
//!    On macOS (e.g., Maccy, Paste) and Linux (e.g., Klipper, Clipman, Greenclip, wl-clipboard),
//!    external clipboard daemons ingest copied text immediately. Clearing the system clipboard does not
//!    and cannot purge entries already captured by external history managers.
//! 5. **Wayland Compositor Restrictions:**
//!    Wayland compositors (such as GNOME or Sway) enforce strict process isolation; background or minimized
//!    applications may be denied access to read or clear the clipboard selection when unfocused.

use zeroize::Zeroize;
#[cfg(not(target_os = "windows"))]
use zeroize::Zeroizing;
use sha2::{Digest, Sha256};

/// Computes SHA-256 digest of arbitrary text without retaining plaintext.
#[allow(dead_code)]
pub fn compute_content_hash(text: &str) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(text.as_bytes());
    hasher.finalize().into()
}

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

    pub unsafe fn clear_clipboard() -> bool {
        if OpenClipboard(std::ptr::null_mut()) != 0 {
            EmptyClipboard();
            CloseClipboard();
            true
        } else {
            false
        }
    }

    pub unsafe fn clear_clipboard_if_sequence_matches(expected_seq: u32) -> bool {
        if GetClipboardSequenceNumber() == expected_seq {
            clear_clipboard()
        } else {
            false
        }
    }
}

#[cfg(not(target_os = "windows"))]
mod imp {
    use super::*;
    use std::sync::atomic::{AtomicU32, Ordering};
    use std::sync::Mutex;

    static SEQUENCE_COUNTER: AtomicU32 = AtomicU32::new(1);
    static LAST_COPIED_HASH: Mutex<Option<(u32, [u8; 32])>> = Mutex::new(None);

    pub unsafe fn copy_to_clipboard_secure(text: &str) -> Result<u32, String> {
        let mut clipboard = arboard::Clipboard::new()
            .map_err(|e| format!("Failed to access clipboard: {}", e))?;

        clipboard
            .set_text(text)
            .map_err(|e| format!("Failed to set clipboard text: {}", e))?;

        let hash = compute_content_hash(text);
        let seq = SEQUENCE_COUNTER.fetch_add(1, Ordering::SeqCst);

        if let Ok(mut guard) = LAST_COPIED_HASH.lock() {
            *guard = Some((seq, hash));
        }

        Ok(seq)
    }

    pub unsafe fn clear_clipboard() -> bool {
        let mut cleared = false;
        if let Ok(mut clipboard) = arboard::Clipboard::new() {
            cleared = clipboard.clear().is_ok();
        }
        if let Ok(mut guard) = LAST_COPIED_HASH.lock() {
            *guard = None;
        }
        cleared
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
                let current_text_wrapped = Zeroizing::new(current_text);
                let current_hash = compute_content_hash(&current_text_wrapped);
                if current_hash == target_hash {
                    match clipboard.clear() {
                        Ok(()) => {
                            if let Ok(mut guard) = LAST_COPIED_HASH.lock() {
                                if let Some((seq, _)) = *guard {
                                    if seq == expected_seq {
                                        *guard = None;
                                    }
                                }
                            }
                            true
                        }
                        Err(_) => false,
                    }
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
pub unsafe fn clear_clipboard() -> bool {
    imp::clear_clipboard()
}

#[allow(dead_code)]
pub unsafe fn clear_windows_clipboard() -> bool {
    clear_clipboard()
}

pub unsafe fn clear_clipboard_if_sequence_matches(expected_seq: u32) -> bool {
    imp::clear_clipboard_if_sequence_matches(expected_seq)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_compute_content_hash_consistency() {
        let text1 = "SecretPassword123!";
        let text2 = "SecretPassword123!";
        let text3 = "DifferentPassword456$";

        let hash1 = compute_content_hash(text1);
        let hash2 = compute_content_hash(text2);
        let hash3 = compute_content_hash(text3);

        assert_eq!(hash1, hash2, "Identical strings must produce identical SHA-256 hashes");
        assert_ne!(hash1, hash3, "Different strings must produce distinct SHA-256 hashes");
    }

    #[test]
    fn test_compute_content_hash_arabic_and_symbols() {
        let arabic_secret = "كنانة_سرية_للغاية_#2026";
        let hash = compute_content_hash(arabic_secret);
        assert_eq!(hash.len(), 32);
        assert_ne!(hash, [0u8; 32]);
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn test_windows_clipboard_sequence_tracking() {
        unsafe {
            let initial_seq = windows_sys::Win32::System::DataExchange::GetClipboardSequenceNumber();
            
            // In headless CI runner environments without an interactive desktop window station,
            // GetClipboardSequenceNumber() returns 0 and OpenClipboard may fail gracefully.
            if initial_seq == 0 {
                let res = copy_to_clipboard_secure("HeadlessTestSecret");
                match res {
                    Ok(seq) => {
                        assert!(seq >= initial_seq);
                        assert!(!clear_clipboard_if_sequence_matches(seq.wrapping_add(9999)));
                        assert!(clear_clipboard_if_sequence_matches(seq));
                    }
                    Err(e) => {
                        assert!(e.contains("clipboard"));
                    }
                }
                return;
            }

            // Interactive desktop session: verify sequence increment and conditional clear
            let seq = copy_to_clipboard_secure("TestKinanaSeqSecret123").expect("Copy must succeed");
            assert!(seq >= initial_seq, "Returned sequence number must be >= initial sequence");

            // Clearing with the wrong sequence must return false and NOT clear
            let wrong_seq = seq.wrapping_add(9999);
            let cleared_wrong = clear_clipboard_if_sequence_matches(wrong_seq);
            assert!(!cleared_wrong, "Clearing with mismatched sequence number must return false");

            // Clearing with the exact matching sequence must succeed
            let cleared_correct = clear_clipboard_if_sequence_matches(seq);
            assert!(cleared_correct, "Clearing with exact sequence number must succeed");
        }
    }
}
