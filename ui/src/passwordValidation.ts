export const MIN_MASTER_PASSWORD_LENGTH = 8;

export type PasswordStrengthLevel = 0 | 1 | 2 | 3 | 4;

export interface PasswordStrengthResult {
  level: PasswordStrengthLevel;
  label: "" | "ضعيفة" | "متوسطة" | "قوية" | "قوية جداً";
}

export interface MasterPasswordValidation {
  minLengthMet: boolean;
  hasConfirmation: boolean;
  passwordsMatch: boolean;
  showMismatchError: boolean;
  canSubmit: boolean;
}

/**
 * Evaluates password strength locally using length and character-class diversity.
 * Informative only: decoupled from the minimum-length policy, never transmitted or stored.
 */
export function evaluatePasswordStrength(password: string): PasswordStrengthResult {
  if (!password) {
    return { level: 0, label: "" };
  }

  const len = password.length;
  const uniqueChars = new Set(password).size;
  const hasLower = /[a-z]/.test(password);
  const hasUpper = /[A-Z]/.test(password);
  const hasDigit = /[0-9]/.test(password);
  const hasSymbol = /[^a-zA-Z0-9\s]/.test(password);
  const hasArabicOrOther = /[\u0600-\u06FF\s]/.test(password);

  if (len < 6 || uniqueChars <= 2) {
    return { level: 1, label: "ضعيفة" };
  }

  let score = 0;
  if (len >= 6) score += 1;
  if (len >= 10) score += 1;
  if (len >= 14) score += 1;
  if (len >= 18) score += 1;

  if (hasLower) score += 1;
  if (hasUpper) score += 1;
  if (hasDigit) score += 1;
  if (hasSymbol || hasArabicOrOther) score += 1;

  if (/^(.)\1+$/.test(password) || uniqueChars <= Math.min(3, Math.floor(len / 2))) {
    score = Math.min(score, 2);
  }

  if (score <= 2) {
    return { level: 1, label: "ضعيفة" };
  }
  if (score <= 4) {
    return { level: 2, label: "متوسطة" };
  }
  if (score <= 6) {
    return { level: 3, label: "قوية" };
  }
  return { level: 4, label: "قوية جداً" };
}

/**
 * Validates master password setup/change forms with deferred mismatch feedback
 * until the confirmation field has been edited.
 */
export function validateMasterPasswordForm(params: {
  password: string;
  confirmPassword: string;
  confirmTouched: boolean;
  isSubmitting?: boolean;
}): MasterPasswordValidation {
  const { password, confirmPassword, confirmTouched, isSubmitting = false } = params;
  const minLengthMet = password.trim().length >= MIN_MASTER_PASSWORD_LENGTH;
  const hasConfirmation = confirmPassword.length > 0;
  const passwordsMatch = hasConfirmation && password === confirmPassword;
  const showMismatchError = Boolean(
    confirmTouched && hasConfirmation && password !== confirmPassword
  );
  const canSubmit = Boolean(minLengthMet && passwordsMatch && !isSubmitting);

  return {
    minLengthMet,
    hasConfirmation,
    passwordsMatch,
    showMismatchError,
    canSubmit,
  };
}
