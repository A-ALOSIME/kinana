//! Native Windows Clipboard helper with security formats.
//!
//! # Security Features:
//! 1. Exclude from Windows 10/11 Clipboard History (Win + V) via `CanIncludeInClipboardHistory`.
//! 2. Prevent cloud sync across devices via `CanUploadToCloudClipboard`.
//! 3. Explicit zeroization of in-memory UTF-16 text buffer.
//! 4. Sequence number checking to avoid clearing user's overwritten clipboard content.

use zeroize::Zeroize;

/// Native Windows Clipboard helper with security formats.
///
/// SAFETY:
/// Calling Win32 native clipboard functions (OpenClipboard, EmptyClipboard, SetClipboardData, CloseClipboard)
/// and memory allocation functions (GlobalAlloc, GlobalLock, GlobalUnlock) requires `unsafe`.
/// We are manually managing global memory blocks allocated via the Win32 subsystem, ensuring
/// pointers are valid and that clipboard ownership is properly transferred to the Windows OS.
pub unsafe fn copy_to_windows_clipboard_secure(text: &str) -> Result<u32, String> {
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

/// Clears Windows clipboard unconditionally.
/// SAFETY: Opens and empties clipboard using standard Win32 API.
pub unsafe fn clear_windows_clipboard() {
    use windows_sys::Win32::System::DataExchange::{CloseClipboard, EmptyClipboard, OpenClipboard};
    if OpenClipboard(std::ptr::null_mut()) != 0 {
        EmptyClipboard();
        CloseClipboard();
    }
}

/// Clears Windows clipboard if and only if the current sequence number matches `expected_seq`.
/// Returns true if the clipboard was cleared, false if the user has since copied something else.
/// SAFETY: Calls Win32 GetClipboardSequenceNumber and conditionally clears the clipboard.
pub unsafe fn clear_clipboard_if_sequence_matches(expected_seq: u32) -> bool {
    use windows_sys::Win32::System::DataExchange::GetClipboardSequenceNumber;
    if GetClipboardSequenceNumber() == expected_seq {
        clear_windows_clipboard();
        true
    } else {
        false
    }
}
