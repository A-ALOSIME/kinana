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
                },
                Account {
                    id: "acc_without_pwd".to_string(),
                    label: "Empty".to_string(),
                    username: "user2".to_string(),
                    password: SecretString::new(String::new()),
                    notes: None,
                    url: None,
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
            }],
        });

        assert_eq!(vault.get_account_password("non_existent_service", "real_acc"), None);
        assert_eq!(vault.get_account_password("real_service", "non_existent_acc"), None);
        assert_eq!(vault.get_account_password("real_service", "real_acc"), Some("admin_pwd"));
    }
}
