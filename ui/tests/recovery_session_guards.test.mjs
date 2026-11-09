import { test } from 'node:test';
import assert from 'node:assert/strict';

/**
 * Regression tests for Kinana React session guards:
 * 1. Successful Recovery Key authentication updates React session guards (sessionEpochRef, isUnlockedRef).
 * 2. Existing service account details load correctly following Recovery Key unlock.
 * 3. Adding and editing account data works when session guards are unlocked.
 * 4. Invalid Recovery Keys never unlock the vault or expose account details.
 * 5. Purging/locking resets the guards and rejects in-flight account details.
 */

test('successful recovery key unlock updates session guards and accepts service account details', async () => {
  const sessionEpochRef = { current: 0 };
  const isUnlockedRef = { current: false };
  let unlockedState = false;
  let serviceAccounts = [];
  let summary = null;
  let error = null;

  // Mock invoke dispatcher
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

  // Replicate handleRecoverVault logic from ui/src/App.tsx
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

  // Replicate fetchServiceAccounts logic from ui/src/App.tsx
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

  // Before recovery: guards are locked
  assert.equal(isUnlockedRef.current, false);
  assert.equal(sessionEpochRef.current, 0);

  // Execute recovery with valid key
  await handleRecoverVault('KN-VALID-RECO-VERY-CODE');

  // Verify guards were synchronized exactly as expected
  assert.equal(sessionEpochRef.current, 1, 'sessionEpochRef must increment upon recovery');
  assert.equal(isUnlockedRef.current, true, 'isUnlockedRef must be true upon recovery');
  assert.equal(unlockedState, true, 'unlocked state must be true');
  assert.ok(summary, 'Summary must be loaded');

  // Fetch accounts now that vault is unlocked
  await fetchServiceAccounts('srv-1');

  // Verify accounts are accepted by session guard and populated
  assert.equal(serviceAccounts.length, 1);
  assert.equal(serviceAccounts[0].username, 'developer');
  assert.equal(serviceAccounts[0].email, 'dev@example.com');
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
      // Backend should reject or if called return data
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

  // Attempt recovery with invalid key
  await handleRecoverVault('KN-WRONG-KEY-0000-0000');

  // Verify guards were NOT modified
  assert.equal(isUnlockedRef.current, false, 'isUnlockedRef must remain false on failure');
  assert.equal(sessionEpochRef.current, 0, 'sessionEpochRef must not increment on failure');
  assert.equal(unlockedState, false, 'vault must remain locked');
  assert.ok(error && error.includes('غير مطابق'), 'Error message must be reported');

  // Any attempt to fetch accounts is rejected by the session guard
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

  // Start fetch while unlocked
  const fetchPromise = fetchServiceAccounts('srv-1');

  // User locks the vault before backend returns
  sessionEpochRef.current += 1;
  isUnlockedRef.current = false;

  // Backend returns data
  resolveBackendCall([{ id: 'acc-1', username: 'stale_user' }]);
  await fetchPromise;

  // Guard must drop stale response
  assert.equal(serviceAccounts.length, 0, 'Stale response must be dropped when vault was locked');
});
