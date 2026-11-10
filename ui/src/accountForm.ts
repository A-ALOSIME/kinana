export type AccountFormMode = "login" | "card";

export interface LoginFormValues {
  label: string;
  username: string;
  email: string;
  password: string;
  recoveryKey: string;
  url: string;
  notes: string;
  clearRecoveryKey?: boolean;
}

export interface CardFormValues {
  label: string;
  holder: string;
  number: string;
  expiry: string;
  cvv: string;
  pin: string;
  notes: string;
  clearRecoveryKey?: boolean;
  clearPin?: boolean;
}

export interface AddAccountPayload {
  serviceId: string;
  accountKind: AccountFormMode;
  label: string | null;
  username: string | null;
  password: string | null;
  email: string | null;
  recoveryKey: string | null;
  notes: string | null;
  url: string | null;
}

export interface UpdateAccountPayload {
  serviceId: string;
  accountId: string;
  accountKind: AccountFormMode;
  label: string;
  username: string;
  password: string | null;
  email: string | null;
  recoveryKey: string | null;
  notes: string;
  url: string;
  clearRecoveryKey: boolean;
  clearPin: boolean;
}

/**
 * Checks whether a service name typically represents a bank or payment card provider.
 * Used solely as the default mode when opening Add Account, never to override an account's stored kind.
 */
export function isBankOrCardService(serviceName: string = ""): boolean {
  return Boolean(
    serviceName.match(
      /(بطاقة|فيزا|ماستركارد|مدى|Visa|Mastercard|Mada|Al Rajhi|SNB|Alinma|urpay|stc pay|بنك|مصرف|الراجحي|الأهلي|الإنماء)/i
    )
  );
}

/**
 * Resolves whether an existing account should display/edit as a bank card or login account.
 * Explicit persisted `account_kind` is strictly authoritative and never overridden by parent service name.
 */
export function resolveAccountKind(acc: {
  account_kind?: AccountFormMode | null;
  notes?: string | null;
  url?: string | null;
}): AccountFormMode {
  if (acc.account_kind === "card" || acc.account_kind === "login") {
    return acc.account_kind;
  }
  if (acc.notes?.includes("[CARD]")) return "card";
  if (acc.url && /^\d{2}\/\d{2}$/.test(acc.url.trim())) return "card";
  return "login";
}

/**
 * Extracts user-written card notes without internal `[CARD]` and `PIN:` markers.
 */
export function extractCleanCardNotes(rawNotes?: string | null): string {
  if (!rawNotes) return "";
  return rawNotes
    .split(/\r?\n/)
    .filter((line) => {
      const trimmed = line.trim();
      return trimmed !== "[CARD]" && !trimmed.toUpperCase().startsWith("PIN:");
    })
    .join("\n")
    .replace(/\[CARD\]/g, "")
    .trim();
}

/**
 * Extracts a stored card PIN string from raw card notes if present.
 */
export function extractCardPin(rawNotes?: string | null): string {
  if (!rawNotes) return "";
  for (const line of rawNotes.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.toUpperCase().startsWith("PIN:")) {
      return trimmed.slice(4).trim();
    }
  }
  return "";
}

function packCardNotes(notes: string, pin: string, clearPin: boolean): string {
  const parts = ["[CARD]"];
  const cleanPin = pin.trim();
  if (!clearPin && cleanPin) {
    parts.push(`PIN: ${cleanPin}`);
  }
  const cleanNotes = notes.trim();
  if (cleanNotes) {
    parts.push(cleanNotes);
  }
  return parts.join("\n");
}

/**
 * Builds the IPC payload for `add_account` with clear creation-time defaults.
 */
export function buildAddAccountPayload(
  serviceId: string,
  mode: AccountFormMode,
  login: LoginFormValues,
  card: CardFormValues
): AddAccountPayload {
  if (mode === "card") {
    const cleanNum = card.number.replace(/\s+/g, "").trim();
    return {
      serviceId,
      accountKind: "card",
      label: card.label.trim() || "بطاقة بنكية",
      username: card.holder.trim() || null,
      password: cleanNum || null,
      email: null,
      recoveryKey: card.cvv.trim() || null,
      notes: packCardNotes(card.notes, card.pin, false),
      url: card.expiry.trim() || null,
    };
  }

  return {
    serviceId,
    accountKind: "login",
    label: login.label.trim() || null,
    username: login.username.trim() || null,
    password: login.password.trim() ? login.password : null,
    email: login.email.trim() || null,
    recoveryKey: login.recoveryKey.trim() || null,
    notes: login.notes.trim() || null,
    url: login.url.trim() || null,
  };
}

/**
 * Builds the IPC payload for `update_account` preserving 3-state semantics:
 * - Optional non-secret text fields always pass trimmed string (`""` clears stored text).
 * - Secret fields pass `null` when blank so existing secrets are retained unless updated or explicitly cleared.
 */
export function buildUpdateAccountPayload(
  serviceId: string,
  accountId: string,
  mode: AccountFormMode,
  login: LoginFormValues,
  card: CardFormValues
): UpdateAccountPayload {
  const clearRec = Boolean(mode === "card" ? card.clearRecoveryKey : login.clearRecoveryKey);
  const clearPin = Boolean(card.clearPin);

  if (mode === "card") {
    const cleanNum = card.number.replace(/\s+/g, "").trim();
    return {
      serviceId,
      accountId,
      accountKind: "card",
      label: card.label.trim(),
      username: card.holder.trim(),
      password: cleanNum || null,
      email: "",
      recoveryKey: clearRec ? "" : card.cvv.trim() ? card.cvv.trim() : null,
      notes: packCardNotes(card.notes, card.pin, clearPin),
      url: card.expiry.trim(),
      clearRecoveryKey: clearRec,
      clearPin,
    };
  }

  return {
    serviceId,
    accountId,
    accountKind: "login",
    label: login.label.trim(),
    username: login.username.trim(),
    password: login.password.trim() ? login.password : null,
    email: login.email.trim(),
    recoveryKey: clearRec ? "" : login.recoveryKey.trim() ? login.recoveryKey.trim() : null,
    notes: login.notes.trim(),
    url: login.url.trim(),
    clearRecoveryKey: clearRec,
    clearPin: false,
  };
}
