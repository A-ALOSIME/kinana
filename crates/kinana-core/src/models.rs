use serde::{Deserialize, Deserializer, Serialize, Serializer};
use zeroize::Zeroizing;

/// A secret string that automatically wipes its memory from RAM upon drop.
/// Debug formatting masks the content so it can never leak into logs.
/// Strictly DOES NOT implement Clone or Copy to prevent secret duplication in RAM.
#[derive(Default)]
pub struct SecretString(pub Zeroizing<String>);

impl SecretString {
    pub fn new(val: String) -> Self {
        Self(Zeroizing::new(val))
    }

    pub fn as_str(&self) -> &str {
        self.0.as_str()
    }
}

impl std::fmt::Debug for SecretString {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "SecretString(***REDACTED***)")
    }
}

impl Serialize for SecretString {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_str(self.0.as_str())
    }
}

impl<'de> Deserialize<'de> for SecretString {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let s = String::deserialize(deserializer)?;
        Ok(SecretString::new(s))
    }
}

/// Explicit persisted account type (`login` vs `card`).
/// Preserving explicit user selection avoids relying on service name heuristics.
#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub enum AccountKind {
    #[default]
    Login,
    Card,
}

/// Checks whether a service name typically represents a bank or payment card service
/// (used only as an initial creation-form default and cautious legacy fallback).
pub fn is_bank_or_card_service_name(service_name: &str) -> bool {
    let lower = service_name.to_lowercase();
    const ENGLISH_MARKERS: &[&str] = &[
        "visa",
        "mastercard",
        "mada",
        "al rajhi",
        "snb",
        "alinma",
        "urpay",
        "stc pay",
    ];
    if ENGLISH_MARKERS.iter().any(|m| lower.contains(m)) {
        return true;
    }

    const ARABIC_MARKERS: &[&str] = &[
        "بطاقة",
        "فيزا",
        "ماستركارد",
        "مدى",
        "بنك",
        "مصرف",
        "الراجحي",
        "الأهلي",
        "الإنماء",
    ];
    ARABIC_MARKERS.iter().any(|m| service_name.contains(m))
}

fn is_legacy_expiry_url(url: &str) -> bool {
    let b = url.trim().as_bytes();
    b.len() == 5
        && b[0].is_ascii_digit()
        && b[1].is_ascii_digit()
        && b[2] == b'/'
        && b[3].is_ascii_digit()
        && b[4].is_ascii_digit()
}

fn is_legacy_card_number(secret: &str) -> bool {
    let trimmed = secret.trim();
    if trimmed.is_empty() {
        return false;
    }
    let mut digits = 0usize;
    for ch in trimmed.chars() {
        if ch.is_ascii_digit() {
            digits += 1;
        } else if ch != ' ' && ch != '-' {
            return false;
        }
    }
    (13..=19).contains(&digits)
}

/// An individual account credential.
/// Does NOT derive Clone to prevent duplicating sensitive data in RAM.
#[derive(Serialize, Deserialize, Debug)]
pub struct Account {
    pub id: String,
    pub label: String,
    pub username: String,
    pub password: SecretString,
    pub notes: Option<String>,
    pub url: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub account_kind: Option<AccountKind>,
}

impl Account {
    /// Resolves the authoritative account type (`login` or `card`).
    /// When an explicit `account_kind` was persisted, it is ALWAYS honored regardless of parent service name.
    /// Only legacy pre-`account_kind` records (`account_kind == None`) fall back to card markers.
    pub fn resolve_kind(&self, service_name: &str) -> AccountKind {
        if let Some(explicit) = self.account_kind {
            return explicit;
        }

        let (email, _rec, unpacked_notes) =
            crate::account_ops::unpack_account_notes(self.notes.as_deref());

        if self.notes.as_deref().map_or(false, |n| n.contains("[CARD]"))
            || unpacked_notes.contains("[CARD]")
            || crate::account_ops::extract_pin_from_notes(&unpacked_notes).is_some()
        {
            return AccountKind::Card;
        }

        if self.url.as_deref().map_or(false, is_legacy_expiry_url) {
            return AccountKind::Card;
        }

        // Legacy vaults created before explicit `account_kind` never saved login accounts cleanly
        // inside banking services, EXCEPT login accounts lack `[CARD]` / `MM/YY` and usually carry
        // an email, a website URL, or a non-digit password. Preserve obvious legacy bank cards
        // while allowing legacy non-card bank logins to classify accurately as `Login`.
        if is_bank_or_card_service_name(service_name) {
            let has_web_url = self
                .url
                .as_deref()
                .map_or(false, |u| {
                    let t = u.trim();
                    !t.is_empty() && (t.contains("://") || t.contains('.'))
                });
            if email.trim().is_empty()
                && !has_web_url
                && (self.label.trim() == "بطاقة بنكية"
                    || is_legacy_card_number(self.password.as_str()))
            {
                return AccountKind::Card;
            }
        }

        AccountKind::Login
    }
}

/// A service containing a group of accounts.
/// Does NOT derive Clone to prevent duplicating sensitive data in RAM.
#[derive(Serialize, Deserialize, Debug)]
pub struct Service {
    pub id: String,
    pub name: String,
    /// Encrypted local icon stored directly inside the vault (base64 PNG/SVG/JPEG, zero network requests)
    pub icon_data: Option<String>,
    pub accounts: Vec<Account>,
}

/// The root in-memory vault data model.
/// Does NOT derive Clone to prevent duplicating the entire database in RAM.
#[derive(Serialize, Deserialize, Debug, Default)]
pub struct VaultData {
    pub version: u32,
    pub created_at: u64,
    pub updated_at: u64,
    #[serde(default)]
    pub recovery_code: Option<String>,
    pub services: Vec<Service>,
}

// =========================================================================
// SAFE PROJECTION FOR FRONTEND
// The frontend only receives metadata. Passwords strictly stay in Rust RAM!
// =========================================================================

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct AccountSummary {
    pub id: String,
    pub label: String,
    pub username: String,
    pub has_password: bool,
    pub has_notes: bool,
    pub url: Option<String>,
    pub account_kind: AccountKind,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ServiceSummary {
    pub id: String,
    pub name: String,
    pub icon_data: Option<String>,
    pub accounts: Vec<AccountSummary>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct VaultSummary {
    pub services: Vec<ServiceSummary>,
    pub total_services: usize,
    pub total_accounts: usize,
    pub updated_at: u64,
}

impl VaultData {
    /// Generates a sanitized summary projection for the frontend.
    /// Crucial security boundary: Passwords are NOT included in this structure.
    pub fn to_summary(&self) -> VaultSummary {
        let mut total_accounts = 0;
        let services = self
            .services
            .iter()
            .map(|svc| {
                total_accounts += svc.accounts.len();
                ServiceSummary {
                    id: svc.id.clone(),
                    name: svc.name.clone(),
                    icon_data: svc.icon_data.clone(),
                    accounts: svc
                        .accounts
                        .iter()
                        .map(|acc| AccountSummary {
                            id: acc.id.clone(),
                            label: acc.label.clone(),
                            username: acc.username.clone(),
                            has_password: !acc.password.as_str().is_empty(),
                            has_notes: acc.notes.as_ref().map_or(false, |n| !n.is_empty()),
                            url: acc.url.clone(),
                            account_kind: acc.resolve_kind(&svc.name),
                        })
                        .collect(),
                }
            })
            .collect();

        VaultSummary {
            services,
            total_services: self.services.len(),
            total_accounts,
            updated_at: self.updated_at,
        }
    }

    /// Retrieve a specific account's password from Rust memory by service_id and account_id
    pub fn get_account_password(&self, service_id: &str, account_id: &str) -> Option<&str> {
        self.services
            .iter()
            .find(|s| s.id == service_id)?
            .accounts
            .iter()
            .find(|a| a.id == account_id)
            .map(|a| a.password.as_str())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_secret_string_debug_format_redacted() {
        let plain = "my_super_secret_password_987";
        let secret = SecretString::new(plain.to_string());
        let debug_str = format!("{:?}", secret);

        assert!(debug_str.contains("REDACTED"));
        assert!(!debug_str.contains(plain));
    }

    #[test]
    fn test_vault_data_to_summary_has_password_flag() {
        let mut vault = VaultData::default();
        vault.services.push(Service {
            id: "svc_1".to_string(),
            name: "TestService".to_string(),
            icon_data: None,
            accounts: vec![
                Account {
                    id: "acc_with_pwd".to_string(),
                    label: "Main".to_string(),
                    username: "user1".to_string(),
                    password: SecretString::new("secret123".to_string()),
                    notes: None,
                    url: None,
                    account_kind: Some(AccountKind::Login),
                },
                Account {
                    id: "acc_without_pwd".to_string(),
                    label: "Empty".to_string(),
                    username: "user2".to_string(),
                    password: SecretString::new(String::new()),
                    notes: None,
                    url: None,
                    account_kind: Some(AccountKind::Login),
                },
            ],
        });

        let summary = vault.to_summary();
        assert_eq!(summary.services.len(), 1);
        let accounts = &summary.services[0].accounts;
        assert_eq!(accounts.len(), 2);

        assert!(accounts[0].has_password);
        assert!(!accounts[1].has_password);
    }

    #[test]
    fn test_get_account_password_wrong_service_id_returns_none() {
        let mut vault = VaultData::default();
        vault.services.push(Service {
            id: "real_service".to_string(),
            name: "Real".to_string(),
            icon_data: None,
            accounts: vec![Account {
                id: "real_acc".to_string(),
                label: "Account".to_string(),
                username: "admin".to_string(),
                password: SecretString::new("admin_pwd".to_string()),
                notes: None,
                url: None,
                account_kind: Some(AccountKind::Login),
            }],
        });

        assert_eq!(vault.get_account_password("non_existent_service", "real_acc"), None);
        assert_eq!(vault.get_account_password("real_service", "non_existent_acc"), None);
        assert_eq!(vault.get_account_password("real_service", "real_acc"), Some("admin_pwd"));
    }

    #[test]
    fn test_explicit_account_kind_overrides_bank_service_name_and_legacy_cards_preserved() {
        let mut vault = VaultData::default();
        vault.services.push(Service {
            id: "bank_1".to_string(),
            name: "Al Rajhi Bank".to_string(),
            icon_data: None,
            accounts: vec![
                Account {
                    id: "explicit_login".to_string(),
                    label: "Al Mubasher".to_string(),
                    username: "user_bank".to_string(),
                    password: SecretString::new("StrongBankPass!1".to_string()),
                    notes: None,
                    url: Some("https://almubasher.com.sa".to_string()),
                    account_kind: Some(AccountKind::Login),
                },
                Account {
                    id: "explicit_card".to_string(),
                    label: "Mada Card".to_string(),
                    username: "USER NAME".to_string(),
                    password: SecretString::new("4111111111111111".to_string()),
                    notes: Some("[CARD]".to_string()),
                    url: Some("08/29".to_string()),
                    account_kind: Some(AccountKind::Card),
                },
                Account {
                    id: "legacy_card".to_string(),
                    label: "Old Salary Card".to_string(),
                    username: "USER".to_string(),
                    password: SecretString::new("5222222222222222".to_string()),
                    notes: Some("[CARD]\nPIN: 1234".to_string()),
                    url: Some("01/28".to_string()),
                    account_kind: None,
                },
                Account {
                    id: "legacy_login_in_bank".to_string(),
                    label: "Old Online Banking".to_string(),
                    username: "online_user".to_string(),
                    password: SecretString::new("MyOldBankPass!".to_string()),
                    notes: None,
                    url: Some("https://alrajhibank.com.sa".to_string()),
                    account_kind: None,
                },
            ],
        });
        vault.services.push(Service {
            id: "generic_1".to_string(),
            name: "Personal Misc".to_string(),
            icon_data: None,
            accounts: vec![Account {
                id: "card_in_generic".to_string(),
                label: "Travel Wallet".to_string(),
                username: "TRAVELER".to_string(),
                password: SecretString::new("4000000000000002".to_string()),
                notes: Some("[CARD]".to_string()),
                url: Some("11/30".to_string()),
                account_kind: Some(AccountKind::Card),
            }],
        });

        let summary = vault.to_summary();
        assert_eq!(summary.services[0].accounts[0].account_kind, AccountKind::Login);
        assert_eq!(summary.services[0].accounts[1].account_kind, AccountKind::Card);
        assert_eq!(summary.services[0].accounts[2].account_kind, AccountKind::Card);
        assert_eq!(summary.services[0].accounts[3].account_kind, AccountKind::Login);
        assert_eq!(summary.services[1].accounts[0].account_kind, AccountKind::Card);
    }
}
