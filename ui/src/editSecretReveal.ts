import type { BackendInvoker, SessionGuard } from "./session";

export type EditSecretFieldKey =
  | "password"
  | "recoveryKey"
  | "cardNumber"
  | "cardCvv"
  | "cardPin";

export interface EditSecretEntry {
  revealed: boolean;
  revealedStoredValue: string | null;
}

export type EditSecretRevealMap = Record<EditSecretFieldKey, EditSecretEntry>;

export const EDIT_SECRET_FIELDS: readonly EditSecretFieldKey[] = [
  "password",
  "recoveryKey",
  "cardNumber",
  "cardCvv",
  "cardPin",
];

export function createHiddenEditSecretMap(): EditSecretRevealMap {
  return {
    password: { revealed: false, revealedStoredValue: null },
    recoveryKey: { revealed: false, revealedStoredValue: null },
    cardNumber: { revealed: false, revealedStoredValue: null },
    cardCvv: { revealed: false, revealedStoredValue: null },
    cardPin: { revealed: false, revealedStoredValue: null },
  };
}

function cloneEditSecretMap(source: EditSecretRevealMap): EditSecretRevealMap {
  return {
    password: { ...source.password },
    recoveryKey: { ...source.recoveryKey },
    cardNumber: { ...source.cardNumber },
    cardCvv: { ...source.cardCvv },
    cardPin: { ...source.cardPin },
  };
}

export function formatStoredSecretForEditDisplay(
  field: EditSecretFieldKey,
  raw: string
): string {
  if (field === "cardNumber") {
    const digits = raw.replace(/\D/g, "");
    if (digits.length > 0) {
      return digits.replace(/(.{4})(?=\d)/g, "$1 ").trim();
    }
  }
  return raw;
}

const SECRET_COMMAND_BY_FIELD: Record<EditSecretFieldKey, string> = {
  password: "get_account_password",
  cardNumber: "get_account_password",
  recoveryKey: "get_account_recovery_key",
  cardCvv: "get_account_recovery_key",
  cardPin: "get_account_pin",
};

export interface ToggleEditSecretOptions {
  field: EditSecretFieldKey;
  serviceId: string | null | undefined;
  accountId: string | null | undefined;
  hasExistingSecret: boolean;
  hasDraftValue: boolean;
  markedForRemoval?: boolean;
}

export interface ToggleEditSecretResult {
  stale: boolean;
  error?: unknown;
}

/**
 * Coordinates safe on-demand secret reveal inside the Edit Account modal.
 * Guards async responses by SessionGuard epoch, active (serviceId, accountId) identity,
 * and per-field request generation so switching accounts, editing drafts, hiding,
 * closing, window blur, or locking never leaks stale decrypted values.
 */
export class EditSecretRevealController {
  private activeServiceId: string | null = null;
  private activeAccountId: string | null = null;
  private state: EditSecretRevealMap = createHiddenEditSecretMap();
  private readonly generations: Record<EditSecretFieldKey, number> = {
    password: 0,
    recoveryKey: 0,
    cardNumber: 0,
    cardCvv: 0,
    cardPin: 0,
  };
  private readonly onChange?: (next: EditSecretRevealMap) => void;

  constructor(onChange?: (next: EditSecretRevealMap) => void) {
    this.onChange = onChange;
  }

  get snapshot(): EditSecretRevealMap {
    return cloneEditSecretMap(this.state);
  }

  private emit(): void {
    this.onChange?.(this.snapshot);
  }

  private bumpAllGenerations(): void {
    for (const field of EDIT_SECRET_FIELDS) {
      this.generations[field] += 1;
    }
  }

  /** Sets the active edit account/service target and resets all secret reveal states. */
  setTarget(serviceId: string | null, accountId: string | null): EditSecretRevealMap {
    this.activeServiceId = serviceId;
    this.activeAccountId = accountId;
    this.bumpAllGenerations();
    this.state = createHiddenEditSecretMap();
    this.emit();
    return this.snapshot;
  }

  /** Immediately hides one secret field, invalidates in-flight fetches, and clears temporary text. */
  hideField(field: EditSecretFieldKey): EditSecretRevealMap {
    this.generations[field] += 1;
    this.state[field] = { revealed: false, revealedStoredValue: null };
    this.emit();
    return this.snapshot;
  }

  /** Hides all secret fields, clears temporary values, and invalidates all pending requests. */
  hideAll(): EditSecretRevealMap {
    this.bumpAllGenerations();
    this.state = createHiddenEditSecretMap();
    this.emit();
    return this.snapshot;
  }

  /**
   * Handles replacement draft changes for an edit secret field.
   * Always invalidates in-flight fetches and clears any temporary revealed stored value.
   * When an existing secret's draft is erased back to empty, reverts cleanly to masked hidden state.
   */
  onDraftChanged(
    field: EditSecretFieldKey,
    nextDraft: string,
    hasExistingSecret: boolean
  ): EditSecretRevealMap {
    this.generations[field] += 1;
    const prev = this.state[field];
    const nextRevealed =
      nextDraft.length === 0 && hasExistingSecret ? false : prev.revealed;
    if (prev.revealedStoredValue !== null || prev.revealed !== nextRevealed) {
      this.state[field] = {
        revealed: nextRevealed,
        revealedStoredValue: null,
      };
      this.emit();
    }
    return this.snapshot;
  }

  async toggle(
    opts: ToggleEditSecretOptions,
    guard: SessionGuard,
    invoke: BackendInvoker
  ): Promise<ToggleEditSecretResult> {
    const {
      field,
      serviceId,
      accountId,
      hasExistingSecret,
      hasDraftValue,
      markedForRemoval = false,
    } = opts;

    if (markedForRemoval) {
      this.hideField(field);
      return { stale: false };
    }

    if (this.state[field].revealed) {
      this.hideField(field);
      return { stale: false };
    }

    // Either replacing with user-typed text or no secret exists on backend yet: toggle locally.
    if (hasDraftValue || !hasExistingSecret || !serviceId || !accountId) {
      this.generations[field] += 1;
      this.state[field] = { revealed: true, revealedStoredValue: null };
      this.emit();
      return { stale: false };
    }

    if (!guard.isUnlocked) {
      return { stale: true };
    }

    const reqEpoch = guard.epoch;
    const reqGen = ++this.generations[field];
    const reqServiceId = serviceId;
    const reqAccountId = accountId;

    const isStillValid = (): boolean =>
      guard.isResponseValid(reqEpoch) &&
      this.activeServiceId === reqServiceId &&
      this.activeAccountId === reqAccountId &&
      this.generations[field] === reqGen;

    try {
      const cmd = SECRET_COMMAND_BY_FIELD[field];
      const raw = await invoke<string>(cmd, {
        serviceId: reqServiceId,
        accountId: reqAccountId,
      });
      if (!isStillValid()) {
        return { stale: true };
      }
      const formatted =
        raw && raw.length > 0
          ? formatStoredSecretForEditDisplay(field, raw)
          : null;
      this.state[field] = {
        revealed: true,
        revealedStoredValue: formatted,
      };
      this.emit();
      return { stale: false };
    } catch (error) {
      if (!isStillValid()) {
        return { stale: true };
      }
      return { stale: false, error };
    }
  }
}
