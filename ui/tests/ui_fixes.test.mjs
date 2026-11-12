import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { createSessionGuard, lockVault } from "../src/session.ts";
import {
  DEFAULT_ZOOM,
  MAX_ZOOM,
  MIN_ZOOM,
  clampZoomLevel,
  computeZoomMetrics,
} from "../src/zoom.ts";
import {
  MASKED_RECOVERY_KEY_PLACEHOLDER,
  copyVaultRecoveryKeySecurely,
  createHiddenRecoveryKeyState,
  getVisibleRecoveryKeyText,
  revealVaultRecoveryKey,
} from "../src/recoveryKeyState.ts";
import {
  MIN_MASTER_PASSWORD_LENGTH,
  evaluatePasswordStrength,
  validateMasterPasswordForm,
} from "../src/passwordValidation.ts";
import {
  extractHorizontalPaddingClasses,
  extractTextSizeClasses,
} from "../src/lib/input-classes.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uiRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(uiRoot, "..");

test("clampZoomLevel clamps and sanitizes zoom inputs", () => {
  assert.equal(clampZoomLevel(0.2), MIN_ZOOM);
  assert.equal(clampZoomLevel(3.5), MAX_ZOOM);
  assert.equal(clampZoomLevel(Number.NaN), DEFAULT_ZOOM);
  assert.equal(clampZoomLevel(Number.POSITIVE_INFINITY), DEFAULT_ZOOM);
  assert.equal(clampZoomLevel(1.256), 1.26);
});

test("computeZoomMetrics scales container, grid tracks, and list metrics strictly monotonically without stalling", () => {
  const baseline = computeZoomMetrics(1.0);
  assert.equal(baseline.percentageLabel, "100%");
  assert.equal(baseline.containerMaxWidthCss, "80rem");
  assert.equal(baseline.gridMinColumnPx, 256);
  assert.equal(
    baseline.gridTemplateColumnsCss,
    "repeat(auto-fill, min(100%, 256px))"
  );

  const zoomedIn = computeZoomMetrics(2.0);
  assert.equal(zoomedIn.percentageLabel, "200%");
  assert.equal(zoomedIn.containerMaxWidthCss, "min(100%, 160.00rem)");
  assert.equal(zoomedIn.gridMinColumnPx, 512);
  assert.equal(
    zoomedIn.gridTemplateColumnsCss,
    "repeat(auto-fill, min(100%, 512px))"
  );
  assert.ok(zoomedIn.listTitleFontRem > baseline.listTitleFontRem);
  assert.ok(zoomedIn.listIconSizePx > baseline.listIconSizePx);

  const zoomedOut = computeZoomMetrics(0.7);
  assert.equal(zoomedOut.percentageLabel, "70%");
  assert.ok(zoomedOut.gridMinColumnPx < baseline.gridMinColumnPx);
  assert.ok(zoomedOut.listTitleFontRem < baseline.listTitleFontRem);

  // Every 10% step from 70% through 200% must produce strictly increasing dimensions (fixes Linux 140->150 & 160->200 stalls)
  let prev = computeZoomMetrics(0.7);
  for (let pct = 80; pct <= 200; pct += 10) {
    const cur = computeZoomMetrics(pct / 100);
    assert.ok(
      cur.gridMinColumnPx > prev.gridMinColumnPx,
      `gridMinColumnPx must strictly increase between ${pct - 10}% and ${pct}%`
    );
    assert.ok(
      cur.listIconSizePx > prev.listIconSizePx,
      `listIconSizePx must strictly increase between ${pct - 10}% and ${pct}%`
    );
    assert.ok(
      cur.listTitleFontRem > prev.listTitleFontRem,
      `listTitleFontRem must strictly increase between ${pct - 10}% and ${pct}%`
    );
    assert.ok(
      !cur.gridTemplateColumnsCss.includes("1fr"),
      "Grid track sizing must not use 1fr expansion that freezes 2-card row sizes across zoom levels"
    );
    prev = cur;
  }
});

test("Vault recovery key defaults to masked placeholder until explicitly revealed and clears when stale", async () => {
  const hidden = createHiddenRecoveryKeyState();
  assert.equal(getVisibleRecoveryKeyText(hidden), MASKED_RECOVERY_KEY_PLACEHOLDER);

  // Value present in state but not revealed must remain masked.
  assert.equal(
    getVisibleRecoveryKeyText({ value: "KN-AAAA-BBBB-CCCC-DDDD", revealed: false }),
    MASKED_RECOVERY_KEY_PLACEHOLDER
  );

  // Valid unlocked session can reveal the key, whereas a locked guard refuses.
  const guard = createSessionGuard();
  const blockedWhenLocked = await revealVaultRecoveryKey(guard, async () => "KN-SHOULD-NOT-EXPOSE");
  assert.equal(blockedWhenLocked, null);

  guard.unlock();
  const revealed = await revealVaultRecoveryKey(guard, async (cmd) => {
    assert.equal(cmd, "get_or_generate_recovery_key");
    return "KN-1111-2222-3333-4444";
  });
  assert.deepEqual(revealed, { value: "KN-1111-2222-3333-4444", revealed: true });
  assert.equal(getVisibleRecoveryKeyText(revealed), "KN-1111-2222-3333-4444");

  // Locking mid-IPC discards the revealed recovery key.
  let resolveSlowCall;
  const slowPromise = revealVaultRecoveryKey(guard, async () => {
    return new Promise((resolve) => {
      resolveSlowCall = resolve;
    });
  });
  await lockVault(guard, async () => {}, () => {});
  resolveSlowCall("KN-STALE-KEY");
  const lateResult = await slowPromise;
  assert.equal(lateResult, null);
});

test("copyVaultRecoveryKeySecurely triggers backend copy command without exposing key to frontend state", async () => {
  const commands = [];
  await copyVaultRecoveryKeySecurely(async (cmd) => {
    commands.push(cmd);
    return undefined;
  });
  assert.deepEqual(commands, ["copy_vault_recovery_key"]);
});

test("UI components avoid Arabic letter-spacing bugs, RTL alignment regressions, and misaligned eye buttons", () => {
  const dialogSrc = fs.readFileSync(path.join(uiRoot, "src/components/ui/dialog.tsx"), "utf8");
  assert.ok(!dialogSrc.includes("sm:text-left"), "DialogHeader must not force LTR sm:text-left");
  assert.ok(!dialogSrc.includes("tracking-tight"), "DialogTitle must not apply tracking-tight to Arabic text");
  assert.ok(dialogSrc.includes("text-start pe-8"), "DialogHeader must align to start with close-button clearance");

  const alertSrc = fs.readFileSync(path.join(uiRoot, "src/components/ui/alert.tsx"), "utf8");
  assert.ok(!alertSrc.includes("tracking-tight"), "AlertTitle must not apply tracking-tight to Arabic text");

  const cardSrc = fs.readFileSync(path.join(uiRoot, "src/components/ui/card.tsx"), "utf8");
  assert.ok(!cardSrc.includes("tracking-tight"), "CardTitle must not apply tracking-tight to Arabic text");

  const placeholderOverlaySrc = fs.readFileSync(
    path.join(uiRoot, "src/components/ui/placeholder-overlay.tsx"),
    "utf8"
  );
  assert.ok(placeholderOverlaySrc.includes('dir="auto"'), "Shared placeholder overlay must auto-detect RTL/LTR direction cleanly");
  assert.ok(placeholderOverlaySrc.includes("lineHeight: 2.15"), "Shared placeholder overlay must reserve vertical line-height headroom above and below Arabic baselines");
  assert.ok(placeholderOverlaySrc.includes("pt-0.5 pb-1.5"), "Shared placeholder overlay must include extra bottom descender clearance inside horizontal truncation");
  assert.ok(!placeholderOverlaySrc.includes("inset-y-0 flex items-center text-muted-foreground font-sans font-normal tracking-normal overflow-hidden"), "Outer inset-0 placeholder wrapper must not apply vertical overflow-hidden clipping");

  const secretInputSrc = fs.readFileSync(
    path.join(uiRoot, "src/components/ui/secret-input.tsx"),
    "utf8"
  );
  assert.ok(secretInputSrc.includes("top-1/2 -translate-y-1/2"), "Toggle button must stay vertically centered");
  assert.ok(secretInputSrc.includes("codeStyleWhenFilled && hasValue"), "Code font/tracking must apply only when non-empty");
  assert.ok(!secretInputSrc.includes('dir="ltr"'), "Input must not set HTML dir=ltr attribute over Tailwind rtl: selectors");
  assert.ok(secretInputSrc.includes("aria-placeholder={placeholder}"), "SecretInput must expose accessible placeholder semantics while avoiding native WebKit password shadow placeholder glyph corruption");
  assert.ok(secretInputSrc.includes("PlaceholderOverlay"), "SecretInput must render placeholders through shared PlaceholderOverlay");
  assert.ok(secretInputSrc.includes("rtl:pl-14"), "SecretInput must reserve clearance for eye toggle icon");
  assert.ok(secretInputSrc.includes("min-h-12") && secretInputSrc.includes("min-h-16"), "SecretInput must use min-h controls rather than clipping tall Arabic glyphs");

  const inputSrc = fs.readFileSync(
    path.join(uiRoot, "src/components/ui/input.tsx"),
    "utf8"
  );
  assert.ok(!inputSrc.includes("md:text-sm"), "Input base style must not override desktop form text sizes with md:text-sm");
  assert.ok(inputSrc.includes("leading-[2]"), "Input base style must enforce sufficient vertical line height for Arabic descenders and diacritics");
  assert.ok(inputSrc.includes("min-h-10"), "Input base style must avoid rigid clipping height constraints");
  assert.ok(inputSrc.includes("px-4"), "Input base style must provide comfortable horizontal padding");
  assert.ok(inputSrc.includes("PlaceholderOverlay"), "Input must share PlaceholderOverlay so ordinary Arabic placeholders bypass WebKitGTK shadow-placeholder clipping");

  const formLabelSrc = fs.readFileSync(
    path.join(uiRoot, "src/components/ui/form-label.tsx"),
    "utf8"
  );
  assert.ok(formLabelSrc.includes("text-red-400"), "Required fields must display a visible red asterisk");
  assert.ok(formLabelSrc.includes("sr-only"), "Required fields must provide accessible screen-reader semantics");

  const cssSrc = fs.readFileSync(path.join(uiRoot, "src/index.css"), "utf8");
  assert.ok(cssSrc.includes("input::placeholder"), "Placeholder font/tracking reset must exist");
  assert.ok(cssSrc.includes("font-weight: 400;"), "Native placeholders must not inherit bold descender bounds");
  assert.ok(cssSrc.includes("unicode-bidi: plaintext"), "Placeholders must use plaintext bidi direction");
  assert.ok(cssSrc.includes("line-height: 2;"), "Global input/placeholder CSS must enforce 2.0 line height to prevent descender clipping");
  assert.ok(!cssSrc.includes("overflow: visible !important"), "Must not use blanket overflow: visible hacks");
  assert.ok(cssSrc.includes("letter-spacing: normal"), "Default form letter-spacing must be normalized");
  assert.ok(cssSrc.includes("container-type: inline-size"), "Service cards must establish container-query sizing");

  const rawAppSrc = fs.readFileSync(path.join(uiRoot, "src/App.tsx"), "utf8");
  const appSrcNoComments = rawAppSrc.replace(/\/\*[\s\S]*?\*\/|^[ \t]*\/\/.*$/gm, "");
  const accountFormFieldsSrc = fs.readFileSync(
    path.join(uiRoot, "src/components/AccountFormFields.tsx"),
    "utf8"
  );
  const strengthIndicatorSrc = fs.readFileSync(
    path.join(uiRoot, "src/components/ui/password-strength-indicator.tsx"),
    "utf8"
  );

  assert.ok(!appSrcNoComments.includes("style={{ zoom:"), "Non-standard CSS zoom must not be applied to main container");
  assert.ok(!appSrcNoComments.includes("h-13"), "Invalid Tailwind h-13 class must not remain in App.tsx");
  assert.ok(!appSrcNoComments.includes("فتح مسار ملف الخزنة في ويندوز"), "Cross-platform vault folder label must not say Windows");
  assert.ok(!appSrcNoComments.includes("blur-3xl"), "Service detail modal must avoid expensive blur-3xl FBO effects");

  // Validate simplified forms, placeholder reduction, unified AccountFormFields, and card centering
  assert.ok(!appSrcNoComments.includes("(اختياري)"), "Redundant optional suffixes must be removed from field labels");
  assert.ok(!appSrcNoComments.includes("- اختياري"), "Redundant optional suffixes must be removed from field labels");
  assert.ok(!appSrcNoComments.includes("جميع الخانات اختيارية ويمكنك ملء البيانات"), "Verbose Add Account description must be removed");
  assert.ok(!appSrcNoComments.includes("قالب بطاقات بنكية مخصص"), "Verbose Bank Card description must be removed");
  assert.ok(!appSrcNoComments.includes("لا توجد حسابات مسجلة تحت هذه الخدمة حتى الآن."), "Verbose empty-state wording must be removed");
  assert.ok(!accountFormFieldsSrc.includes("BANK CARD"), "Redundant BANK CARD badge beside card number label must be removed");

  const arLocale = JSON.parse(
    fs.readFileSync(path.join(uiRoot, "src/i18n/locales/ar.json"), "utf8")
  );
  const enLocale = JSON.parse(
    fs.readFileSync(path.join(uiRoot, "src/i18n/locales/en.json"), "utf8")
  );
  const getLocaleKey = (localeObj, dottedKey) =>
    dottedKey.split(".").reduce((acc, part) => (acc ? acc[part] : undefined), localeObj);

  const combinedFormSrc = appSrcNoComments + "\n" + accountFormFieldsSrc;
  const formLabelBlocks =
    combinedFormSrc.match(/<FormLabel\b[^>]*>[\s\S]*?<\/FormLabel>/g) || [];
  assert.ok(formLabelBlocks.length >= 20, "FormLabel blocks must cover all form fields");
  for (const labelBlock of formLabelBlocks) {
    assert.ok(
      !labelBlock.includes("اختياري"),
      `Field label must not contain اختياري: ${labelBlock}`
    );
    for (const keyMatch of labelBlock.matchAll(/t\("([^"]+)"\)/g)) {
      const arLabel = String(getLocaleKey(arLocale, keyMatch[1]) ?? "");
      const enLabel = String(getLocaleKey(enLocale, keyMatch[1]) ?? "").toLowerCase();
      assert.ok(
        !arLabel.includes("اختياري") && !enLabel.includes("(optional)"),
        `Localized field label ${keyMatch[1]} must not contain optional suffix: ${arLabel} / ${enLabel}`
      );
    }
  }

  // Required fields in App.tsx (10 static required fields including Create Vault confirmation) + Add Card Number dynamic required in AccountFormFields
  const requiredLabelMatches = appSrcNoComments.match(/<FormLabel\b[^>]*\brequired\b/g) || [];
  assert.equal(requiredLabelMatches.length, 10, "All 10 static required form fields in App.tsx must carry red asterisks");
  assert.ok(accountFormFieldsSrc.includes("required={!isEdit}"), "Add Card Number must require input on creation while allowing empty retain on edit");

  const requiredFieldIds = [
    "create-vault-password",
    "create-vault-confirm-password",
    "unlock-vault-password",
    "add-service-name",
    "edit-service-name",
    "settings-new-password",
    "settings-confirm-password",
    "auto-unlock-password",
    "recovery-key-input",
    "import-vault-password",
  ];
  for (const fieldId of requiredFieldIds) {
    assert.ok(
      appSrcNoComments.includes(`htmlFor="${fieldId}"`) && appSrcNoComments.includes(`id="${fieldId}"`),
      `Required field ${fieldId} must link FormLabel htmlFor to input id`
    );
  }

  // AccountFormFields must unify Add & Edit layouts, restrict placeholders, and attach informational PasswordStrengthIndicator solely to non-empty login account passwords
  assert.ok(appSrcNoComments.includes('<AccountFormFields') && appSrcNoComments.includes('idPrefix="add"') && appSrcNoComments.includes('idPrefix="edit"'), "Both Add and Edit modals must reuse unified AccountFormFields component");
  assert.equal((accountFormFieldsSrc.match(/<PasswordStrengthIndicator/g) || []).length, 1, "AccountFormFields must render PasswordStrengthIndicator solely beneath the login account password field");
  assert.ok(
    accountFormFieldsSrc.includes("password.length > 0") &&
      accountFormFieldsSrc.indexOf("mode === \"card\"") < accountFormFieldsSrc.indexOf("<PasswordStrengthIndicator"),
    "Account password strength indicator must only show when a new/replacement login password is entered or generated (never for card fields or blank edit password)"
  );
  const generateStart = appSrcNoComments.indexOf("const handleGeneratePassword");
  const generateEnd = appSrcNoComments.indexOf("const handleToggleEditPasswordReveal");
  assert.ok(generateStart !== -1 && generateEnd > generateStart);
  const generateSection = appSrcNoComments.slice(generateStart, generateEnd);
  assert.ok(
    !generateSection.includes("setShowAccPassword(true)") &&
      !generateSection.includes("setShowEditPassword(true)"),
    "Account password fields must remain masked by default even after generating a password"
  );
  const accountPlaceholderKeys = [
    ...accountFormFieldsSrc.matchAll(/placeholder=\{t\("([^"]+)"\)\}/g),
  ].map((m) => m[1]);
  assert.deepEqual(
    accountPlaceholderKeys,
    [
      "accountForm.card.labelPlaceholder",
      "accountForm.card.holderPlaceholder",
      "accountForm.login.labelPlaceholder",
    ],
    "Account/Card forms must retain placeholders solely for card label, cardholder name, and account label"
  );
  assert.deepEqual(
    accountPlaceholderKeys.map((k) => getLocaleKey(arLocale, k)),
    [
      "بطاقة الراتب، بطاقة السفر...",
      "الاسم كما هو مطبوع على البطاقة بالإنجليزية",
      "حساب شخصي، حساب العمل...",
    ],
    "Account/Card Arabic placeholders must match the exact expected wording"
  );
  assert.ok(
    accountFormFieldsSrc.includes('id={`${idPrefix}-card-number`}') &&
      accountFormFieldsSrc.includes("centered") &&
      accountFormFieldsSrc.includes('direction: "ltr"') &&
      accountFormFieldsSrc.includes('textAlign: "center"'),
    "Both Add and Edit Card Number inputs must use centered LTR block formatting"
  );
  assert.ok(!/اتركه فارغاً[\u200B-\u200F\u202A-\u202E\u2066-\u2069]/.test(accountFormFieldsSrc), "Edit retention hints must not contain hidden Unicode control characters");

  // Vault Creation Screen & Settings Change Master Password invariants
  const createSectionStart = appSrcNoComments.indexOf("create-vault-password");
  const unlockSectionStart = appSrcNoComments.indexOf("unlock-vault-password");
  assert.ok(createSectionStart !== -1 && unlockSectionStart > createSectionStart);
  const createSection = appSrcNoComments.slice(createSectionStart - 300, unlockSectionStart);
  assert.ok(!createSection.includes("PIN"), "Initial Vault Creation screen must not contain PIN terminology");
  assert.ok(!createSection.includes("ShieldCheck"), "Initial Vault Creation screen must replace shield icons with neutral Info icon");
  assert.ok(createSection.includes("<Info"), "Initial Vault Creation recovery notice must use circle-i Info icon");
  assert.ok(createSection.includes('t("auth.create.recoveryNotice")'), "Initial Vault Creation must render localized recovery notice");
  assert.ok(arLocale.auth.create.recoveryNotice.includes("احتفظ بكلمة المرور الرئيسية ومفتاح الاسترداد في مكان آمن"), "Initial Vault Creation must accurately state recovery key + master password behavior");
  assert.ok(createSection.includes('t("auth.create.mismatchError")'), "Initial Vault Creation must render localized mismatch feedback");
  assert.ok(arLocale.auth.create.mismatchError.includes("كلمتا المرور غير متطابقتين"), "Initial Vault Creation must show deferred mismatch feedback");
  assert.ok(createSection.includes("disabled={!createValidation.canSubmit}"), "Create Vault button must remain disabled until valid and matching");
  assert.ok(createSection.includes('t("auth.create.noExistingVaultNote")'), "Initial Vault Creation must render localized missing-vault note");
  assert.ok(arLocale.auth.create.noExistingVaultNote.includes("لم يتم العثور على خزنة سابقة على هذا الجهاز"), "Initial Vault Creation must display missing-vault note below Create button");

  // Verify exact Create Vault order
  const orderMarkers = [
    'id="create-vault-password"',
    "<PasswordStrengthIndicator",
    'id="create-vault-confirm-password"',
    't("auth.create.mismatchError")',
    't("auth.create.recoveryNotice")',
    't("auth.create.submit")',
    't("auth.create.noExistingVaultNote")',
    't("auth.create.importExistingPrompt")',
  ];
  let lastOrderPos = -1;
  for (const marker of orderMarkers) {
    const pos = createSection.indexOf(marker);
    assert.ok(pos > lastOrderPos, `Create Vault element out of expected order: ${marker}`);
    lastOrderPos = pos;
  }

  // Settings Password Change & Auto-Unlock notice
  assert.ok(
    !appSrcNoComments.includes("تغيير رمز الدخول (PIN)") &&
      !JSON.stringify(arLocale).includes("تغيير رمز الدخول (PIN)"),
    "Settings title must remove PIN reference"
  );
  assert.ok(
    appSrcNoComments.includes('t("settings.changePassword.title")'),
    "Settings title must use localized changePassword title key"
  );
  assert.equal(
    arLocale.settings.changePassword.title,
    "تغيير كلمة المرور الرئيسية",
    "Settings title must use تغيير كلمة المرور الرئيسية"
  );
  assert.ok((appSrcNoComments.match(/<PasswordStrengthIndicator/g) || []).length === 2, "Settings and Vault Creation must share the exact same PasswordStrengthIndicator component");
  assert.ok(!strengthIndicatorSrc.includes("red") && !strengthIndicatorSrc.includes("rose") && !strengthIndicatorSrc.includes("destructive"), "PasswordStrengthIndicator must not use red styling for weakest level");

  const detailStartIdx = rawAppSrc.indexOf("MODAL: SERVICE DETAIL & ACCOUNTS");
  const detailEndIdx = rawAppSrc.indexOf("MODAL: ADD SERVICE");
  assert.ok(detailStartIdx !== -1 && detailEndIdx > detailStartIdx, "Service detail modal bounds must exist");
  const serviceDetailSection = rawAppSrc
    .slice(detailStartIdx, detailEndIdx)
    .replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
  assert.ok(!serviceDetailSection.includes("backdrop-blur"), "Service detail cards must avoid nested backdrop-blur artifacts");

  const linuxConf = JSON.parse(
    fs.readFileSync(path.join(repoRoot, "src-tauri/tauri.linux.conf.json"), "utf8")
  );
  assert.equal(linuxConf?.productName, "kinana");
  assert.equal(linuxConf?.bundle?.linux?.deb?.desktopTemplate, "desktop.template");
  assert.equal(linuxConf?.bundle?.linux?.deb?.depends, undefined);
});

test("evaluatePasswordStrength returns 4 restrained Arabic strength levels locally and independently of minimum length", () => {
  assert.deepEqual(evaluatePasswordStrength(""), { level: 0, label: "" });
  assert.deepEqual(evaluatePasswordStrength("abc"), { level: 1, label: "ضعيفة" });
  assert.deepEqual(evaluatePasswordStrength("aaaaaaaaaaaa"), { level: 1, label: "ضعيفة" });
  assert.deepEqual(evaluatePasswordStrength("Password1"), { level: 2, label: "متوسطة" });
  assert.deepEqual(evaluatePasswordStrength("MyPass123!"), { level: 3, label: "قوية" });
  assert.deepEqual(evaluatePasswordStrength("Strong#Master2026Vault!"), { level: 4, label: "قوية جداً" });
});

test("validateMasterPasswordForm enforces minimum length, deferred mismatch display, and submit state", () => {
  // Initial empty state: disabled, no mismatch shown
  const initial = validateMasterPasswordForm({
    password: "",
    confirmPassword: "",
    confirmTouched: false,
    isSubmitting: false,
  });
  assert.equal(initial.canSubmit, false);
  assert.equal(initial.showMismatchError, false);

  // Typing primary password before confirmation is touched: still no mismatch shown
  const beforeConfirm = validateMasterPasswordForm({
    password: "ValidMaster#Password1",
    confirmPassword: "",
    confirmTouched: false,
    isSubmitting: false,
  });
  assert.equal(beforeConfirm.minLengthMet, true);
  assert.equal(beforeConfirm.showMismatchError, false);
  assert.equal(beforeConfirm.canSubmit, false);

  // Confirmation edited with mismatch: shows mismatch & disables submit
  const mismatched = validateMasterPasswordForm({
    password: "ValidMaster#Password1",
    confirmPassword: "ValidMaster#Password2",
    confirmTouched: true,
    isSubmitting: false,
  });
  assert.equal(mismatched.showMismatchError, true);
  assert.equal(mismatched.canSubmit, false);

  // Matching short password (< 8): no mismatch, still disabled until min length reached
  assert.equal(MIN_MASTER_PASSWORD_LENGTH, 8);
  const tooShort = validateMasterPasswordForm({
    password: "Ab1!xyz",
    confirmPassword: "Ab1!xyz",
    confirmTouched: true,
    isSubmitting: false,
  });
  assert.equal(tooShort.passwordsMatch, true);
  assert.equal(tooShort.minLengthMet, false);
  assert.equal(tooShort.showMismatchError, false);
  assert.equal(tooShort.canSubmit, false);

  // Valid, matching, and idle: enabled; disabled again while submitting to block double submit
  const validIdle = validateMasterPasswordForm({
    password: "ValidMaster#Password1",
    confirmPassword: "ValidMaster#Password1",
    confirmTouched: true,
    isSubmitting: false,
  });
  assert.equal(validIdle.showMismatchError, false);
  assert.equal(validIdle.canSubmit, true);

  const validBusy = validateMasterPasswordForm({
    password: "ValidMaster#Password1",
    confirmPassword: "ValidMaster#Password1",
    confirmTouched: true,
    isSubmitting: true,
  });
  assert.equal(validBusy.canSubmit, false);
});

test("PlaceholderOverlay helpers extract horizontal padding and text sizes for custom inputs without clipping", () => {
  assert.equal(extractTextSizeClasses("min-h-10 text-xs pr-9 pl-8 rounded-xl"), "text-xs");
  assert.equal(extractTextSizeClasses("min-h-14 text-lg sm:text-xl font-bold"), "text-lg sm:text-xl");
  assert.equal(extractTextSizeClasses("min-h-12 font-bold"), "text-sm");
  assert.equal(extractHorizontalPaddingClasses("min-h-10 text-xs pr-9 pl-8 rounded-xl"), "pr-9 pl-8");
  assert.equal(extractHorizontalPaddingClasses("min-h-12 text-base font-bold rounded-xl"), "px-4");
  assert.equal(extractHorizontalPaddingClasses("rtl:pl-14 rtl:pr-4 ltr:pr-14 ltr:pl-4"), "rtl:pl-14 rtl:pr-4 ltr:pr-14 ltr:pl-4");
});
