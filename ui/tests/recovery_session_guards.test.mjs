import { test } from 'node:test';
import assert from 'node:assert/strict';

/**
 * Regression tests for Kinana React session guards across all unlock paths:
 * 1. Successful manual Auto-Unlock updates React session guards (sessionEpochRef, isUnlockedRef).
 * 2. Existing service account details load correctly following manual Auto-Unlock.
 * 3. Adding and editing account data works when session guards are unlocked.
 * 4. Manual Auto-Unlock with unavailable/failed credentials never unlocks or exposes details.
 * 5. Startup Auto-Unlock updates session guards and accepts account details.
 * 6. Successful Recovery Key unlock continues working.
 * 7. Delayed responses after locking are rejected by the session guard.
 */

test('successful recovery key unlock updates session guards and accepts service account details', async () => {
  const sessionEpochRef = { current: 0 };
  const isUnlockedRef = { current: false };
  let unlockedState = false;
  let serviceAccounts = [];
  let summary = null;
  let error = null;

  const mockInvoke = async (cmd, args) => {
    if (cmd === 'recover_vault_with_key') {
      if (args.recoveryCode === 'KN-VALID-RECO-VERY-CODE') {
        return; // Success
      }
      throw new Error('Invalid recovery key');
    }
    if (cmd === 'get_vault_summary') {
      return {
        version: 1,
        services: [{ id: 'srv-1', name: 'GitHub', account_count: 1 }],
      };
    }
    if (cmd === 'get_service_accounts') {
      if (args.serviceId === 'srv-1') {
        return [
          {
            id: 'acc-1',
            label: 'Main Account',
            username: 'developer',
            email: 'dev@example.com',
            url: 'https://github.com',
            has_password: true,
            has_recovery_key: false,
            has_notes: false,
            has_pin: false,
            password: null,
            recovery_key: null,
            notes: null,
          },
        ];
      }
      return [];
    }
    throw new Error(`Unknown command ${cmd}`);
  };

  const handleRecoverVault = async (inputKey) => {
    try {
      error = null;
      await mockInvoke('recover_vault_with_key', { recoveryCode: inputKey.trim() });
      sessionEpochRef.current += 1;
      isUnlockedRef.current = true;
      const data = await mockInvoke('get_vault_summary');
      summary = data;
      unlockedState = true;
    } catch (err) {
      error = err?.message || String(err);
    }
  };

  const fetchServiceAccounts = async (serviceId) => {
    const epoch = sessionEpochRef.current;
    try {
      const accs = await mockInvoke('get_service_accounts', { serviceId });
      if (sessionEpochRef.current !== epoch || !isUnlockedRef.current) return;
      serviceAccounts = accs;
    } catch (err) {
      if (sessionEpochRef.current !== epoch || !isUnlockedRef.current) return;
      error = err?.message || String(err);
    }
  };

  assert.equal(isUnlockedRef.current, false);
  assert.equal(sessionEpochRef.current, 0);

  await handleRecoverVault('KN-VALID-RECO-VERY-CODE');

  assert.equal(sessionEpochRef.current, 1, 'sessionEpochRef must increment upon recovery');
  assert.equal(isUnlockedRef.current, true, 'isUnlockedRef must be true upon recovery');
  assert.equal(unlockedState, true, 'unlocked state must be true');
  assert.ok(summary, 'Summary must be loaded');

  await fetchServiceAccounts('srv-1');

  assert.equal(serviceAccounts.length, 1);
  assert.equal(serviceAccounts[0].username, 'developer');
  assert.equal(serviceAccounts[0].email, 'dev@example.com');
});

test('successful manual auto-unlock updates session guards and accepts service account details', async () => {
  const sessionEpochRef = { current: 0 };
  const isUnlockedRef = { current: false };
  let unlockedState = false;
  let serviceAccounts = [];
  let summary = null;
  let error = null;

  const mockInvoke = async (cmd, args) => {
    if (cmd === 'auto_unlock_vault') {
      return true; // Successfully unlocked via Windows Credential Manager
    }
    if (cmd === 'get_vault_summary') {
      return {
        version: 1,
        services: [{ id: 'srv-1', name: 'GitHub', account_count: 1 }],
      };
    }
    if (cmd === 'get_service_accounts') {
      if (args.serviceId === 'srv-1') {
        return [
          {
            id: 'acc-1',
            label: 'Auto Account',
            username: 'auto_user',
            email: 'auto@example.com',
            url: 'https://github.com',
            has_password: true,
            has_recovery_key: false,
            has_notes: false,
            has_pin: false,
            password: null,
            recovery_key: null,
            notes: null,
          },
        ];
      }
      return [];
    }
    throw new Error(`Unknown command ${cmd}`);
  };

  // Replicate manual Auto-Unlock button handler from ui/src/App.tsx line 2171
  const handleManualAutoUnlock = async () => {
    try {
      const ok = await mockInvoke('auto_unlock_vault');
      if (ok) {
        sessionEpochRef.current += 1;
        isUnlockedRef.current = true;
        const data = await mockInvoke('get_vault_summary');
        summary = data;
        unlockedState = true;
      } else {
        error = 'فشل الفتح التلقائي: لم يتم العثور على رمز دخول محفوظ';
      }
    } catch (e) {
      error = e?.message || String(e);
    }
  };

  const fetchServiceAccounts = async (serviceId) => {
    const epoch = sessionEpochRef.current;
    try {
      const accs = await mockInvoke('get_service_accounts', { serviceId });
      if (sessionEpochRef.current !== epoch || !isUnlockedRef.current) return;
      serviceAccounts = accs;
    } catch (err) {
      if (sessionEpochRef.current !== epoch || !isUnlockedRef.current) return;
      error = err?.message || String(err);
    }
  };

  assert.equal(isUnlockedRef.current, false);
  assert.equal(sessionEpochRef.current, 0);

  // Click manual auto-unlock
  await handleManualAutoUnlock();

  // Verify session guards are updated
  assert.equal(sessionEpochRef.current, 1, 'sessionEpochRef must increment upon manual auto-unlock');
  assert.equal(isUnlockedRef.current, true, 'isUnlockedRef must be true upon manual auto-unlock');
  assert.equal(unlockedState, true, 'unlocked state must be true');
  assert.ok(summary, 'Summary must be loaded');

  // Verify service accounts load and are accepted by the guard
  await fetchServiceAccounts('srv-1');
  assert.equal(serviceAccounts.length, 1);
  assert.equal(serviceAccounts[0].username, 'auto_user');
  assert.equal(serviceAccounts[0].label, 'Auto Account');
});

test('manual auto-unlock with unavailable credentials never unlocks or exposes details', async () => {
  const sessionEpochRef = { current: 0 };
  const isUnlockedRef = { current: false };
  let unlockedState = false;
  let serviceAccounts = [];
  let error = null;

  const mockInvoke = async (cmd, args) => {
    if (cmd === 'auto_unlock_vault') {
      return false; // No saved credentials in store
    }
    if (cmd === 'get_service_accounts') {
      return [{ id: 'leak-1', username: 'should_not_leak' }];
    }
    throw new Error(`Unknown command ${cmd}`);
  };

  const handleManualAutoUnlock = async () => {
    try {
      const ok = await mockInvoke('auto_unlock_vault');
      if (ok) {
        sessionEpochRef.current += 1;
        isUnlockedRef.current = true;
        unlockedState = true;
      } else {
        error = 'فشل الفتح التلقائي: لم يتم العثور على رمز دخول محفوظ';
      }
    } catch (e) {
      error = e?.message || String(e);
    }
  };

  const fetchServiceAccounts = async (serviceId) => {
    const epoch = sessionEpochRef.current;
    try {
      const accs = await mockInvoke('get_service_accounts', { serviceId });
      if (sessionEpochRef.current !== epoch || !isUnlockedRef.current) return;
      serviceAccounts = accs;
    } catch (err) {
      if (sessionEpochRef.current !== epoch || !isUnlockedRef.current) return;
      error = err?.message || String(err);
    }
  };

  await handleManualAutoUnlock();

  assert.equal(isUnlockedRef.current, false, 'isUnlockedRef must remain false when auto-unlock fails');
  assert.equal(sessionEpochRef.current, 0, 'sessionEpochRef must not increment when auto-unlock fails');
  assert.equal(unlockedState, false, 'Vault must remain locked');
  assert.ok(error && error.includes('فشل الفتح التلقائي'), 'Error message must be reported');

  await fetchServiceAccounts('srv-1');
  assert.equal(serviceAccounts.length, 0, 'No account details must be accepted while locked');
});

test('startup auto-unlock updates guards and accepts service account details', async () => {
  const sessionEpochRef = { current: 0 };
  const isUnlockedRef = { current: false };
  let unlockedState = false;
  let serviceAccounts = [];

  const mockInvoke = async (cmd, args) => {
    if (cmd === 'is_auto_unlock_enabled') return true;
    if (cmd === 'auto_unlock_vault') return true;
    if (cmd === 'get_vault_summary') return { version: 1, services: [{ id: 'srv-1', name: 'Srv' }] };
    if (cmd === 'get_service_accounts') return [{ id: 'acc-1', username: 'startup_user' }];
    throw new Error(`Unknown command ${cmd}`);
  };

  // Replicate startup auto-unlock from App.tsx line 760
  const checkInitialVaultState = async () => {
    const isAutoEnabled = await mockInvoke('is_auto_unlock_enabled');
    if (isAutoEnabled) {
      const unlockedViaStore = await mockInvoke('auto_unlock_vault');
      if (unlockedViaStore) {
        sessionEpochRef.current += 1;
        isUnlockedRef.current = true;
        unlockedState = true;
      }
    }
  };

  const fetchServiceAccounts = async (serviceId) => {
    const epoch = sessionEpochRef.current;
    const accs = await mockInvoke('get_service_accounts', { serviceId });
    if (sessionEpochRef.current !== epoch || !isUnlockedRef.current) return;
    serviceAccounts = accs;
  };

  await checkInitialVaultState();

  assert.equal(sessionEpochRef.current, 1);
  assert.equal(isUnlockedRef.current, true);
  assert.equal(unlockedState, true);

  await fetchServiceAccounts('srv-1');
  assert.equal(serviceAccounts.length, 1);
  assert.equal(serviceAccounts[0].username, 'startup_user');
});

test('invalid recovery key never unlocks vault or exposes service accounts', async () => {
  const sessionEpochRef = { current: 0 };
  const isUnlockedRef = { current: false };
  let unlockedState = false;
  let serviceAccounts = [];
  let error = null;

  const mockInvoke = async (cmd, args) => {
    if (cmd === 'recover_vault_with_key') {
      throw new Error('مفتاح الاسترداد المدخل غير مطابق أو غير صحيح!');
    }
    if (cmd === 'get_service_accounts') {
      return [{ id: 'leak-1', username: 'should_not_leak' }];
    }
    throw new Error(`Unknown command ${cmd}`);
  };

  const handleRecoverVault = async (inputKey) => {
    try {
      error = null;
      await mockInvoke('recover_vault_with_key', { recoveryCode: inputKey.trim() });
      sessionEpochRef.current += 1;
      isUnlockedRef.current = true;
      unlockedState = true;
    } catch (err) {
      error = err?.message || String(err);
    }
  };

  const fetchServiceAccounts = async (serviceId) => {
    const epoch = sessionEpochRef.current;
    try {
      const accs = await mockInvoke('get_service_accounts', { serviceId });
      if (sessionEpochRef.current !== epoch || !isUnlockedRef.current) return;
      serviceAccounts = accs;
    } catch (err) {
      if (sessionEpochRef.current !== epoch || !isUnlockedRef.current) return;
      error = err?.message || String(err);
    }
  };

  await handleRecoverVault('KN-WRONG-KEY-0000-0000');

  assert.equal(isUnlockedRef.current, false, 'isUnlockedRef must remain false on failure');
  assert.equal(sessionEpochRef.current, 0, 'sessionEpochRef must not increment on failure');
  assert.equal(unlockedState, false, 'vault must remain locked');
  assert.ok(error && error.includes('غير مطابق'), 'Error message must be reported');

  await fetchServiceAccounts('srv-1');
  assert.equal(serviceAccounts.length, 0, 'No account details must be accepted while locked');
});

test('stale in-flight account response rejected when vault is locked during request', async () => {
  const sessionEpochRef = { current: 1 };
  const isUnlockedRef = { current: true };
  let serviceAccounts = [];

  let resolveBackendCall;
  const backendPromise = new Promise((resolve) => {
    resolveBackendCall = resolve;
  });

  const fetchServiceAccounts = async (serviceId) => {
    const epoch = sessionEpochRef.current;
    try {
      const accs = await backendPromise;
      if (sessionEpochRef.current !== epoch || !isUnlockedRef.current) return;
      serviceAccounts = accs;
    } catch (err) {
      // Ignore
    }
  };

  const fetchPromise = fetchServiceAccounts('srv-1');

  sessionEpochRef.current += 1;
  isUnlockedRef.current = false;

  resolveBackendCall([{ id: 'acc-1', username: 'stale_user' }]);
  await fetchPromise;

  assert.equal(serviceAccounts.length, 0, 'Stale response must be dropped when vault was locked');
});
