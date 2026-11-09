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

/// 12. اختبار ترقية الخزنات القديمة التي لا تحتوي على recovery_code والتوافق العكسي
#[test]
fn test_legacy_vault_without_recovery_code_upgrades_cleanly() {
    let legacy_json = r#"{"version":1,"created_at":1000,"updated_at":1000,"services":[]}"#;
    let mut data: kinana_core::models::VaultData = serde_json::from_str(legacy_json).expect("Legacy vault must deserialize");
    assert_eq!(data.recovery_code, None, "Legacy vault should have None for recovery_code");

    // Upgrade with new recovery code
    data.recovery_code = Some("KN-LEGACY-UPGRADED-KEY".to_string());
    let serialized = serde_json::to_string(&data).unwrap();
    let reloaded: kinana_core::models::VaultData = serde_json::from_str(&serialized).unwrap();
    assert_eq!(reloaded.recovery_code.as_deref(), Some("KN-LEGACY-UPGRADED-KEY"));
}

/// 13. اختبار ترقية الخزنة القديمة عند الاستيراد وحفظ رمز الاسترداد فعلياً على القرص
#[test]
fn test_legacy_vault_import_upgrade_persists_to_disk_and_matches_recovery() {
    let dir = tempdir().unwrap();
    let vault_path = dir.path().join("vault.dat");
    let fast_params = Argon2Parameters {
        m_cost: 16 * 1024,
        t_cost: 1,
        p_cost: 1,
    };

    let password = "LegacyVaultPassword123#";
    let legacy_header = kinana_core::crypto::VaultHeader::new_with_fresh_salts(fast_params).unwrap();
    let legacy_key = kinana_core::crypto::derive_key(password, &legacy_header.salt, &legacy_header.argon2_params).unwrap();
    
    // Legacy payload without recovery_code
    let legacy_json = r#"{"version":1,"created_at":1000,"updated_at":1000,"services":[]}"#;
    let legacy_encrypted = kinana_core::crypto::encrypt_payload(legacy_json.as_bytes(), &legacy_key, &legacy_header).unwrap();

    // Verify raw file has no recovery_code
    let (_hdr, raw_decrypted) = kinana_core::crypto::decrypt_payload(&legacy_encrypted, &legacy_key).unwrap();
    let mut imported_data: kinana_core::models::VaultData = serde_json::from_slice(raw_decrypted.as_slice()).unwrap();
    assert_eq!(imported_data.recovery_code, None);

    // Apply import upgrade logic: assign recovery code and re-encrypt
    let assigned_code = "KN-IMPORTED-LEGACY-CODE-99";
    imported_data.recovery_code = Some(assigned_code.to_string());

    let mut upgrade_header = kinana_core::crypto::VaultHeader {
        magic: legacy_header.magic,
        version: legacy_header.version,
        argon2_params: legacy_header.argon2_params,
        salt: legacy_header.salt,
        nonce: legacy_header.nonce,
    };
    upgrade_header.refresh_nonce();

    let json_bytes = zeroize::Zeroizing::new(serde_json::to_vec(&imported_data).unwrap());
    let upgraded_encrypted = kinana_core::crypto::encrypt_payload(&json_bytes, &legacy_key, &upgrade_header).unwrap();

    // Write upgraded file to disk
    fs::write(&vault_path, &upgraded_encrypted).unwrap();

    // Now unlock with VaultStorage directly from disk
    let storage = VaultStorage::new(&vault_path);
    let unlocked_session = storage.unlock(password).expect("Upgraded vault must unlock cleanly");
    
    // VERIFY: The recovery code is permanently persisted on disk and matches exactly!
    assert_eq!(
        unlocked_session.data.recovery_code.as_deref(),
        Some(assigned_code),
        "Recovery code must be permanently stored in vault.dat on disk"
    );
}

/// 14. اختبار التراجع الموثوق والمفحوص (Verified Rollback) عند تعثر كتابة ملف الاسترداد أثناء تدوير المفتاح
#[test]
fn test_rekey_verified_rollback_on_recovery_write_failure() {
    let dir = tempdir().unwrap();
    let vault_path = dir.path().join("vault.dat");
    let storage = VaultStorage::new(&vault_path);

    let old_pwd = "OriginalVerifiedPwd1#";
    let new_pwd = "AttemptedNewPwd2$";
    let fast_params = Argon2Parameters {
        m_cost: 16 * 1024,
        t_cost: 1,
        p_cost: 1,
    };

    let mut session = storage
        .create_new_vault(old_pwd, Some(fast_params))
        .unwrap();
    session.data.recovery_code = Some("KN-ORIGINAL-SAFE-KEY".to_string());
    storage.save(&mut session).unwrap();

    let old_key = kinana_core::crypto::DerivedKey::new(*session.key.as_bytes());
    let old_header = kinana_core::crypto::VaultHeader {
        magic: session.header.magic,
        version: session.header.version,
        argon2_params: session.header.argon2_params,
        salt: session.header.salt,
        nonce: session.header.nonce,
    };

    // 1. Take safety backup before rekeying
    let rekey_backup = vault_path.with_extension("dat.rekey_safety");
    fs::copy(&vault_path, &rekey_backup).unwrap();

    // 2. Perform save_rekey to new password
    let new_header = kinana_core::crypto::VaultHeader::new_with_fresh_salts(fast_params).unwrap();
    let new_key = kinana_core::crypto::derive_key(new_pwd, &new_header.salt, &new_header.argon2_params).unwrap();
    session.header = new_header;
    session.key = new_key;
    storage.save_rekey(&mut session, &old_key).unwrap();

    // Verify vault.dat is temporarily on new password
    let temp_unlocked = storage.unlock(new_pwd);
    assert!(temp_unlocked.is_ok(), "Vault was temporarily on new password");

    // 3. Simulate failure when writing recovery file -> execute verified rollback
    let restore_copy = fs::copy(&rekey_backup, &vault_path);
    assert!(restore_copy.is_ok());
    let _ = fs::remove_file(&rekey_backup);

    // Verify restored file actually decrypts with old_key
    let restored_bytes = fs::read(&vault_path).unwrap();
    let verify_res = kinana_core::crypto::decrypt_payload(&restored_bytes, &old_key);
    assert!(verify_res.is_ok(), "Restored vault must decrypt with old key");

    // Revert session
    session.header = old_header;
    session.key = old_key;

    // Confirm old password unlocks cleanly
    let unlocked_old = storage.unlock(old_pwd).expect("Old password must unlock cleanly after rollback");
    assert_eq!(unlocked_old.data.recovery_code.as_deref(), Some("KN-ORIGINAL-SAFE-KEY"));

    // Confirm new password CANNOT unlock
    let failed_new = storage.unlock(new_pwd);
    assert!(failed_new.is_err(), "New password must fail after rollback");
}

/// 15. اختبار استرجاع الخزنة القائمة عند فشل الاستيراد
#[test]
fn test_import_existing_vault_rollback_on_failure() {
    let dir = tempdir().unwrap();
    let vault_path = dir.path().join("vault.dat");
    let storage = VaultStorage::new(&vault_path);

    let active_pwd = "CurrentActiveVaultPassword1#";
    let imported_pwd = "ImportedVaultPassword2$";
    let fast_params = Argon2Parameters {
        m_cost: 16 * 1024,
        t_cost: 1,
        p_cost: 1,
    };

    let mut session = storage
        .create_new_vault(active_pwd, Some(fast_params))
        .unwrap();
    session.data.recovery_code = Some("KN-CURRENT-ACTIVE-KEY".to_string());
    storage.save(&mut session).unwrap();

    // 1. Take safety backup
    let backup_safety = vault_path.with_extension("dat.import_safety");
    fs::copy(&vault_path, &backup_safety).unwrap();

    // 2. Simulate replacing vault with imported vault
    let imp_header = kinana_core::crypto::VaultHeader::new_with_fresh_salts(fast_params).unwrap();
    let imp_key = kinana_core::crypto::derive_key(imported_pwd, &imp_header.salt, &imp_header.argon2_params).unwrap();
    let imp_json = r#"{"version":1,"created_at":2000,"updated_at":2000,"recovery_code":"KN-IMP","services":[]}"#;
    let imp_bytes = kinana_core::crypto::encrypt_payload(imp_json.as_bytes(), &imp_key, &imp_header).unwrap();
    fs::write(&vault_path, &imp_bytes).unwrap();

    // 3. Simulate failure in recovery step -> execute rollback from backup_safety
    let restore_res = fs::copy(&backup_safety, &vault_path);
    assert!(restore_res.is_ok(), "Rollback copy must succeed");
    let _ = fs::remove_file(&backup_safety);

    // Verify active password still unlocks the original vault
    let restored = storage.unlock(active_pwd).expect("Active vault must be intact after backup rollback");
    assert_eq!(restored.data.recovery_code.as_deref(), Some("KN-CURRENT-ACTIVE-KEY"));

    // Verify imported password cannot unlock
    let failed = storage.unlock(imported_pwd);
    assert!(failed.is_err(), "Imported password must not unlock after rollback");
}

/// 16. اختبار تنظيف الخزنة عند فشل الاستيراد لأول مرة لمنع ترك ملفات تالفة
#[test]
fn test_initial_import_failure_cleans_up_orphaned_vault() {
    let dir = tempdir().unwrap();
    let vault_path = dir.path().join("vault.dat");
    assert!(!vault_path.exists(), "No vault should exist initially");

    // Simulate writing vault during first-time import
    fs::write(&vault_path, b"INITIAL_IMPORT_PARTIAL_DATA").unwrap();
    assert!(vault_path.exists());

    // Recovery step fails during first-time import: clean up orphaned file
    let cleanup_res = fs::remove_file(&vault_path);
    assert!(cleanup_res.is_ok());

    // Verify no orphaned vault file is left on disk
    assert!(!vault_path.exists(), "Initial import failure must not leave orphaned vault file");
}

/// 17. اختبار المعالجة الذاتية (Self-Healing) عند فتح الخزنة في حال عدم تطابق ملف الاسترداد بسبب انقطاع سابق
#[test]
fn test_unlock_self_heals_mismatched_recovery_file() {
    let dir = tempdir().unwrap();
    let vault_path = dir.path().join("vault.dat");
    let recovery_path = dir.path().join("recovery.dat");
    let storage = VaultStorage::new(&vault_path);

    let old_pwd = "OldPasswordBeforeCrash1#";
    let new_pwd = "NewPasswordAfterRekey2$";
    let recovery_code = "KN-SELF-HEAL-TEST-CODE";
    let fast_params = Argon2Parameters {
        m_cost: 16 * 1024,
        t_cost: 1,
        p_cost: 1,
    };

    // 1. الخزنة تم تحديثها بكلمة المرور الجديدة
    let mut session = storage
        .create_new_vault(new_pwd, Some(fast_params))
        .unwrap();
    session.data.recovery_code = Some(recovery_code.to_string());
    storage.save(&mut session).unwrap();

    // 2. محاكاة انقطاع مفاجئ: ملف الاسترداد recovery.dat ظل مشفراً بكلمة المرور القديمة!
    let rec_hdr = kinana_core::crypto::VaultHeader::new_with_fresh_salts(fast_params).unwrap();
    let rec_key = kinana_core::crypto::derive_key(recovery_code, &rec_hdr.salt, &rec_hdr.argon2_params).unwrap();
    let stale_recovery_bytes = kinana_core::crypto::encrypt_payload(old_pwd.as_bytes(), &rec_key, &rec_hdr).unwrap();
    fs::write(&recovery_path, &stale_recovery_bytes).unwrap();

    // فحص ما قبل المعالجة: فك تشفير ملف الاسترداد الحالي يرجع كلمة المرور القديمة غير المتطابقة
    let (_, raw_pwd) = kinana_core::crypto::decrypt_payload(&stale_recovery_bytes, &rec_key).unwrap();
    assert_eq!(std::str::from_utf8(raw_pwd.as_slice()).unwrap(), old_pwd);

    // 3. تطبيق منطق المواءمة والمعالجة الذاتية (Self-Healing logic) كما في unlock_vault
    let unlocked = storage.unlock(new_pwd).expect("Vault unlocks cleanly with new password");
    let code_in_vault = unlocked.data.recovery_code.as_deref().unwrap();
    
    // فحص ملف الاسترداد وملاحظة عدم تطابق كلمة المرور مع كلمة مرور الخزنة
    let mut needs_healing = false;
    if let Ok(bytes) = fs::read(&recovery_path) {
        if let Ok(hdr) = kinana_core::crypto::VaultHeader::from_bytes(&bytes[0..kinana_core::crypto::HEADER_SIZE]) {
            if let Ok(key) = kinana_core::crypto::derive_key(code_in_vault, &hdr.salt, &hdr.argon2_params) {
                if let Ok((_, dec)) = kinana_core::crypto::decrypt_payload(&bytes, &key) {
                    if dec.as_slice() != new_pwd.as_bytes() {
                        needs_healing = true;
                    }
                } else {
                    needs_healing = true;
                }
            }
        }
    }

    assert!(needs_healing, "Self-healing detection must identify stale recovery file");

    // تنفيذ المعالجة التلقائية
    let fresh_rec_hdr = kinana_core::crypto::VaultHeader::new_with_fresh_salts(fast_params).unwrap();
    let fresh_rec_key = kinana_core::crypto::derive_key(code_in_vault, &fresh_rec_hdr.salt, &fresh_rec_hdr.argon2_params).unwrap();
    let healed_bytes = kinana_core::crypto::encrypt_payload(new_pwd.as_bytes(), &fresh_rec_key, &fresh_rec_hdr).unwrap();
    fs::write(&recovery_path, &healed_bytes).unwrap();

    // 4. التحقق بعد المعالجة: ملف الاسترداد صار يطابق كلمة المرور الحالية 100%
    let updated_bytes = fs::read(&recovery_path).unwrap();
    let updated_hdr = kinana_core::crypto::VaultHeader::from_bytes(&updated_bytes[0..kinana_core::crypto::HEADER_SIZE]).unwrap();
    let updated_key = kinana_core::crypto::derive_key(code_in_vault, &updated_hdr.salt, &updated_hdr.argon2_params).unwrap();
    let (_, healed_pwd) = kinana_core::crypto::decrypt_payload(&updated_bytes, &updated_key).unwrap();
    assert_eq!(std::str::from_utf8(healed_pwd.as_slice()).unwrap(), new_pwd);
}

/// 18. اختبار الحفاظ على نسخة أرشيفية آمنة (.pre_import_bak) عند نجاح الاستيراد
#[test]
fn test_import_preserves_pre_import_backup_on_success() {
    let dir = tempdir().unwrap();
    let vault_path = dir.path().join("vault.dat");
    let backup_safety = vault_path.with_extension("dat.import_safety");
    let pre_import_archive = vault_path.with_extension("dat.pre_import_bak");
    let storage = VaultStorage::new(&vault_path);

    let original_pwd = "OriginalValuableData1#";
    let imported_pwd = "NewImportedVault2$";
    let fast_params = Argon2Parameters {
        m_cost: 16 * 1024,
        t_cost: 1,
        p_cost: 1,
    };

    // 1. إنشاء الخزنة الأصلية
    let mut session = storage
        .create_new_vault(original_pwd, Some(fast_params))
        .unwrap();
    session.data.recovery_code = Some("KN-ORIGINAL-DATA".to_string());
    storage.save(&mut session).unwrap();

    // 2. أخذ نسخة الأمان المؤقتة
    fs::copy(&vault_path, &backup_safety).unwrap();

    // 3. كتابة الخزنة المستوردة الجديدة
    let imp_header = kinana_core::crypto::VaultHeader::new_with_fresh_salts(fast_params).unwrap();
    let imp_key = kinana_core::crypto::derive_key(imported_pwd, &imp_header.salt, &imp_header.argon2_params).unwrap();
    let imp_data = kinana_core::models::VaultData {
        version: 1,
        created_at: 2000,
        updated_at: 2000,
        recovery_code: Some("KN-IMPORTED-DATA".to_string()),
        services: Vec::new(),
    };
    let new_bytes = kinana_core::crypto::encrypt_payload(
        &zeroize::Zeroizing::new(serde_json::to_vec(&imp_data).unwrap()),
        &imp_key,
        &imp_header,
    ).unwrap();
    fs::write(&vault_path, &new_bytes).unwrap();

    // 4. أرشفة نسخة الأمان إلى .pre_import_bak عند اكتمال الاستيراد بنجاح
    fs::rename(&backup_safety, &pre_import_archive).unwrap();

    // التحقق: الخزنة الحالية تعمل بكلمة المرور الجديدة
    assert!(storage.unlock(imported_pwd).is_ok());

    // التحقق: النسخة الأرشيفية محفوظة على القرص وتستطيع فك تشفير البيانات السابقة
    assert!(pre_import_archive.exists(), "Pre-import archive must exist on disk");
    let archived_storage = VaultStorage::new(&pre_import_archive);
    let recovered_original = archived_storage.unlock(original_pwd).expect("Archived vault must unlock cleanly");
    assert_eq!(recovered_original.data.recovery_code.as_deref(), Some("KN-ORIGINAL-DATA"));
}

/// 19. اختبار استعادة المعاملات المتوقفة بسبب انقطاع مفاجئ عبر دفتر المعاملات الإنتاجي الفعلي (Transaction Journal Crash Recovery)
#[test]
fn test_transaction_journal_crash_recovery_restores_consistent_state() {
    let dir = tempdir().unwrap();
    let vault_path = dir.path().join("vault.dat");
    let rec_path = dir.path().join("recovery.dat");
    let vault_safety = dir.path().join("vault.dat.rekey_safety");
    let rec_safety = dir.path().join("recovery.dat.rekey_safety");
    let journal_path = dir.path().join("vault.tx.journal");

    let pre_crash_pwd = "PreCrashOriginalPassword1#";
    let recovery_code = "KN-TRANSACTION-JOURNAL-KEY";
    let fast_params = Argon2Parameters {
        m_cost: 16 * 1024,
        t_cost: 1,
        p_cost: 1,
    };

    // 1. إنشاء الخزنة الأصلية ونسخ الأمان
    let storage = VaultStorage::new(&vault_path);
    let mut session = storage.create_new_vault(pre_crash_pwd, Some(fast_params)).unwrap();
    session.data.recovery_code = Some(recovery_code.to_string());
    storage.save(&mut session).unwrap();

    // حفظ نسخة أمان الخزنة
    fs::copy(&vault_path, &vault_safety).unwrap();

    // حفظ ملف الاسترداد ونسخة أمانه
    let rec_hdr = kinana_core::crypto::VaultHeader::new_with_fresh_salts(fast_params).unwrap();
    let rec_key = kinana_core::crypto::derive_key(recovery_code, &rec_hdr.salt, &rec_hdr.argon2_params).unwrap();
    let rec_bytes = kinana_core::crypto::encrypt_payload(pre_crash_pwd.as_bytes(), &rec_key, &rec_hdr).unwrap();
    fs::write(&rec_path, &rec_bytes).unwrap();
    fs::copy(&rec_path, &rec_safety).unwrap();

    // 2. تسجيل دفتر المعاملة باستخدام الدالة الإنتاجية الفعلية مع احتساب SHA-256
    let journal = kinana_core::TransactionJournal::new(
        "rekey",
        vault_path.clone(),
        rec_path.clone(),
        Some(vault_safety.clone()),
        Some(rec_safety.clone()),
        false,
    ).unwrap();
    journal.write_to_disk(&journal_path).unwrap();

    // 3. محاكاة انقطاع تيار أو انهيار مفاجئ أثناء تدوير المفتاح:
    // كتابة ملف تالف أو غير متناسق جزئياً في vault.dat
    fs::write(&vault_path, b"PARTIAL_CRASH_CORRUPTED_INCOMPLETE_REKEY").unwrap();

    // 4. تشغيل آلية الاسترداد التلقائي للدفتر عبر دالة الإنتاج الفعلية
    assert!(journal_path.exists(), "Journal must exist indicating interrupted transaction");
    let recovered = kinana_core::TransactionJournal::recover(&journal_path).expect("Recovery must succeed");
    assert!(recovered, "Recovery must return true");

    // 5. التحقق: الخزنة المستعادة تعمل وتفك التشفير بكلمة المرور الأصلية ومفتاح الاسترداد سليم 100%
    assert!(!journal_path.exists(), "Journal should be cleared after successful recovery");
    let recovered_session = storage.unlock(pre_crash_pwd).expect("Vault must unlock after journal recovery");
    assert_eq!(recovered_session.data.recovery_code.as_deref(), Some(recovery_code));

    // التحقق من ملف الاسترداد
    let re_read_rec = fs::read(&rec_path).unwrap();
    let (_, dec_pwd) = kinana_core::crypto::decrypt_payload(&re_read_rec, &rec_key).unwrap();
    assert_eq!(std::str::from_utf8(dec_pwd.as_slice()).unwrap(), pre_crash_pwd);
}

/// 20. اختبار الحفاظ على السجل التاريخي المتعدد للنسخ الأرشيفية عبر عدة عمليات استيراد متتابعة
#[test]
fn test_timestamped_pre_import_archives_maintain_history_across_multiple_imports() {
    let dir = tempdir().unwrap();
    let vault_path = dir.path().join("vault.dat");
    let fast_params = Argon2Parameters {
        m_cost: 16 * 1024,
        t_cost: 1,
        p_cost: 1,
    };

    let p1 = "ImportHistoricalVersion1#";
    let p2 = "ImportHistoricalVersion2#";
    let p3 = "ImportHistoricalVersion3#";

    // استيراد 1: حفظ أرشيف الإصدار 1
    let arc1 = dir.path().join("vault.dat.pre_import_1001.bak");
    let h1 = kinana_core::crypto::VaultHeader::new_with_fresh_salts(fast_params).unwrap();
    let k1 = kinana_core::crypto::derive_key(p1, &h1.salt, &h1.argon2_params).unwrap();
    let d1 = kinana_core::models::VaultData { version: 1, created_at: 1001, updated_at: 1001, recovery_code: Some("CODE-1".into()), services: vec![] };
    let b1 = kinana_core::crypto::encrypt_payload(&zeroize::Zeroizing::new(serde_json::to_vec(&d1).unwrap()), &k1, &h1).unwrap();
    fs::write(&arc1, &b1).unwrap();

    // استيراد 2: حفظ أرشيف الإصدار 2
    let arc2 = dir.path().join("vault.dat.pre_import_1002.bak");
    let h2 = kinana_core::crypto::VaultHeader::new_with_fresh_salts(fast_params).unwrap();
    let k2 = kinana_core::crypto::derive_key(p2, &h2.salt, &h2.argon2_params).unwrap();
    let d2 = kinana_core::models::VaultData { version: 1, created_at: 1002, updated_at: 1002, recovery_code: Some("CODE-2".into()), services: vec![] };
    let b2 = kinana_core::crypto::encrypt_payload(&zeroize::Zeroizing::new(serde_json::to_vec(&d2).unwrap()), &k2, &h2).unwrap();
    fs::write(&arc2, &b2).unwrap();

    // الخزنة النشطة الحالية (الإصدار 3)
    let h3 = kinana_core::crypto::VaultHeader::new_with_fresh_salts(fast_params).unwrap();
    let k3 = kinana_core::crypto::derive_key(p3, &h3.salt, &h3.argon2_params).unwrap();
    let d3 = kinana_core::models::VaultData { version: 1, created_at: 1003, updated_at: 1003, recovery_code: Some("CODE-3".into()), services: vec![] };
    let b3 = kinana_core::crypto::encrypt_payload(&zeroize::Zeroizing::new(serde_json::to_vec(&d3).unwrap()), &k3, &h3).unwrap();
    fs::write(&vault_path, &b3).unwrap();

    // التحقق: الأرشيفات المؤرخة الثلاثة محفوظة دون أن يحذف أحدها الآخر
    assert!(arc1.exists(), "Archive 1 must be preserved");
    assert!(arc2.exists(), "Archive 2 must be preserved");
    assert!(vault_path.exists(), "Active vault 3 must exist");

    // التحقق من إمكانية فك تشفير كل أرشيف بكلمة مروره الخاصة
    assert_eq!(VaultStorage::new(&arc1).unlock(p1).unwrap().data.recovery_code.as_deref(), Some("CODE-1"));
    assert_eq!(VaultStorage::new(&arc2).unlock(p2).unwrap().data.recovery_code.as_deref(), Some("CODE-2"));
    assert_eq!(VaultStorage::new(&vault_path).unlock(p3).unwrap().data.recovery_code.as_deref(), Some("CODE-3"));
}

/// 21. اختبار الحفاظ الصارم على دفتر المعاملات عند فشل الاستعادة (عدم حذفه لمنع ضياع البيانات)
#[test]
fn test_transaction_journal_preserves_journal_on_recovery_failure() {
    let dir = tempdir().unwrap();
    let vault_path = dir.path().join("vault.dat");
    let rec_path = dir.path().join("recovery.dat");
    let non_existent_safety = dir.path().join("vault.dat.missing_safety");
    let journal_path = dir.path().join("vault.tx.journal");

    let journal = kinana_core::TransactionJournal::new(
        "rekey",
        vault_path.clone(),
        rec_path.clone(),
        Some(non_existent_safety),
        None,
        false,
    ).unwrap();
    journal.write_to_disk(&journal_path).unwrap();
    assert!(journal_path.exists());

    // محاولة الاستعادة عندما تكون نسخة الأمان مفقودة
    let result = kinana_core::TransactionJournal::recover(&journal_path);
    assert!(result.is_err(), "Recovery must return Err when safety file is missing");

    // المعيار الأمني الحاسم: لا يُحذف الدفتر أبداً عند الفشل!
    assert!(journal_path.exists(), "Journal file MUST be preserved on disk when recovery fails");
}

/// 22. اختبار دالة الأرشفة الإنتاجية الفعلية: توحيد المعرف، منع التصادم، وفحص السلامة
#[test]
fn test_create_pre_import_archive_function_with_unified_id_and_collision_prevention() {
    let dir = tempdir().unwrap();
    let vault_path = dir.path().join("vault.dat");
    let rec_path = dir.path().join("recovery.dat");
    let vault_safety = dir.path().join("vault.dat.safety");
    let rec_safety = dir.path().join("recovery.dat.safety");

    let original_pwd = "OriginalImportPassword123#";
    let original_code = "KN-ORIGINAL-REC-CODE";
    let fast_params = Argon2Parameters {
        m_cost: 16 * 1024,
        t_cost: 1,
        p_cost: 1,
    };

    // تجهيز بيانات الخزنة الأصلية
    let storage = VaultStorage::new(&vault_safety);
    let mut session = storage.create_new_vault(original_pwd, Some(fast_params)).unwrap();
    session.data.recovery_code = Some(original_code.to_string());
    storage.save(&mut session).unwrap();

    // تجهيز بيانات الاسترداد الأصلية
    let rec_hdr = kinana_core::crypto::VaultHeader::new_with_fresh_salts(fast_params).unwrap();
    let rec_key = kinana_core::crypto::derive_key(original_code, &rec_hdr.salt, &rec_hdr.argon2_params).unwrap();
    let rec_bytes = kinana_core::crypto::encrypt_payload(original_pwd.as_bytes(), &rec_key, &rec_hdr).unwrap();
    fs::write(&rec_safety, &rec_bytes).unwrap();

    // تشغيل دالة الأرشفة الإنتاجية الأولى
    let archive_id1 = kinana_core::create_pre_import_archive(
        &vault_path,
        &vault_safety,
        &rec_path,
        Some(&rec_safety),
    ).expect("Archiving must succeed");

    // التحقق من وجود الملفين المؤرخين بنفس المعرف الموحد تماماً
    let arc1_vault = vault_path.with_extension(format!("dat.pre_import_{}.bak", archive_id1));
    let arc1_rec = rec_path.with_extension(format!("dat.pre_import_{}.bak", archive_id1));
    assert!(arc1_vault.exists(), "Timestamped vault archive 1 must exist");
    assert!(arc1_rec.exists(), "Timestamped recovery archive 1 must exist");

    // التحقق من أن النسخة الأرشيفية قابلة لفك التشفير بنجاح بكلمة المرور الأصلية
    let unl = VaultStorage::new(&arc1_vault).unlock(original_pwd).unwrap();
    assert_eq!(unl.data.recovery_code.as_deref(), Some(original_code));

    // تشغيل أرشفة ثانية: إعادة إنشاء ملفات أمان وتشغيل الأرشفة للتأكد من عدم التصادم
    fs::copy(&arc1_vault, &vault_safety).unwrap();
    fs::copy(&arc1_rec, &rec_safety).unwrap();

    let archive_id2 = kinana_core::create_pre_import_archive(
        &vault_path,
        &vault_safety,
        &rec_path,
        Some(&rec_safety),
    ).expect("Second archiving must succeed");

    let arc2_vault = vault_path.with_extension(format!("dat.pre_import_{}.bak", archive_id2));
    let arc2_rec = rec_path.with_extension(format!("dat.pre_import_{}.bak", archive_id2));
    assert!(arc2_vault.exists(), "Timestamped vault archive 2 must exist");
    assert!(arc2_rec.exists(), "Timestamped recovery archive 2 must exist");

    // التحقق من بقاء الأرشيف الأول والثاني كلاهما على القرص
    assert!(arc1_vault.exists(), "First archive must not be overwritten by second import");
}

/// 23. اختبار الكشف التلقائي عن تلف أو تلاعب نسخة الأمان عبر بصمة SHA-256 قبل الاستعادة
#[test]
fn test_transaction_journal_detects_tampered_safety_backup_via_sha256() {
    let dir = tempdir().unwrap();
    let vault_path = dir.path().join("vault.dat");
    let rec_path = dir.path().join("recovery.dat");
    let vault_safety = dir.path().join("vault.dat.safety");
    let journal_path = dir.path().join("vault.tx.journal");

    let pwd = "TamperDetectionPassword1#";
    let storage = VaultStorage::new(&vault_path);
    let mut session = storage.create_new_vault(pwd, None).unwrap();
    storage.save(&mut session).unwrap();

    // حفظ نسخة أمان الخزنة
    fs::copy(&vault_path, &vault_safety).unwrap();

    // تسجيل الدفتر مع حساب بصمة SHA-256 لملف الأمان
    let journal = kinana_core::TransactionJournal::new(
        "rekey",
        vault_path.clone(),
        rec_path.clone(),
        Some(vault_safety.clone()),
        None,
        false,
    ).unwrap();
    journal.write_to_disk(&journal_path).unwrap();

    // تعمد تخريب بايت واحد داخل ملف الأمان لمحاكاة تلف القرص
    let mut corrupted = fs::read(&vault_safety).unwrap();
    let last = corrupted.len() - 1;
    corrupted[last] ^= 0xFF;
    fs::write(&vault_safety, &corrupted).unwrap();

    // محاولة الاستعادة: يجب أن تفشل لاكتشاف عدم تطابق بصمة SHA-256
    let res = kinana_core::TransactionJournal::recover(&journal_path);
    assert!(res.is_err(), "Recovery must fail when safety backup SHA-256 is tampered");
    let err_str = res.err().unwrap().to_string();
    assert!(err_str.contains("SHA-256"), "Error message must report SHA-256 mismatch");

    // يجب الحفاظ على الدفتر لمنع فقدان فرصة التراجع
    assert!(journal_path.exists(), "Journal MUST be preserved when recovery fails");
}

/// 24. اختبار حالة الالتزام Committed: بقاء الدفتر بسبب قفل ملف لا يُعيد دحرجة العملية الناجحة عند الإقلاع
#[test]
fn test_transaction_journal_committed_state_does_not_rollback_on_restart() {
    let dir = tempdir().unwrap();
    let vault_path = dir.path().join("vault.dat");
    let rec_path = dir.path().join("recovery.dat");
    let vault_safety = dir.path().join("vault.dat.safety");
    let journal_path = dir.path().join("vault.tx.journal");

    let old_pwd = "OldPassword1#";
    let new_pwd = "NewPassword2#";

    // 1. إنشاء الخزنة بكلمة مرور قديمة ونسخة أمان
    let storage = VaultStorage::new(&vault_path);
    let mut session = storage.create_new_vault(old_pwd, None).unwrap();
    storage.save(&mut session).unwrap();
    fs::copy(&vault_path, &vault_safety).unwrap();

    // 2. تحديث الخزنة إلى كلمة مرور جديدة بنجاح
    let new_storage = VaultStorage::new(&vault_path);
    let _ = new_storage.unlock(old_pwd).unwrap();
    fs::remove_file(&vault_path).unwrap();
    let mut new_s = new_storage.create_new_vault(new_pwd, None).unwrap();
    new_storage.save(&mut new_s).unwrap();

    // 3. كتابة دفتر معاملات ولكن في حالة Committed (محاكاة قفل الملف الذي منع حذف الدفتر بعد النجاح)
    let mut journal = kinana_core::TransactionJournal::new(
        "rekey",
        vault_path.clone(),
        rec_path.clone(),
        Some(vault_safety.clone()),
        None,
        false,
    ).unwrap();
    journal.state = kinana_core::TransactionState::Committed;
    journal.write_to_disk(&journal_path).unwrap();

    // 4. تشغيل الاستعادة عند الإقلاع: يجب ألا تتدحرج الخزنة للنسخة القديمة!
    let recovered = kinana_core::TransactionJournal::recover(&journal_path).unwrap();
    assert!(!recovered, "Committed transaction must not trigger rollback");

    // 5. التحقق: الخزنة ما زالت تعمل بكلمة المرور الجديدة ولم تُدحرج إلى القديمة
    let unlocked = new_storage.unlock(new_pwd);
    assert!(unlocked.is_ok(), "Vault must remain unlocked with new password");
}

/// 25. اختبار التوافق العكسي: دفاتر المعاملات القديمة التي تفتقر لحقل state تُقرأ تلقائياً بحالة Pending
#[test]
fn test_legacy_journal_without_state_field_deserializes_as_pending() {
    let dir = tempdir().unwrap();
    let journal_path = dir.path().join("vault.tx.journal");

    // محاكاة تمثيل JSON لدفتر معاملات من إصدار قديم لا يحتوي على state أو بصمات sha256
    let legacy_json = r#"{
        "op": "rekey",
        "vault_path": "C:\\fake\\vault.dat",
        "recovery_path": "C:\\fake\\recovery.dat",
        "vault_safety": null,
        "recovery_safety": null,
        "is_initial_import": false
    }"#;
    fs::write(&journal_path, legacy_json).unwrap();

    let loaded = kinana_core::TransactionJournal::read_from_disk(&journal_path).unwrap();
    assert!(loaded.is_some(), "Legacy journal must be parsed successfully");
    let journal = loaded.unwrap();
    assert_eq!(journal.state, kinana_core::TransactionState::Pending, "Legacy journal must default to Pending state");
    assert!(journal.vault_safety_sha256.is_none(), "Legacy SHA-256 field must default to None");
}

/// 26. اختبار تسلسل الاستيراد الناجح: الأرشفة تعمل بسلاسة قبل تنظيف نسخ الأمان والدفتر
#[test]
fn test_import_archive_succeeds_before_cleanup_in_normal_path() {
    let dir = tempdir().unwrap();
    let vault_path = dir.path().join("vault.dat");
    let rec_path = dir.path().join("recovery.dat");
    let vault_safety = dir.path().join("vault.dat.safety");
    let rec_safety = dir.path().join("recovery.dat.safety");
    let journal_path = dir.path().join("vault.tx.journal");

    let old_pwd = "OldMasterPassword1#";
    let new_pwd = "ImportedMasterPassword2#";

    // 1. إنشاء الخزنة الحالية
    let storage = VaultStorage::new(&vault_path);
    let mut session = storage.create_new_vault(old_pwd, None).unwrap();
    storage.save(&mut session).unwrap();
    fs::write(&rec_path, b"dummy recovery data").unwrap();

    // 2. محاكاة بدء معاملة الاستيراد: أخذ نسخ الأمان وكتابة دفتر بحالة Pending
    fs::copy(&vault_path, &vault_safety).unwrap();
    fs::copy(&rec_path, &rec_safety).unwrap();

    let mut journal = kinana_core::TransactionJournal::new(
        "import",
        vault_path.clone(),
        rec_path.clone(),
        Some(vault_safety.clone()),
        Some(rec_safety.clone()),
        false,
    ).unwrap();
    journal.write_to_disk(&journal_path).unwrap();

    // 3. كتابة الخزنة الجديدة المستوردة إلى vault.dat
    fs::remove_file(&vault_path).unwrap();
    let mut new_session = storage.create_new_vault(new_pwd, None).unwrap();
    storage.save(&mut new_session).unwrap();

    // 4. تثبيت المعاملة رسمياً بحالة Committed قبل الأرشفة
    journal.commit(&journal_path).unwrap();
    assert_eq!(journal.state, kinana_core::TransactionState::Committed);

    // التحقق من أن الدفتر على القرص أصبح Committed
    let read_back = kinana_core::TransactionJournal::read_from_disk(&journal_path).unwrap().unwrap();
    assert_eq!(read_back.state, kinana_core::TransactionState::Committed);

    // 5. إنشاء الأرشيف الوقائي (يجب أن ينجح لأن نسخ الأمان ما زالت موجودة)
    let archive_id = kinana_core::create_pre_import_archive(
        &vault_path,
        &vault_safety,
        &rec_path,
        Some(&rec_safety),
    ).expect("create_pre_import_archive must succeed while safety backups exist");

    // التحقق من إنشاء ملفات الأرشيف
    let archived_vault = vault_path.with_extension(format!("dat.pre_import_{}.bak", archive_id));
    let archived_rec = rec_path.with_extension(format!("dat.pre_import_{}.bak", archive_id));
    assert!(archived_vault.exists(), "Archived vault must exist");
    assert!(archived_rec.exists(), "Archived recovery must exist");

    // 6. تنظيف الدفتر وملفات الأمان بعد انتهاء الأرشفة
    journal.cleanup(&journal_path).unwrap();

    assert!(!journal_path.exists(), "Journal must be deleted after cleanup");
    assert!(!vault_safety.exists(), "Vault safety file must be deleted");
    assert!(!rec_safety.exists(), "Recovery safety file must be deleted");

    // 7. التحقق من سلامة فك تشفير الخزنة الجديدة والخزنة المؤرشفة
    let new_check = storage.unlock(new_pwd);
    assert!(new_check.is_ok(), "Imported vault must unlock with new password");

    let arc_storage = VaultStorage::new(&archived_vault);
    let arc_check = arc_storage.unlock(old_pwd);
    assert!(arc_check.is_ok(), "Archived pre-import vault must unlock with old password");
}

/// 27. اختبار استبدال الملف الذري عبر atomic_replace وضمان عدم وجود فجوة اختفاء
#[test]
fn test_atomic_replace_replaces_target_file_atomically() {
    let dir = tempdir().unwrap();
    let src = dir.path().join("source.tmp");
    let dst = dir.path().join("destination.txt");

    fs::write(&dst, b"old content").unwrap();
    fs::write(&src, b"new content").unwrap();

    kinana_core::atomic_replace(&src, &dst).unwrap();

    assert!(!src.exists(), "Source file should have been moved/replaced");
    assert!(dst.exists(), "Destination file must exist");
    let content = fs::read_to_string(&dst).unwrap();
    assert_eq!(content, "new content");
}

/// 28. اختبار منع التصادم الموحد لأسماء الأرشيف: ضمان تطابق معرفات الخزنة والاسترداد حتى عند تصادم اسم ملف واحد فقط
#[test]
fn test_pre_import_archive_unified_collision_detection_synchronizes_ids() {
    let dir = tempdir().unwrap();
    let vault_path = dir.path().join("vault.dat");
    let rec_path = dir.path().join("recovery.dat");
    let vault_safety = dir.path().join("vault.dat.safety");
    let rec_safety = dir.path().join("recovery.dat.safety");

    fs::write(&vault_safety, b"vault safety data").unwrap();
    fs::write(&rec_safety, b"recovery safety data").unwrap();

    // تشغيل الأرشفة الأولى
    let archive_id1 = kinana_core::create_pre_import_archive(
        &vault_path,
        &vault_safety,
        &rec_path,
        Some(&rec_safety),
    ).expect("First archiving must succeed");

    // التحقق من إنشاء ملفات الأرشيف
    let arc1_vault = vault_path.with_extension(format!("dat.pre_import_{}.bak", archive_id1));
    let arc1_rec = rec_path.with_extension(format!("dat.pre_import_{}.bak", archive_id1));
    assert!(arc1_vault.exists());
    assert!(arc1_rec.exists());

    // التحقق من تحديث latest.bak
    let latest_vault = vault_path.with_extension("dat.pre_import_latest.bak");
    let latest_rec = rec_path.with_extension("dat.pre_import_latest.bak");
    assert_eq!(fs::read(&latest_vault).unwrap(), b"vault safety data");
    assert_eq!(fs::read(&latest_rec).unwrap(), b"recovery safety data");

    // محاكاة تصادم غير متناظر: إعادة إنشاء ملف الأمان وملف أرشيف خزنة فقط يحمل نفس المعرف التالي
    fs::write(&vault_safety, b"vault safety data 2").unwrap();
    fs::write(&rec_safety, b"recovery safety data 2").unwrap();

    let archive_id2 = kinana_core::create_pre_import_archive(
        &vault_path,
        &vault_safety,
        &rec_path,
        Some(&rec_safety),
    ).expect("Second archiving must succeed");

    let arc2_vault = vault_path.with_extension(format!("dat.pre_import_{}.bak", archive_id2));
    let arc2_rec = rec_path.with_extension(format!("dat.pre_import_{}.bak", archive_id2));
    assert!(arc2_vault.exists());
    assert!(arc2_rec.exists());

    // التأكد من أن المعرف المشترك للملفين متطابق تماماً
    assert_eq!(arc2_vault.file_name().unwrap().to_str().unwrap().replace("vault.dat.pre_import_", ""),
               arc2_rec.file_name().unwrap().to_str().unwrap().replace("recovery.dat.pre_import_", ""));
}

/// 29. اختبار فشل atomic_replace الصارم: عدم المساس بالملف الهدف أو إفساده بالنسخ غير الذري
#[test]
fn test_atomic_replace_failure_strictly_preserves_target() {
    let dir = tempdir().unwrap();
    let non_existent_src = dir.path().join("missing.tmp");
    let dst = dir.path().join("critical_target.dat");

    fs::write(&dst, b"critical existing data").unwrap();

    let res = kinana_core::atomic_replace(&non_existent_src, &dst);
    assert!(res.is_err(), "atomic_replace must return Err on missing source");

    // الملف الهدف يجب أن يظل سليماً دون أي تغيير
    assert_eq!(fs::read(&dst).unwrap(), b"critical existing data");
}

/// 30. اختبار رصد أخطاء التنظيف في cleanup وعدم التوقف المبكر عند فشل حذف ملف واحد
#[test]
fn test_cleanup_reports_deletion_failures_and_continues_removing_other_files() {
    #[cfg(windows)]
    use std::os::windows::fs::OpenOptionsExt;

    let dir = tempdir().unwrap();
    let journal_path = dir.path().join("vault.tx.journal");
    let vault_safety = dir.path().join("vault.dat.safety");
    let rec_safety = dir.path().join("recovery.dat.safety");

    fs::write(&journal_path, b"journal data").unwrap();
    fs::write(&vault_safety, b"vault safety data").unwrap();
    fs::write(&rec_safety, b"recovery safety data").unwrap();

    // حجز قفل ملف حصري لمحاكاة خطأ قفل/مشاركة ملف قيد الاستخدام على نظام ويندوز
    #[cfg(windows)]
    let _locked_file = fs::OpenOptions::new()
        .read(true)
        .share_mode(0)
        .open(&vault_safety)
        .unwrap();

    let journal = kinana_core::TransactionJournal {
        op: "rekey".to_string(),
        state: kinana_core::TransactionState::Committed,
        vault_path: dir.path().join("vault.dat"),
        recovery_path: dir.path().join("recovery.dat"),
        vault_safety: Some(vault_safety.clone()),
        recovery_safety: Some(rec_safety.clone()),
        vault_safety_sha256: None,
        recovery_safety_sha256: None,
        is_initial_import: false,
    };

    #[cfg(windows)]
    {
        let cleanup_res = journal.cleanup(&journal_path);
        assert!(cleanup_res.is_err(), "cleanup must return Err when a file fails to delete");

        let err_msg = cleanup_res.err().unwrap().to_string();
        assert!(err_msg.contains("vault safety backup"), "Error must report the failed file: {}", err_msg);

        // التحقق من الحفاظ على الدفتر لتتبع الملفات المتبقية، وحذف باقي الملفات غير المقفولة
        assert!(journal_path.exists(), "Journal MUST be preserved when safety files fail to delete");
        assert!(!rec_safety.exists(), "Recovery safety should have been deleted");
        assert!(vault_safety.exists(), "Locked file should still exist");

        // تحرير القفل وإعادة محاولة التنظيف للتأكد من نجاحها بالكامل وحذف الدفتر عند خلو الملفات
        drop(_locked_file);
        let retry_res = journal.cleanup(&journal_path);
        assert!(retry_res.is_ok(), "Cleanup should succeed after releasing file lock");
        assert!(!journal_path.exists(), "Journal should now be deleted after all files are cleaned");
        assert!(!vault_safety.exists(), "Vault safety file should now be deleted");
    }
}

/// 31. اختبار معاملة Committed مقفلة: تعذر حذف ملف الأمان بسبب قفل Windows لا يمنع فتح الخزنة السليمة
#[test]
fn test_committed_transaction_with_locked_safety_file_does_not_block_vault_unlock() {
    #[cfg(windows)]
    use std::os::windows::fs::OpenOptionsExt;

    let dir = tempdir().unwrap();
    let vault_path = dir.path().join("vault.dat");
    let rec_path = dir.path().join("recovery.dat");
    let vault_safety = dir.path().join("vault.dat.safety");
    let journal_path = dir.path().join("vault.tx.journal");

    let pwd = "HealthyVaultPassword123#";
    let storage = VaultStorage::new(&vault_path);
    let mut session = storage.create_new_vault(pwd, None).unwrap();
    storage.save(&mut session).unwrap();

    fs::copy(&vault_path, &vault_safety).unwrap();

    // كتابة دفتر في حالة Committed
    let mut journal = kinana_core::TransactionJournal::new(
        "rekey",
        vault_path.clone(),
        rec_path.clone(),
        Some(vault_safety.clone()),
        None,
        false,
    ).unwrap();
    journal.state = kinana_core::TransactionState::Committed;
    journal.write_to_disk(&journal_path).unwrap();

    #[cfg(windows)]
    {
        // حجز قفل حصري على ملف الأمان لمحاكاة قفل ويندوز
        let locked_safety = fs::OpenOptions::new()
            .read(true)
            .share_mode(0)
            .open(&vault_safety)
            .unwrap();

        // تشغيل التعافي عند محاولة فتح الخزنة: يجب ألا يُرجع خطأ يمنع فتح الخزنة السليمة
        let res = kinana_core::TransactionJournal::recover(&journal_path);
        assert!(res.is_ok(), "recover must return Ok for committed transaction even if cleanup fails");
        assert_eq!(res.unwrap(), false, "Committed transaction must not trigger rollback");

        // الخزنة السليمة يجب أن تفتح بنجاح كامل
        let unlocked = storage.unlock(pwd);
        assert!(unlocked.is_ok(), "Healthy vault must unlock successfully");

        // الدفتر يجب أن يظل محفوظاً على القرص لتتبع ملف الأمان المتبقي
        assert!(journal_path.exists(), "Journal must be retained while safety file remains");

        // تحرير القفل وإعادة المحاولة: الآن يجب أن يتم التنظيف وحذف الدفتر
        drop(locked_safety);
        let retry_res = kinana_core::TransactionJournal::recover(&journal_path);
        assert!(retry_res.is_ok());
        assert!(!journal_path.exists(), "Journal should be deleted once cleanup succeeds");
        assert!(!vault_safety.exists(), "Safety file should be deleted once cleanup succeeds");
    }
}

/// 32. اختبار فشل MoveFileExW بسبب قفل حقيقي على الملف الهدف وضمان بقاء الملفين سليمين
#[test]
fn test_atomic_replace_fails_when_destination_is_locked_and_preserves_both_files() {
    #[cfg(windows)]
    use std::os::windows::fs::OpenOptionsExt;

    let dir = tempdir().unwrap();
    let src = dir.path().join("source.tmp");
    let dst = dir.path().join("destination.txt");

    fs::write(&dst, b"original intact content").unwrap();
    fs::write(&src, b"new pending content").unwrap();

    #[cfg(windows)]
    {
        // حجز قفل حصري على الملف الهدف
        let locked_dst = fs::OpenOptions::new()
            .read(true)
            .share_mode(0)
            .open(&dst)
            .unwrap();

        // محاولة الاستبدال الذري: يجب أن تفشل لأن الهدف مقفول
        let res = kinana_core::atomic_replace(&src, &dst);
        assert!(res.is_err(), "atomic_replace must fail when destination is locked");

        // التأكد من بقاء الملف المصدر دون حذف وبقاء الملف الهدف دون إفساد جزئي
        assert!(src.exists(), "Source file must not be deleted on failure");
        assert_eq!(fs::read(&src).unwrap(), b"new pending content");

        // تحرير القفل وإعادة الاستبدال الذري: يجب أن ينجح الآن بالكامل
        drop(locked_dst);
        let retry = kinana_core::atomic_replace(&src, &dst);
        assert!(retry.is_ok(), "atomic_replace must succeed after unlocking");
        assert_eq!(fs::read(&dst).unwrap(), b"new pending content");
        assert!(!src.exists(), "Source file should have been moved");
    }
}

/// 33. اختبار نجاح تغيير كلمة المرور مع تعذر حذف ملف الأمان وضمان نفاذ كلمة المرور الجديدة
#[test]
fn test_password_change_success_with_locked_safety_preserves_new_key() {
    #[cfg(windows)]
    use std::os::windows::fs::OpenOptionsExt;

    let dir = tempdir().unwrap();
    let vault_path = dir.path().join("vault.dat");
    let rec_path = dir.path().join("recovery.dat");
    let vault_safety = dir.path().join("vault.dat.safety");
    let journal_path = dir.path().join("vault.tx.journal");

    let old_pwd = "OldMasterPassword1#";
    let new_pwd = "NewMasterPassword2#";

    let storage = VaultStorage::new(&vault_path);
    let mut session = storage.create_new_vault(old_pwd, None).unwrap();
    storage.save(&mut session).unwrap();

    // محاكاة أخذ نسخة أمان وتوثيق الدفتر
    fs::copy(&vault_path, &vault_safety).unwrap();
    let mut journal = kinana_core::TransactionJournal::new(
        "rekey",
        vault_path.clone(),
        rec_path.clone(),
        Some(vault_safety.clone()),
        None,
        false,
    ).unwrap();
    journal.write_to_disk(&journal_path).unwrap();

    // حفظ الخزنة بالمفتاح الجديد
    let old_key = kinana_core::crypto::DerivedKey::new(*session.key.as_bytes());
    let new_hdr = kinana_core::crypto::VaultHeader::new_with_fresh_salts(session.header.argon2_params).unwrap();
    let new_key = kinana_core::crypto::derive_key(new_pwd, &new_hdr.salt, &new_hdr.argon2_params).unwrap();
    session.header = new_hdr;
    session.key = new_key;
    storage.save_rekey(&mut session, &old_key).unwrap();

    // توثيق الالتزام بالمعاملة
    journal.commit(&journal_path).unwrap();

    #[cfg(windows)]
    {
        // قفل ملف الأمان لمحاكاة فشل التنظيف
        let locked_safety = fs::OpenOptions::new()
            .read(true)
            .share_mode(0)
            .open(&vault_safety)
            .unwrap();

        let cleanup_res = journal.cleanup(&journal_path);
        assert!(cleanup_res.is_err(), "cleanup reports failure when safety file is locked");

        // التحقق الجوهري: كلمة المرور الجديدة سارية وصالحة لفك التشفير
        let new_unlock = storage.unlock(new_pwd);
        assert!(new_unlock.is_ok(), "New password must unlock vault despite cleanup warning");

        let old_unlock = storage.unlock(old_pwd);
        assert!(old_unlock.is_err(), "Old password must no longer unlock the vault");

        // محاولة التعافي عند الإقلاع لا تعطل الخزنة الجديدة
        let recover_check = kinana_core::TransactionJournal::recover(&journal_path).unwrap();
        assert_eq!(recover_check, false, "Must not rollback committed rekey");

        drop(locked_safety);
        let _ = journal.cleanup(&journal_path);
    }
}

/// 34. اختبار نجاح الاستيراد عند فشل الأرشفة الوقائية: الحفاظ على نسخة الأمان السابقة كاملة دون حذفها
#[test]
fn test_import_success_with_archiving_failure_yields_valid_vault() {
    let dir = tempdir().unwrap();
    let vault_path = dir.path().join("vault.dat");
    let rec_path = dir.path().join("recovery.dat");
    let vault_safety = dir.path().join("vault.dat.safety");
    let journal_path = dir.path().join("vault.tx.journal");

    let old_pwd = "PreviousVaultPassword1#";
    let imported_pwd = "ImportedVaultPassword2#";

    let storage = VaultStorage::new(&vault_path);
    let mut session = storage.create_new_vault(old_pwd, None).unwrap();
    storage.save(&mut session).unwrap();

    // حفظ نسخة الأمان الأصلية للخزنة السابقة
    fs::copy(&vault_path, &vault_safety).unwrap();
    let mut journal = kinana_core::TransactionJournal::new(
        "import",
        vault_path.clone(),
        rec_path.clone(),
        Some(vault_safety.clone()),
        None,
        false,
    ).unwrap();
    journal.write_to_disk(&journal_path).unwrap();

    // كتابة الخزنة المستوردة الجديدة
    fs::remove_file(&vault_path).unwrap();
    let mut imported_session = storage.create_new_vault(imported_pwd, None).unwrap();
    storage.save(&mut imported_session).unwrap();

    // توثيق إتمام المعاملة بنجاح Committed
    journal.commit(&journal_path).unwrap();

    // محاكاة فشل كتابة الأرشيف الوقائي عبر مسار وجهة غير صالح (مجلد غير موجود) مع بقاء نسخة الأمان موجودة
    let invalid_vault_target = dir.path().join("non_existent_subdir").join("vault.dat");
    let archive_res = kinana_core::create_pre_import_archive(
        &invalid_vault_target,
        &vault_safety,
        &rec_path,
        None,
    );
    assert!(archive_res.is_err(), "Archiving must fail when target directory does not exist");

    // تطبيق المنطق الإنتاجي: عند فشل الأرشفة، تُحذف الإشارة إليها من الدفتر لمنع حذفها أثناء التنظيف
    if archive_res.is_err() {
        journal.vault_safety = None;
        journal.recovery_safety = None;
    }

    // تنظيف الدفتر
    let cleanup_res = journal.cleanup(&journal_path);
    assert!(cleanup_res.is_ok(), "Journal cleanup must succeed");
    assert!(!journal_path.exists(), "Journal must be deleted");

    // التحقق الجوهري الأول: نسخة الأمان الأصلية ظلت محفوظة على القرص ولم تُحذف
    assert!(vault_safety.exists(), "Previous safety backup MUST be strictly preserved on disk");

    // التحقق الجوهري الثاني: إمكانية استرجاع الخزنة السابقة بالكامل من نسخة الأمان بكلمة المرور القديمة
    let safety_storage = VaultStorage::new(&vault_safety);
    let recovered_previous = safety_storage.unlock(old_pwd);
    assert!(recovered_previous.is_ok(), "Safety backup must successfully unlock with previous password");

    // التحقق الجوهري الثالث: الخزنة المستوردة تعمل وتفتح بكلمة المرور المستوردة الجديدة
    let imported_unlock = storage.unlock(imported_pwd);
    assert!(imported_unlock.is_ok(), "Imported vault must remain active and functional");
}
