import type { BackendInvoker, SessionGuard } from "./session";

export const MASKED_RECOVERY_KEY_PLACEHOLDER = "KN-••••-••••-••••-••••";

export interface VaultRecoveryKeyState {
  value: string | null;
  revealed: boolean;
}

export function createHiddenRecoveryKeyState(): VaultRecoveryKeyState {
  return {
    value: null,
    revealed: false,
  };
}

/**
 * Formats the display string for Kinana's application recovery key.
 * Returns the masked placeholder unless explicitly revealed.
 */
export function getVisibleRecoveryKeyText(state: VaultRecoveryKeyState): string {
  if (state.revealed && state.value) {
    return state.value;
  }
  return MASKED_RECOVERY_KEY_PLACEHOLDER;
}

/**
 * Fetches and reveals the vault recovery key only if the session guard epoch
 * remains valid when the backend responds.
 */
export async function revealVaultRecoveryKey(
  guard: SessionGuard,
  invoke: BackendInvoker
): Promise<VaultRecoveryKeyState | null> {
  const epoch = guard.epoch;
  const key = await invoke<string>("get_or_generate_recovery_key");
  if (!guard.isResponseValid(epoch)) {
    return null;
  }
  return {
    value: key,
    revealed: true,
  };
}

/**
 * Copies the vault recovery key directly on the backend clipboard helper without
 * revealing it in UI state.
 */
export async function copyVaultRecoveryKeySecurely(
  invoke: BackendInvoker
): Promise<void> {
  await invoke("copy_vault_recovery_key");
}
