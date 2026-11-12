import type { EditSecretFieldKey } from "./editSecretReveal.ts";

export type SecretCopyField = EditSecretFieldKey;

export type StoredSecretCopyCommand =
  | "copy_password"
  | "copy_account_recovery_key"
  | "copy_account_pin";

export interface SecretCopyTarget {
  field: SecretCopyField;
  isEdit: boolean;
  serviceId?: string | null;
  accountId?: string | null;
  hasExistingSecret?: boolean;
  draftValue: string;
  markedForRemoval?: boolean;
}

export type SecretCopyResolution =
  | {
      copyable: false;
      source: "missing";
    }
  | {
      copyable: true;
      source: "draft";
      command: "copy_secure_text";
      args: { text: string };
    }
  | {
      copyable: true;
      source: "stored";
      command: StoredSecretCopyCommand;
      args: { serviceId: string; accountId: string };
    };

const STORED_COPY_COMMAND_BY_FIELD: Record<SecretCopyField, StoredSecretCopyCommand> = {
  password: "copy_password",
  recoveryKey: "copy_account_recovery_key",
  cardNumber: "copy_password",
  cardCvv: "copy_account_recovery_key",
  cardPin: "copy_account_pin",
};

function getCopyableDraftText(field: SecretCopyField, draftValue: string): string {
  if (field === "cardNumber") {
    return draftValue.replace(/\s+/g, "").trim();
  }
  if (field === "password") {
    return draftValue.trim().length > 0 ? draftValue : "";
  }
  return draftValue.trim();
}

/**
 * Resolves how a secret field in an Add or Edit form should be copied without
 * loading stored plaintext into React or altering visibility state.
 */
export function resolveSecretCopyAction(target: SecretCopyTarget): SecretCopyResolution {
  if (target.markedForRemoval) {
    return { copyable: false, source: "missing" };
  }

  const draftText = getCopyableDraftText(target.field, target.draftValue);
  if (draftText.length > 0) {
    return {
      copyable: true,
      source: "draft",
      command: "copy_secure_text",
      args: { text: draftText },
    };
  }

  if (target.isEdit && target.hasExistingSecret && target.serviceId && target.accountId) {
    return {
      copyable: true,
      source: "stored",
      command: STORED_COPY_COMMAND_BY_FIELD[target.field],
      args: {
        serviceId: target.serviceId,
        accountId: target.accountId,
      },
    };
  }

  return { copyable: false, source: "missing" };
}

export function canCopySecretField(target: SecretCopyTarget): boolean {
  return resolveSecretCopyAction(target).copyable;
}

export type InvokeFn = <T = unknown>(
  cmd: string,
  args?: Record<string, unknown>
) => Promise<T>;

export async function executeSecretCopy(
  target: SecretCopyTarget,
  invoke: InvokeFn
): Promise<
  | { copied: false; reason: "missing" }
  | { copied: true; source: "draft" | "stored"; command: string }
> {
  const resolution = resolveSecretCopyAction(target);
  if (!resolution.copyable) {
    return { copied: false, reason: "missing" };
  }
  await invoke<void>(resolution.command, resolution.args);
  return {
    copied: true,
    source: resolution.source,
    command: resolution.command,
  };
}
