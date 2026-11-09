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
