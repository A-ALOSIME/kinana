import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SessionGuard,
  unlockWithPassword,
  unlockWithRecoveryKey,
  unlockWithAutoUnlock,
  lockVault,
  processAccountResponse,
} from '../src/session.ts';

/**
 * Regression tests for Kinana session controllers and guards.
 * All tests execute the exact shared production controller functions from ui/src/session.ts.
 *
 * Test coverage:
 * 1. Successful master password unlock updates session guards and triggers callback.
 * 2. Failed master password unlock leaves session guards locked.
 * 3. Successful Recovery Key unlock updates session guards and accepts account details.
 * 4. Invalid Recovery Key fails unlock, preserves locked guard, and rejects account details.
 * 5. Successful manual Auto-Unlock updates session guards and accepts account details.
 * 6. Manual Auto-Unlock with unavailable credentials returns false and keeps guard locked.
 * 7. Startup Auto-Unlock updates session guards and accepts account details.
 * 8. Explicit lockVault locks session guard and purges state.
 * 9. Stale in-flight account response rejected when vault is locked during request.
 */

test('successful master password unlock updates session guards and triggers callback', async () => {
  const guard = new SessionGuard();
  let summaryLoaded = false;
  let clearedPassword = null;

  const mockInvoke = async (cmd, args) => {
    if (cmd === 'unlock_vault') {
      if (args.password === 'correct_master_password') return;
      throw new Error('كلمة المرور غير صحيحة');
    }
    throw new Error(`Unknown command ${cmd}`);
  };

  assert.equal(guard.isUnlocked, false);
  assert.equal(guard.epoch, 0);

  let inputPassword = 'correct_master_password';
  await unlockWithPassword(guard, mockInvoke, inputPassword, async () => {
    clearedPassword = '';
    summaryLoaded = true;
  });

  assert.equal(guard.epoch, 1, 'SessionGuard epoch must increment upon password unlock');
  assert.equal(guard.isUnlocked, true, 'SessionGuard must be unlocked upon password unlock');
  assert.equal(summaryLoaded, true, 'onSuccess callback must have run');
  assert.equal(clearedPassword, '');
});

test('failed master password unlock leaves session guards locked', async () => {
  const guard = new SessionGuard();
  let summaryLoaded = false;
  let errorCaught = null;

  const mockInvoke = async (cmd, args) => {
    if (cmd === 'unlock_vault') {
      throw new Error('فشل فتح الخزنة: كلمة المرور غير صحيحة');
    }
    throw new Error(`Unknown command ${cmd}`);
  };

  try {
    await unlockWithPassword(guard, mockInvoke, 'wrong_password', async () => {
      summaryLoaded = true;
    });
  } catch (err) {
    errorCaught = err?.message || String(err);
  }

  assert.equal(guard.isUnlocked, false, 'SessionGuard must remain locked on wrong password');
  assert.equal(guard.epoch, 0, 'SessionGuard epoch must not increment on failure');
  assert.equal(summaryLoaded, false, 'onSuccess callback must not run on failure');
  assert.ok(errorCaught && errorCaught.includes('غير صحيحة'), 'Error must be propagated');
});

test('successful recovery key unlock updates session guards and accepts service account details', async () => {
  const guard = new SessionGuard();
  let summary = null;
  let serviceAccounts = [];

  const mockInvoke = async (cmd, args) => {
    if (cmd === 'recover_vault_with_key') {
      if (args.recoveryCode === 'KN-VALID-RECO-VERY-CODE') return;
      throw new Error('Invalid recovery key');
    }
    if (cmd === 'get_vault_summary') {
      return { version: 1, services: [{ id: 'srv-1', name: 'GitHub', account_count: 1 }] };
    }
    if (cmd === 'get_service_accounts') {
      if (args.serviceId === 'srv-1') {
        return [{ id: 'acc-1', username: 'developer', email: 'dev@example.com' }];
      }
      return [];
    }
    throw new Error(`Unknown command ${cmd}`);
  };

  assert.equal(guard.isUnlocked, false);
  assert.equal(guard.epoch, 0);

  await unlockWithRecoveryKey(guard, mockInvoke, '  KN-VALID-RECO-VERY-CODE  ', async () => {
    summary = await mockInvoke('get_vault_summary');
  });

  assert.equal(guard.epoch, 1, 'SessionGuard epoch must increment upon recovery unlock');
  assert.equal(guard.isUnlocked, true, 'SessionGuard must be unlocked upon recovery');
  assert.ok(summary, 'Summary must be loaded');

  // Fetch accounts with session guard validation
  const epoch = guard.epoch;
  const accs = await mockInvoke('get_service_accounts', { serviceId: 'srv-1' });
  const processed = processAccountResponse(guard, epoch, accs, (validAccs) => {
    serviceAccounts = validAccs;
  });

  assert.equal(processed, true);
  assert.equal(serviceAccounts.length, 1);
  assert.equal(serviceAccounts[0].username, 'developer');
});

test('invalid recovery key fails unlock and leaves session guards locked', async () => {
  const guard = new SessionGuard();
  let summaryLoaded = false;
  let serviceAccounts = [];
  let errorCaught = null;

  const mockInvoke = async (cmd, args) => {
    if (cmd === 'recover_vault_with_key') {
      throw new Error('مفتاح الاسترداد المدخل غير مطابق أو غير صحيح!');
    }
    if (cmd === 'get_service_accounts') {
      return [{ id: 'leak-1', username: 'should_not_leak' }];
    }
    throw new Error(`Unknown command ${cmd}`);
  };

  try {
    await unlockWithRecoveryKey(guard, mockInvoke, 'KN-INVALID-KEY-0000-0000', async () => {
      summaryLoaded = true;
    });
  } catch (err) {
    errorCaught = err?.message || String(err);
  }

  assert.equal(guard.isUnlocked, false, 'SessionGuard must remain locked on invalid recovery key');
  assert.equal(guard.epoch, 0, 'SessionGuard epoch must not increment on failure');
  assert.equal(summaryLoaded, false, 'Summary must not be loaded on failure');
  assert.ok(errorCaught && errorCaught.includes('غير مطابق'), 'Error must be propagated');

  const epoch = guard.epoch;
  const accs = await mockInvoke('get_service_accounts', { serviceId: 'srv-1' });
  const processed = processAccountResponse(guard, epoch, accs, (validAccs) => {
    serviceAccounts = validAccs;
  });

  assert.equal(processed, false, 'processAccountResponse must reject data while locked');
  assert.equal(serviceAccounts.length, 0, 'No account details must be accepted while locked');
});

test('successful manual auto-unlock updates session guards and accepts service account details', async () => {
  const guard = new SessionGuard();
  let summary = null;
  let serviceAccounts = [];

  const mockInvoke = async (cmd, args) => {
    if (cmd === 'auto_unlock_vault') return true;
    if (cmd === 'get_vault_summary') return { version: 1, services: [{ id: 'srv-1', name: 'GitHub' }] };
    if (cmd === 'get_service_accounts') return [{ id: 'acc-1', username: 'auto_user' }];
    throw new Error(`Unknown command ${cmd}`);
  };

  assert.equal(guard.isUnlocked, false);
  assert.equal(guard.epoch, 0);

  const ok = await unlockWithAutoUnlock(guard, mockInvoke, async () => {
    summary = await mockInvoke('get_vault_summary');
  });

  assert.equal(ok, true, 'unlockWithAutoUnlock must return true on success');
  assert.equal(guard.epoch, 1, 'SessionGuard epoch must increment upon auto-unlock');
  assert.equal(guard.isUnlocked, true, 'SessionGuard must be unlocked');
  assert.ok(summary, 'Summary must be loaded');

  const epoch = guard.epoch;
  const accs = await mockInvoke('get_service_accounts', { serviceId: 'srv-1' });
  const processed = processAccountResponse(guard, epoch, accs, (validAccs) => {
    serviceAccounts = validAccs;
  });

  assert.equal(processed, true);
  assert.equal(serviceAccounts.length, 1);
  assert.equal(serviceAccounts[0].username, 'auto_user');
});

test('manual auto-unlock with unavailable credentials returns false and keeps guard locked', async () => {
  const guard = new SessionGuard();
  let summaryLoaded = false;
  let serviceAccounts = [];

  const mockInvoke = async (cmd, args) => {
    if (cmd === 'auto_unlock_vault') return false; // No saved credentials
    if (cmd === 'get_service_accounts') return [{ id: 'leak-1', username: 'should_not_leak' }];
    throw new Error(`Unknown command ${cmd}`);
  };

  const ok = await unlockWithAutoUnlock(guard, mockInvoke, async () => {
    summaryLoaded = true;
  });

  assert.equal(ok, false, 'unlockWithAutoUnlock must return false when no credentials saved');
  assert.equal(guard.isUnlocked, false, 'SessionGuard must remain locked');
  assert.equal(guard.epoch, 0, 'SessionGuard epoch must not increment');
  assert.equal(summaryLoaded, false);

  const epoch = guard.epoch;
  const accs = await mockInvoke('get_service_accounts', { serviceId: 'srv-1' });
  const processed = processAccountResponse(guard, epoch, accs, (validAccs) => {
    serviceAccounts = validAccs;
  });

  assert.equal(processed, false);
  assert.equal(serviceAccounts.length, 0);
});

test('startup auto-unlock updates guards and accepts service account details', async () => {
  const guard = new SessionGuard();
  let summary = null;
  let serviceAccounts = [];

  const mockInvoke = async (cmd, args) => {
    if (cmd === 'is_auto_unlock_enabled') return true;
    if (cmd === 'auto_unlock_vault') return true;
    if (cmd === 'get_vault_summary') return { version: 1, services: [{ id: 'srv-1', name: 'Srv' }] };
    if (cmd === 'get_service_accounts') return [{ id: 'acc-1', username: 'startup_user' }];
    throw new Error(`Unknown command ${cmd}`);
  };

  const isAutoEnabled = await mockInvoke('is_auto_unlock_enabled');
  if (isAutoEnabled) {
    await unlockWithAutoUnlock(guard, mockInvoke, async () => {
      summary = await mockInvoke('get_vault_summary');
    });
  }

  assert.equal(guard.epoch, 1);
  assert.equal(guard.isUnlocked, true);
  assert.ok(summary);

  const epoch = guard.epoch;
  const accs = await mockInvoke('get_service_accounts', { serviceId: 'srv-1' });
  processAccountResponse(guard, epoch, accs, (validAccs) => {
    serviceAccounts = validAccs;
  });

  assert.equal(serviceAccounts.length, 1);
  assert.equal(serviceAccounts[0].username, 'startup_user');
});

test('explicit lockVault locks session guard and executes purge callback', async () => {
  const guard = new SessionGuard();
  guard.unlock(); // Initially unlocked: epoch = 1, isUnlocked = true
  assert.equal(guard.isUnlocked, true);
  assert.equal(guard.epoch, 1);

  let backendLockInvoked = false;
  let purgeStateExecuted = false;

  const mockInvoke = async (cmd) => {
    if (cmd === 'lock_vault') {
      backendLockInvoked = true;
      return;
    }
    throw new Error(`Unknown command ${cmd}`);
  };

  await lockVault(guard, mockInvoke, () => {
    purgeStateExecuted = true;
  });

  assert.equal(backendLockInvoked, true, 'Backend lock_vault must be called');
  assert.equal(purgeStateExecuted, true, 'Purge callback must be executed');
  assert.equal(guard.isUnlocked, false, 'SessionGuard must be locked');
  assert.equal(guard.epoch, 2, 'SessionGuard epoch must increment upon lock');
});

test('stale in-flight account response rejected when vault is locked during request', async () => {
  const guard = new SessionGuard();
  guard.unlock(); // epoch = 1, isUnlocked = true
  let serviceAccounts = [];

  let resolveBackendCall;
  const backendPromise = new Promise((resolve) => {
    resolveBackendCall = resolve;
  });

  const fetchServiceAccounts = async (serviceId) => {
    const epoch = guard.epoch;
    try {
      const accs = await backendPromise;
      processAccountResponse(guard, epoch, accs, (validAccs) => {
        serviceAccounts = validAccs;
      });
    } catch (err) {
      // Ignore
    }
  };

  const fetchPromise = fetchServiceAccounts('srv-1');

  // Vault is locked while request is still pending
  guard.lock(); // epoch = 2, isUnlocked = false

  resolveBackendCall([{ id: 'acc-1', username: 'stale_user' }]);
  await fetchPromise;

  assert.equal(serviceAccounts.length, 0, 'Stale response must be dropped when vault was locked');
});
