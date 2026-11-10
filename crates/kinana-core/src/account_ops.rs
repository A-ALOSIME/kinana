use rand::RngCore;
use serde::{Deserialize, Serialize};

use crate::models::{Account, SecretString};

#[derive(Serialize, Deserialize, Default, Debug, Clone, PartialEq, Eq)]
pub struct AccountMetaPayload {
    #[serde(default)]
    pub email: String,
    #[serde(default)]
    pub recovery_key: String,
    #[serde(default)]
    pub notes: String,
}

/// Unpacks structured metadata (email, recovery key / CVV, notes) from an account's `notes` field
/// while remaining backward-compatible with plain-text notes.
pub fn unpack_account_notes(raw_notes: Option<&str>) -> (String, String, String) {
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

/// Packs optional email, recovery key / CVV, and notes back into the storage format.
pub fn pack_account_notes(email: &str, recovery_key: &str, notes: &str) -> Option<String> {
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

/// Extracts an optional `PIN:` line from packed plain-text notes if present.
pub fn extract_pin_from_notes(notes: &str) -> Option<String> {
    for line in notes.lines() {
        let trimmed = line.trim();
        if let Some(rest) = trimmed.strip_prefix("PIN:") {
            let pin = rest.trim();
            if !pin.is_empty() {
                return Some(pin.to_string());
            }
        }
    }
    None
}

/// Strips `PIN:` lines while preserving `[CARD]` markers and remaining notes cleanly.
pub fn strip_pin_lines(notes: &str) -> String {
    notes
        .lines()
        .filter(|l| !l.trim().starts_with("PIN:"))
        .map(str::trim_end)
        .collect::<Vec<_>>()
        .join("\n")
        .trim()
        .to_string()
}

/// Three-state account update input:
/// - Optional non-secret text fields (`label`, `username`, `email`, `url`, `notes`):
///   - `None`: keep existing stored value
///   - `Some("")` / whitespace-only: explicitly clear stored value
///   - `Some(non_empty)`: replace stored value
/// - Secret fields (`password`, `recovery_key`, card `PIN`):
///   - `None` or blank (without explicit `clear_*` flag): keep existing stored secret
///   - Non-empty `Some(val)`: update stored secret
///   - Explicit `clear_* == Some(true)`: wipe stored secret
#[derive(Debug, Default, Clone)]
pub struct AccountUpdateInput {
    pub label: Option<String>,
    pub username: Option<String>,
    pub password: Option<String>,
    pub email: Option<String>,
    pub recovery_key: Option<String>,
    pub notes: Option<String>,
    pub url: Option<String>,
    pub clear_recovery_key: Option<bool>,
    pub clear_pin: Option<bool>,
    pub clear_password: Option<bool>,
}

/// Applies validated three-state update semantics to an `Account` record in memory.
pub fn apply_account_update(account: &mut Account, input: AccountUpdateInput) {
    let (existing_email, existing_recovery_key, existing_notes) =
        unpack_account_notes(account.notes.as_deref());

    let final_email = match input.email {
        Some(em) => em.trim().to_string(),
        None => existing_email,
    };

    let final_recovery_key = if input.clear_recovery_key.unwrap_or(false) {
        String::new()
    } else {
        match input.recovery_key {
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

    let should_clear_pin = input.clear_pin.unwrap_or(false);
    let existing_pin_line = if should_clear_pin {
        None
    } else {
        existing_notes
            .lines()
            .find(|l| l.trim().starts_with("PIN:"))
            .map(|l| l.trim().to_string())
    };

    let final_notes = match input.notes {
        Some(n) => {
            let trimmed = n.trim().to_string();
            if should_clear_pin {
                strip_pin_lines(&trimmed)
            } else if trimmed.is_empty() {
                existing_pin_line.unwrap_or_default()
            } else if !trimmed.lines().any(|l| l.trim().starts_with("PIN:"))
                && existing_pin_line.is_some()
            {
                let pin = existing_pin_line.unwrap();
                if let Some(rest_raw) = trimmed.strip_prefix("[CARD]") {
                    let rest = rest_raw.trim();
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
                strip_pin_lines(&existing_notes)
            } else {
                existing_notes
            }
        }
    };

    let packed_notes = pack_account_notes(&final_email, &final_recovery_key, &final_notes);

    if let Some(lbl) = input.label {
        account.label = lbl.trim().to_string();
    }
    if let Some(user) = input.username {
        account.username = user.trim().to_string();
    }

    if input.clear_password.unwrap_or(false) {
        account.password = SecretString::new(String::new());
    } else if let Some(sec) = input.password {
        if !sec.trim().is_empty() {
            account.password = SecretString::new(sec);
        }
    }

    if let Some(u) = input.url {
        let trimmed = u.trim();
        account.url = if trimmed.is_empty() {
            None
        } else {
            Some(trimmed.to_string())
        };
    }

    account.notes = packed_notes;
}

/// Generates a uniform random password from CSPRNG (`OsRng`) without modulo bias.
pub fn generate_password_string(length: u8, use_symbols: bool) -> Result<String, String> {
    if !(12..=64).contains(&length) {
        return Err("Password length must be between 12 and 64 characters".to_string());
    }

    let mut charset: Vec<u8> =
        b"abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789".to_vec();
    if use_symbols {
        charset.extend_from_slice(b"!@#$%^&*");
    }

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
