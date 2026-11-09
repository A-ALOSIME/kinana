/**
 * SessionGuard manages vault unlock state and epoch transitions
 * to reject stale asynchronous responses across locks and unlocks.
 */
export class SessionGuard {
  private _epoch: number = 0;
  private _unlocked: boolean = false;

  get epoch(): number {
    return this._epoch;
  }

  get isUnlocked(): boolean {
    return this._unlocked;
  }

  unlock(): number {
    this._epoch += 1;
    this._unlocked = true;
    return this._epoch;
  }

  lock(): number {
    this._epoch += 1;
    this._unlocked = false;
    return this._epoch;
  }

  isResponseValid(requestEpoch: number): boolean {
    return this._unlocked && this._epoch === requestEpoch;
  }

  reset(): void {
    this._epoch = 0;
    this._unlocked = false;
  }
}

export function createSessionGuard(): SessionGuard {
  return new SessionGuard();
}

export type BackendInvoker = <T = unknown>(
  cmd: string,
  args?: Record<string, unknown>
) => Promise<T>;

/**
 * Controller for unlocking with master password.
 * Transitions session guard and triggers post-unlock callback on success.
 * Leaves session guard locked on failure.
 */
export async function unlockWithPassword(
  guard: SessionGuard,
  invoke: BackendInvoker,
  password: string,
  onSuccess: () => Promise<void> | void
): Promise<void> {
  if (!password) return;
  await invoke("unlock_vault", { password });
  guard.unlock();
  await onSuccess();
}

/**
 * Controller for unlocking with emergency recovery key.
 * Transitions session guard and triggers post-unlock callback on success.
 * Leaves session guard locked on failure.
 */
export async function unlockWithRecoveryKey(
  guard: SessionGuard,
  invoke: BackendInvoker,
  recoveryKey: string,
  onSuccess: () => Promise<void> | void
): Promise<void> {
  const trimmed = recoveryKey.trim();
  if (!trimmed) return;
  await invoke("recover_vault_with_key", { recoveryCode: trimmed });
  guard.unlock();
  await onSuccess();
}

/**
 * Controller for automatic unlock via Windows Credential Store (manual button or startup).
 * Returns true and updates session guard if credentials were valid and vault unlocked.
 * Returns false and leaves guard locked if auto-unlock returned false.
 */
export async function unlockWithAutoUnlock(
  guard: SessionGuard,
  invoke: BackendInvoker,
  onSuccess: () => Promise<void> | void
): Promise<boolean> {
  const ok = await invoke<boolean>("auto_unlock_vault");
  if (ok) {
    guard.unlock();
    await onSuccess();
    return true;
  }
  return false;
}

/**
 * Controller for locking the vault.
 * Invokes backend lock, transitions session guard to locked state, and purges sensitive state.
 */
export async function lockVault(
  guard: SessionGuard,
  invoke: BackendInvoker,
  onPurge: () => void
): Promise<void> {
  await invoke("lock_vault");
  guard.lock();
  onPurge();
}

/**
 * Validates and processes asynchronous account or service response against the session epoch.
 * Rejects stale in-flight responses if the vault was locked or re-unlocked while the request was in flight.
 */
export function processAccountResponse<T>(
  guard: SessionGuard,
  requestEpoch: number,
  data: T,
  onValid: (data: T) => void
): boolean {
  if (guard.isResponseValid(requestEpoch)) {
    onValid(data);
    return true;
  }
  return false;
}
