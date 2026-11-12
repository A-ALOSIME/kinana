import type { TFunction } from "i18next";
import i18next from "i18next";

type TranslateFn = Pick<TFunction, never> | ((key: string, options?: Record<string, unknown>) => string);

interface ExactErrorRule {
  matches: readonly string[];
  key: string;
}

interface PatternErrorRule {
  pattern: RegExp;
  key: string;
  extract?: (match: RegExpMatchArray) => Record<string, string>;
}

const EXACT_ERROR_RULES: readonly ExactErrorRule[] = [
  {
    matches: ["No active vault session. Vault is locked.", "الخزنة مقفلة"],
    key: "errors.vaultLocked",
  },
  {
    matches: ["Vault already exists. Use unlock instead."],
    key: "errors.vaultAlreadyExists",
  },
  {
    matches: [
      "يجب أن تتكون كلمة المرور الرئيسية أو رمز الدخول من 8 خانات على الأقل لضمان حماية الخزنة ضد التخمين.",
      "يجب أن تتكون كلمة المرور الرئيسية أو رمز الدخول الجديد من 8 خانات على الأقل لضمان حماية الخزنة ضد التخمين.",
    ],
    key: "errors.passwordMinLength",
  },
  {
    matches: ["Service name cannot be empty", "اسم الخدمة لا يمكن أن يكون فارغاً"],
    key: "errors.emptyServiceName",
  },
  {
    matches: ["لا توجد كلمة مرور محفوظة لهذا الحساب"],
    key: "errors.noSavedPassword",
  },
  {
    matches: ["حجم الصورة يتجاوز الحد الأقصى المسموح (500 كيلوبايت)"],
    key: "errors.imageTooLarge",
  },
  {
    matches: ["النص المراد نسخه فارغ"],
    key: "errors.emptyClipboardText",
  },
  {
    matches: [
      "Cryptographic derivation or decryption failed: authentication tag mismatch or invalid password",
    ],
    key: "errors.decryptionFailed",
  },
  {
    matches: ["Readback integrity verification failed after write"],
    key: "errors.readbackVerificationFailed",
  },
  {
    matches: ["Password length must be between 12 and 64 characters"],
    key: "errors.passwordLengthOutOfRange",
  },
  {
    matches: ["Failed to open Windows clipboard"],
    key: "errors.clipboardOpenFailed",
  },
  {
    matches: [
      "Failed to allocate global memory for clipboard text",
      "Failed to lock global memory for clipboard text",
    ],
    key: "errors.clipboardMemoryFailed",
  },
  {
    matches: ["Auto-Unlock is not supported on macOS in this release"],
    key: "errors.autoUnlockNotSupportedMac",
  },
  {
    matches: ["Auto-Unlock is only supported on Windows in this release"],
    key: "errors.autoUnlockNotSupportedPlatform",
  },
  {
    matches: ["No saved credential found in Windows Credential Store"],
    key: "errors.noSavedCredential",
  },
  {
    matches: ["لم يتم العثور على مفتاح استرداد للخزنة."],
    key: "errors.recoveryNotFound",
  },
  {
    matches: ["ملف الاسترداد غير موجود على هذا الجهاز."],
    key: "errors.recoveryFileMissing",
  },
  {
    matches: ["بيانات الاسترداد تالفة أو قصيرة جداً"],
    key: "errors.recoveryCorrupted",
  },
  {
    matches: ["رمز الاسترداد في الخزنة المرقّاة غير متطابق مع البيانات."],
    key: "errors.recoveryUpgradeMismatch",
  },
  {
    matches: ["لا توجد بيانات خزنة محفوظة لتصديرها حالياً."],
    key: "errors.exportNoVault",
  },
  {
    matches: ["يرجى إدخال كلمة المرور الخاصة بالخزنة المستوردة للتحقق من سلامة التشفير."],
    key: "errors.importPasswordRequired",
  },
  {
    matches: ["الملف المختار تالف أو ليس ملف خزنة كنانة صالح."],
    key: "errors.vaultInvalidMagic",
  },
  {
    matches: ["حجم الملف المختار يتجاوز الحد الأقصى المسموح به (50 ميجابايت)."],
    key: "errors.importFileTooLarge",
  },
  {
    matches: ["تعذر فتح مدير الملفات على النظام. يرجى فتح المجلد يدوياً."],
    key: "errors.openFileManagerFailed",
  },
];

const PATTERN_ERROR_RULES: readonly PatternErrorRule[] = [
  {
    pattern: /^Service with ID '(.+)' not found$/,
    key: "errors.serviceNotFound",
    extract: (m) => ({ id: m[1] }),
  },
  {
    pattern: /^الخدمة بالمعرف '(.+)' غير موجودة$/,
    key: "errors.serviceNotFound",
    extract: (m) => ({ id: m[1] }),
  },
  {
    pattern: /^الحساب بالمعرف '(.+)' غير موجود$/,
    key: "errors.accountNotFound",
    extract: (m) => ({ id: m[1] }),
  },
  {
    pattern: /^Account (.+) not found in service (.+)$/,
    key: "errors.accountNotFoundInService",
    extract: (m) => ({ accountId: m[1], serviceId: m[2] }),
  },
  {
    pattern: /^Vault file not found/,
    key: "errors.vaultFileNotFound",
  },
  {
    pattern: /^File is too short to be a valid vault/,
    key: "errors.vaultFileTooShort",
  },
  {
    pattern: /^Invalid file header or not a valid Kinana vault/,
    key: "errors.vaultInvalidMagic",
  },
  {
    pattern: /^Unsupported vault format version/,
    key: "errors.vaultUnsupportedVersion",
  },
  {
    pattern: /^Refusing to overwrite existing corrupted vault: (.+)$/,
    key: "errors.existingVaultCorrupted",
    extract: (m) => ({ detail: m[1] }),
  },
  {
    pattern: /^Atomic rename failed/,
    key: "errors.atomicRenameFailed",
  },
  {
    pattern: /^Failed to access clipboard: (.+)$/,
    key: "errors.clipboardAccessFailed",
    extract: (m) => ({ detail: m[1] }),
  },
  {
    pattern: /^Failed to set clipboard text: (.+)$/,
    key: "errors.clipboardSetFailed",
    extract: (m) => ({ detail: m[1] }),
  },
  {
    pattern: /^Failed to initialize Secret Service: (.+)$/,
    key: "errors.secretServiceInitFailed",
    extract: (m) => ({ detail: m[1] }),
  },
  {
    pattern: /^Keyring storage unavailable or locked: (.+)$/,
    key: "errors.keyringLockedOrUnavailable",
    extract: (m) => ({ detail: m[1] }),
  },
  {
    pattern: /^Secret Service platform communication error: (.+)$/,
    key: "errors.secretServiceCommError",
    extract: (m) => ({ detail: m[1] }),
  },
  {
    pattern: /^Secret Service unavailable: (.+)$/,
    key: "errors.secretServiceUnavailable",
    extract: (m) => ({ detail: m[1] }),
  },
  {
    pattern: /^Failed to (?:create keyring entry|save credential in Secret Service): (.+)$/,
    key: "errors.keyringSaveFailed",
    extract: (m) => ({ detail: m[1] }),
  },
  {
    pattern: /^Failed to retrieve credential from Secret Service: (.+)$/,
    key: "errors.keyringReadFailed",
    extract: (m) => ({ detail: m[1] }),
  },
  {
    pattern: /^Failed to delete credential from Secret Service: (.+)$/,
    key: "errors.keyringDeleteFailed",
    extract: (m) => ({ detail: m[1] }),
  },
  {
    pattern: /^CredWriteW failed with code (.+)$/,
    key: "errors.credentialWriteFailed",
    extract: (m) => ({ code: m[1] }),
  },
  {
    pattern: /^CredDeleteW failed with code (.+)$/,
    key: "errors.credentialDeleteFailed",
    extract: (m) => ({ code: m[1] }),
  },
  {
    pattern: /^خطأ أمني حرج: توجد معاملة سابقة غير مكتملة وفشلت استعادتها تلقائياً \((.+)\)$/,
    key: "errors.incompleteTransaction",
    extract: (m) => ({ detail: m[1] }),
  },
  {
    pattern: /^فشل حفظ الخزنة بالمفتاح الجديد: (.+)$/,
    key: "errors.changePasswordSaveFailed",
    extract: (m) => ({ detail: m[1] }),
  },
  {
    pattern: /^تم حفظ الخزنة بالمفتاح الجديد ولكن تعذر تحديث الفتح التلقائي: (.+)$/,
    key: "errors.changePasswordAutoUnlockFailed",
    extract: (m) => ({ detail: m[1] }),
  },
  {
    pattern: /^فشل تأمين نسخة أمان قبل تغيير كلمة المرور: (.+)$/,
    key: "errors.changePasswordBackupFailed",
    extract: (m) => ({ detail: m[1] }),
  },
  {
    pattern: /^تعذر حذف بعض ملفات الأمان المؤقتة السابقة: (.+)\. يرجى حذفها يدوياً لحماية سرية بياناتك السابقة\.$/,
    key: "errors.changePasswordCleanupWarning",
    extract: (m) => ({ detail: m[1] }),
  },
  {
    pattern: /^تعذر إنشاء نسخة الأرشيف الوقائي \((.+)\) ولكن تم الاحتفاظ بنسخة الخزنة السابقة كاملةً بأمان في: (.+)$/,
    key: "errors.importArchiveWarning",
    extract: (m) => ({ detail: m[1], path: m[2] }),
  },
  {
    pattern: /^فشل فتح الرابط في المتصفح: (.+)$/,
    key: "errors.openBrowserFailed",
    extract: (m) => ({ detail: m[1] }),
  },
];

function translate(
  t: TranslateFn,
  key: string,
  options?: Record<string, unknown>
): string {
  return (t as (k: string, opts?: Record<string, unknown>) => string)(key, options);
}

/**
 * Translates raw Rust/Tauri error strings and warnings at the UI boundary
 * without rewriting backend crypto or storage error plumbing.
 */
export function localizeBackendMessage(
  raw: unknown,
  fallbackKey?: string,
  t: TranslateFn = i18next.t.bind(i18next)
): string {
  const message =
    raw instanceof Error
      ? raw.message
      : typeof raw === "string"
        ? raw
        : raw !== null && raw !== undefined
          ? String(raw)
          : "";

  const trimmed = message.trim();
  if (!trimmed) {
    return fallbackKey ? translate(t, fallbackKey) : "";
  }

  for (const rule of EXACT_ERROR_RULES) {
    if (rule.matches.includes(trimmed)) {
      return translate(t, rule.key);
    }
  }

  for (const rule of PATTERN_ERROR_RULES) {
    const match = trimmed.match(rule.pattern);
    if (match) {
      return translate(t, rule.key, rule.extract ? rule.extract(match) : undefined);
    }
  }

  return trimmed;
}

export function localizePlatformName(
  platformName: string | undefined | null,
  t: TranslateFn = i18next.t.bind(i18next)
): string {
  if (!platformName) return translate(t, "platformNames.unsupported");
  const lower = platformName.toLowerCase();
  if (lower.includes("windows credential manager")) {
    return translate(t, "platformNames.windowsCredentialManager");
  }
  if (lower.includes("secret service") || lower.includes("linux")) {
    return translate(t, "platformNames.linuxSecretService");
  }
  return platformName;
}
