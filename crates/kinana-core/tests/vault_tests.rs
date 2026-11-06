use std::fs;
use tempfile::tempdir;

use kinana_core::{
    crypto::{Argon2Parameters, MIN_VAULT_FILE_SIZE},
    error::VaultError,
    models::{Account, SecretString, Service},
    storage::VaultStorage,
};

/// 1. إنشاء vault جديد والـ unlock بنفس الباسورد: ينجح
#[test]
fn test_create_new_vault_and_unlock_with_same_password() {
    let dir = tempdir().unwrap();
    let vault_path = dir.path().join("vault.dat");
    let storage = VaultStorage::new(&vault_path);

    let master_password = "CorrectMasterPassword#2026!";
    let fast_params = Argon2Parameters {
        m_cost: 16 * 1024,
        t_cost: 1,
        p_cost: 1,
    };

    // Create new vault session and save to disk
    let mut session = storage
        .create_new_vault(master_password, Some(fast_params))
        .expect("Failed to create new vault session");

    storage
        .save(&mut session)
        .expect("Failed to save newly created vault");

    assert!(vault_path.exists());

    // Unlock using the exact same password
    let unlocked = storage
        .unlock(master_password)
        .expect("Failed to unlock vault with correct password");

    assert_eq!(unlocked.data.services.len(), 0);
}

/// 2. unlock بباسورد خاطئ: ترجع DecryptionFailed
#[test]
fn test_unlock_with_wrong_password_returns_decryption_failed() {
    let dir = tempdir().unwrap();
    let vault_path = dir.path().join("vault.dat");
    let storage = VaultStorage::new(&vault_path);

    let fast_params = Argon2Parameters {
        m_cost: 16 * 1024,
        t_cost: 1,
        p_cost: 1,
    };

    let mut session = storage
        .create_new_vault("CorrectPassword123", Some(fast_params))
        .unwrap();

    storage.save(&mut session).unwrap();

    // Attempt unlock with wrong password
    let res = storage.unlock("IncorrectPassword456");
    assert!(
        matches!(res, Err(VaultError::DecryptionFailed)),
        "Expected DecryptionFailed error, got: {:?}",
        res
    );
}

/// 3. save ثم unlock من جديد: البيانات محفوظة ومتطابقة
#[test]
fn test_save_and_unlock_again_preserves_data() {
    let dir = tempdir().unwrap();
    let vault_path = dir.path().join("vault.dat");
    let storage = VaultStorage::new(&vault_path);

    let master_password = "PersistentVaultPassword@99";
    let fast_params = Argon2Parameters {
        m_cost: 16 * 1024,
        t_cost: 1,
        p_cost: 1,
    };

    let mut session = storage
        .create_new_vault(master_password, Some(fast_params))
        .unwrap();

    // Add service and account
    session.data.services.push(Service {
        id: "svc_steam".to_string(),
        name: "Steam".to_string(),
        icon_data: Some("base64_icon_data_mock".to_string()),
        accounts: vec![Account {
            id: "acc_gamer1".to_string(),
            label: "Main Gaming Account".to_string(),
            username: "pro_gamer".to_string(),
            password: SecretString::new("P@ssw0rdForSteam!".to_string()),
            notes: Some("Steam guard enabled".to_string()),
            url: Some("https://store.steampowered.com".to_string()),
        }],
    });

    storage.save(&mut session).unwrap();

    // Re-open and verify
    let reloaded = storage.unlock(master_password).unwrap();
    assert_eq!(reloaded.data.services.len(), 1);

    let service = &reloaded.data.services[0];
    assert_eq!(service.id, "svc_steam");
    assert_eq!(service.name, "Steam");
    assert_eq!(service.icon_data.as_deref(), Some("base64_icon_data_mock"));
    assert_eq!(service.accounts.len(), 1);

    let account = &service.accounts[0];
    assert_eq!(account.id, "acc_gamer1");
    assert_eq!(account.username, "pro_gamer");
    assert_eq!(account.password.as_str(), "P@ssw0rdForSteam!");
    assert_eq!(account.notes.as_deref(), Some("Steam guard enabled"));
}

/// 4. save بـ session.key لا يطابق الملف الموجود: ترجع ExistingVaultCorrupted والملف الأصلي لم يتغير
#[test]
fn test_save_with_mismatched_session_key_fails_and_preserves_original_file() {
    let dir = tempdir().unwrap();
    let vault_path = dir.path().join("vault.dat");
    let storage = VaultStorage::new(&vault_path);

    let fast_params = Argon2Parameters {
        m_cost: 16 * 1024,
        t_cost: 1,
        p_cost: 1,
    };

    // Create and save original vault with Password A
    let mut session_a = storage
        .create_new_vault("Password_A", Some(fast_params))
        .unwrap();
    session_a.data.services.push(Service {
        id: "svc_original".to_string(),
        name: "OriginalService".to_string(),
        icon_data: None,
        accounts: vec![],
    });
    storage.save(&mut session_a).unwrap();

    let original_bytes = fs::read(&vault_path).unwrap();

    // Now create a different storage pointing elsewhere and create session with Password B
    let other_dir = tempdir().unwrap();
    let other_vault_path = other_dir.path().join("other_vault.dat");
    let other_storage = VaultStorage::new(&other_vault_path);
    let mut session_b = other_storage
        .create_new_vault("Password_B", Some(fast_params))
        .unwrap();

    // Attempt to save session_b into the first storage (vault_path of Password A)
    let res = storage.save(&mut session_b);
    assert!(
        matches!(res, Err(VaultError::ExistingVaultCorrupted(_))),
        "Expected ExistingVaultCorrupted error, got: {:?}",
        res
    );

    // Verify original file on disk is completely untouched and still decrypts with Password A
    let current_bytes = fs::read(&vault_path).unwrap();
    assert_eq!(current_bytes, original_bytes);

    let unlocked_a = storage
        .unlock("Password_A")
        .expect("Original vault should still unlock cleanly with Password A");
    assert_eq!(unlocked_a.data.services[0].name, "OriginalService");
}

/// 5. وجود ملف تالف مسبقاً: لا يمسح vault.dat.bak السليم
#[test]
fn test_corrupted_file_on_disk_does_not_overwrite_valid_backup() {
    let dir = tempdir().unwrap();
    let vault_path = dir.path().join("vault.dat");
    let backup_path = dir.path().join("vault.dat.bak");
    let storage = VaultStorage::new(&vault_path);

    let master_password = "SafeBackupPassword#1";
    let fast_params = Argon2Parameters {
        m_cost: 16 * 1024,
        t_cost: 1,
        p_cost: 1,
    };

    // 1. Create and save valid vault
    let mut session = storage
        .create_new_vault(master_password, Some(fast_params))
        .unwrap();
    session.data.services.push(Service {
        id: "svc_golden".to_string(),
        name: "GoldenStateData".to_string(),
        icon_data: None,
        accounts: vec![],
    });
    storage.save(&mut session).unwrap();

    // Save again so that vault.dat.bak is created containing the golden state
    session.data.updated_at = 12345;
    storage.save(&mut session).unwrap();

    assert!(backup_path.exists(), "Backup file should exist");
    let original_backup_bytes = fs::read(&backup_path).unwrap();

    // 2. Corrupt vault.dat directly on disk (e.g. disk corruption / garbage bytes)
    fs::write(&vault_path, b"MALFORMED_GARBAGE_BYTES_SIMULATING_CORRUPTION").unwrap();

    // 3. Attempt to save session: must be REJECTED and must NOT touch the valid backup file
    let res = storage.save(&mut session);
    assert!(
        matches!(res, Err(VaultError::ExistingVaultCorrupted(_))),
        "Expected ExistingVaultCorrupted error, got: {:?}",
        res
    );

    // 4. Verify backup was not overwritten or destroyed
    let backup_bytes_after = fs::read(&backup_path).unwrap();
    assert_eq!(
        backup_bytes_after, original_backup_bytes,
        "Backup file was modified when it should have been protected!"
    );

    // 5. Verify that disaster recovery restore_from_backup restores the valid state
    storage
        .restore_from_backup()
        .expect("Restoring from backup should succeed");
    let restored = storage
        .unlock(master_password)
        .expect("Restored vault should unlock cleanly");
    assert_eq!(restored.data.services[0].name, "GoldenStateData");
}

/// 6. unlock على ملف أقل من MIN_VAULT_FILE_SIZE: ترجع FileTooShort
#[test]
fn test_unlock_on_file_smaller_than_min_size_returns_file_too_short() {
    let dir = tempdir().unwrap();
    let vault_path = dir.path().join("vault.dat");
    let storage = VaultStorage::new(&vault_path);

    // Write a tiny 15-byte file (MIN_VAULT_FILE_SIZE is 82 bytes)
    fs::write(&vault_path, b"TooShortHeader!").unwrap();

    let res = storage.unlock("SomePassword");
    match res {
        Err(VaultError::FileTooShort(size, min_required)) => {
            assert_eq!(size, 15);
            assert_eq!(min_required, MIN_VAULT_FILE_SIZE);
        }
        other => panic!("Expected VaultError::FileTooShort, got: {:?}", other),
    }
}

/// 7. اختبار rekey: تغيير كلمة المرور للمفتاح الجديد وفشل القديم وتطابق البيانات
#[test]
fn test_save_rekey_rotates_password_and_preserves_data() {
    let dir = tempdir().unwrap();
    let vault_path = dir.path().join("vault.dat");
    let storage = VaultStorage::new(&vault_path);

    let old_password = "OldMasterPassword123#";
    let new_password = "NewMasterPassword456$";
    let fast_params = Argon2Parameters {
        m_cost: 16 * 1024,
        t_cost: 1,
        p_cost: 1,
    };

    let mut session = storage
        .create_new_vault(old_password, Some(fast_params))
        .expect("Failed to create vault session");

    session.data.services.push(Service {
        id: "svc_github".to_string(),
        name: "GitHub".to_string(),
        icon_data: None,
        accounts: vec![Account {
            id: "acc_git1".to_string(),
            label: "Dev Account".to_string(),
            username: "octocat".to_string(),
            password: SecretString::new("ghp_secret_token_123".to_string()),
            notes: Some("SSH key configured".to_string()),
            url: Some("https://github.com".to_string()),
        }],
    });

    storage.save(&mut session).expect("Failed to save initial vault");

    // 1. Prepare rekey
    let old_key = kinana_core::crypto::DerivedKey::new(*session.key.as_bytes());
    let new_header = kinana_core::crypto::VaultHeader::new_with_fresh_salts(session.header.argon2_params)
        .expect("Fresh header creation failed");
    let new_key = kinana_core::crypto::derive_key(new_password, &new_header.salt, &new_header.argon2_params)
        .expect("Derive new key failed");

    session.header = new_header;
    session.key = new_key;

    // 2. Perform atomic rekey
    storage.save_rekey(&mut session, &old_key).expect("save_rekey failed");

    // 3. Unlock with old password MUST fail
    let old_attempt = storage.unlock(old_password);
    assert!(
        matches!(old_attempt, Err(VaultError::DecryptionFailed)),
        "Old password should not unlock the rekeyed vault"
    );

    // 4. Unlock with new password MUST succeed with all data intact
    let new_attempt = storage.unlock(new_password).expect("New password should unlock cleanly");
    assert_eq!(new_attempt.data.services.len(), 1);
    assert_eq!(new_attempt.data.services[0].name, "GitHub");
    assert_eq!(new_attempt.data.services[0].accounts[0].username, "octocat");
    assert_eq!(new_attempt.data.services[0].accounts[0].password.as_str(), "ghp_secret_token_123");
}

/// 8. اختبار فحص الحمولة المشفرة: أي عبث في البايتات المشفرة يفشل فك التشفير فوراً
#[test]
fn test_corrupt_payload_fails_decryption() {
    let dir = tempdir().unwrap();
    let vault_path = dir.path().join("vault.dat");
    let storage = VaultStorage::new(&vault_path);

    let password = "TamperResistanceTest#1";
    let fast_params = Argon2Parameters {
        m_cost: 16 * 1024,
        t_cost: 1,
        p_cost: 1,
    };

    let mut session = storage
        .create_new_vault(password, Some(fast_params))
        .unwrap();
    storage.save(&mut session).unwrap();

    // Tamper with payload byte on disk (after header)
    let mut bytes = fs::read(&vault_path).unwrap();
    assert!(bytes.len() > kinana_core::crypto::HEADER_SIZE);
    bytes[kinana_core::crypto::HEADER_SIZE + 5] ^= 0xFF; // Flip bits
    fs::write(&vault_path, &bytes).unwrap();

    let res = storage.unlock(password);
    assert!(
        matches!(res, Err(VaultError::DecryptionFailed)),
        "Corrupted payload must be rejected by AES-GCM verification"
    );
}

/// 9. اختبار دورة مفتاح استرداد الطوارئ المشفر بالكامل
#[test]
fn test_emergency_recovery_flow() {
    let recovery_code = "KN-ABCD-EFGH-JKLM-NPQR";
    let master_password = "MySuperSecretMasterPassword2026";

    let params = Argon2Parameters {
        m_cost: 16 * 1024,
        t_cost: 1,
        p_cost: 1,
    };
    let header = kinana_core::crypto::VaultHeader::new_with_fresh_salts(params).unwrap();
    let key = kinana_core::crypto::derive_key(recovery_code, &header.salt, &header.argon2_params).unwrap();

    let ciphertext = kinana_core::crypto::encrypt_payload(master_password.as_bytes(), &key, &header).unwrap();

    // Decrypt with correct recovery code succeeds
    let (_hdr, decrypted_payload) = kinana_core::crypto::decrypt_payload(&ciphertext, &key).unwrap();
    assert_eq!(std::str::from_utf8(decrypted_payload.as_slice()).unwrap(), master_password);

    // Decrypt with wrong recovery code fails
    let wrong_key = kinana_core::crypto::derive_key("KN-ZZZZ-YYYY-XXXX-WWWW", &header.salt, &header.argon2_params).unwrap();
    let failed = kinana_core::crypto::decrypt_payload(&ciphertext, &wrong_key);
    assert!(failed.is_err(), "Wrong recovery code must fail decryption");
}

/// 10. اختبار حفظ مفتاح الاسترداد في بيانات الخزنة واستمرار صلاحيته في عمليات استرداد متتالية
#[test]
fn test_recovery_code_persists_in_vault_data_and_supports_consecutive_recoveries() {
    let dir = tempdir().unwrap();
    let vault_path = dir.path().join("vault.dat");
    let storage = VaultStorage::new(&vault_path);

    let password = "MainMasterPassword123#";
    let recovery_code = "KN-RECO-VERY-TEST-2026";
    let fast_params = Argon2Parameters {
        m_cost: 16 * 1024,
        t_cost: 1,
        p_cost: 1,
    };

    let mut session = storage
        .create_new_vault(password, Some(fast_params))
        .unwrap();

    // 1. تثبيت مفتاح الاسترداد داخل بيانات الخزنة المشفرة
    session.data.recovery_code = Some(recovery_code.to_string());
    storage.save(&mut session).unwrap();

    // 2. محاكاة إنشاء ملف recovery.dat المشفر برمز الاسترداد
    let rec_header = kinana_core::crypto::VaultHeader::new_with_fresh_salts(fast_params).unwrap();
    let rec_key = kinana_core::crypto::derive_key(recovery_code, &rec_header.salt, &rec_header.argon2_params).unwrap();
    let recovery_dat = kinana_core::crypto::encrypt_payload(password.as_bytes(), &rec_key, &rec_header).unwrap();

    // 3. إعادة فتح الخزنة بكلمة المرور الرئيسية والتأكد من استرجاع مفتاح الاسترداد من القرص
    let reloaded_session = storage.unlock(password).unwrap();
    assert_eq!(
        reloaded_session.data.recovery_code.as_deref(),
        Some(recovery_code),
        "Recovery code must be loaded from decrypted vault data"
    );

    // 4. استرداد الخزنة أول مرة عبر مفتاح الاسترداد
    let (_hdr1, plain1) = kinana_core::crypto::decrypt_payload(&recovery_dat, &rec_key).unwrap();
    let recovered_pwd1 = std::str::from_utf8(plain1.as_slice()).unwrap();
    let unlocked_1 = storage.unlock(recovered_pwd1).unwrap();
    assert_eq!(unlocked_1.data.recovery_code.as_deref(), Some(recovery_code));

    // 5. استرداد الخزنة مرة ثانية متتالية بنفس المفتاح دون أن يتلف أو يتغير
    let (_hdr2, plain2) = kinana_core::crypto::decrypt_payload(&recovery_dat, &rec_key).unwrap();
    let recovered_pwd2 = std::str::from_utf8(plain2.as_slice()).unwrap();
    let unlocked_2 = storage.unlock(recovered_pwd2).unwrap();
    assert_eq!(unlocked_2.data.recovery_code.as_deref(), Some(recovery_code));
}

/// 11. اختبار استمرار صلاحية مفتاح الاسترداد بعد تدوير كلمة المرور الرئيسية (Rekey)
#[test]
fn test_recovery_key_retained_across_password_rekey() {
    let dir = tempdir().unwrap();
    let vault_path = dir.path().join("vault.dat");
    let storage = VaultStorage::new(&vault_path);

    let old_pwd = "InitialPassword123#";
    let new_pwd = "NewRotatedPassword456$";
    let recovery_code = "KN-SAME-RECO-VERY-CODE";
    let fast_params = Argon2Parameters {
        m_cost: 16 * 1024,
        t_cost: 1,
        p_cost: 1,
    };

    let mut session = storage
        .create_new_vault(old_pwd, Some(fast_params))
        .unwrap();
    session.data.recovery_code = Some(recovery_code.to_string());
    storage.save(&mut session).unwrap();

    // Rekey vault to new password
    let old_key = kinana_core::crypto::DerivedKey::new(*session.key.as_bytes());
    let new_header = kinana_core::crypto::VaultHeader::new_with_fresh_salts(fast_params).unwrap();
    let new_key = kinana_core::crypto::derive_key(new_pwd, &new_header.salt, &new_header.argon2_params).unwrap();
    session.header = new_header;
    session.key = new_key;
    storage.save_rekey(&mut session, &old_key).unwrap();

    // Re-encrypt recovery file with the same recovery code and the new password
    let rec_header = kinana_core::crypto::VaultHeader::new_with_fresh_salts(fast_params).unwrap();
    let rec_key = kinana_core::crypto::derive_key(recovery_code, &rec_header.salt, &rec_header.argon2_params).unwrap();
    let updated_recovery_dat = kinana_core::crypto::encrypt_payload(new_pwd.as_bytes(), &rec_key, &rec_header).unwrap();

    // Unlock using recovery code
    let (_h, plain) = kinana_core::crypto::decrypt_payload(&updated_recovery_dat, &rec_key).unwrap();
    let recovered_pwd = std::str::from_utf8(plain.as_slice()).unwrap();
    assert_eq!(recovered_pwd, new_pwd);

    let session_recovered = storage.unlock(recovered_pwd).unwrap();
    assert_eq!(session_recovered.data.recovery_code.as_deref(), Some(recovery_code));
}
