import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const uiRoot = path.resolve(__dirname, "..");
const localesDir = path.resolve(uiRoot, "src/i18n/locales");
const appTsxPath = path.resolve(uiRoot, "src/App.tsx");

const EMOJI_REGEX =
  /[\u{1F300}-\u{1F64F}\u{1F680}-\u{1F6FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F900}-\u{1F9FF}\u{1FA70}-\u{1FAFF}]/u;

const EXPECTED_LANGUAGES = [
  "ar", "en", "es", "fr", "de", "pt-BR", "zh-CN", "zh-TW",
  "ja", "ko", "ru", "fa", "tr", "it", "id", "hi",
  "vi", "th", "pl", "uk", "he", "ur"
];

const REQUIRED_RESET_VAULT_KEYS = [
  "recoveryNoticeTitle",
  "recoveryNoticeDesc",
  "startNewVaultButton",
  "confirmTitle",
  "confirmWarning1",
  "confirmWarning2",
  "confirmRecommendation",
  "typeResetPrompt",
  "confirmButton",
  "resetting",
  "resetSuccessTitle",
  "resetSuccessDetail",
  "resetFailed",
];

test("All 22 locale files define complete resetVault translations with zero emoji", () => {
  for (const lang of EXPECTED_LANGUAGES) {
    const filePath = path.join(localesDir, `${lang}.json`);
    assert.ok(fs.existsSync(filePath), `Locale file missing for ${lang}`);
    const content = JSON.parse(fs.readFileSync(filePath, "utf-8"));

    assert.ok(content.resetVault, `resetVault section missing in ${lang}.json`);

    for (const key of REQUIRED_RESET_VAULT_KEYS) {
      const val = content.resetVault[key];
      assert.ok(
        typeof val === "string" && val.trim().length > 0,
        `Missing or empty resetVault.${key} in ${lang}.json`
      );
      assert.equal(
        EMOJI_REGEX.test(val),
        false,
        `Emoji detected in resetVault.${key} in ${lang}.json: "${val}"`
      );
    }

    assert.ok(
      content.resetVault.typeResetPrompt.includes("{{word}}"),
      `typeResetPrompt in ${lang}.json should include {{word}} placeholder`
    );
    assert.ok(
      content.resetVault.resetFailed.includes("{{detail}}"),
      `resetFailed in ${lang}.json should include {{detail}} placeholder`
    );
  }
});

test("Authentication screen redesign places logo and tagline outside card with ~64px separation", () => {
  const appTsx = fs.readFileSync(appTsxPath, "utf-8");

  // Language switcher pinned to top-left corner
  assert.ok(
    appTsx.includes('className="fixed top-5 left-6 z-20"'),
    "LanguageSwitcher should be fixed to top-5 left-6"
  );

  // Logo outside card with ~144-160px height
  assert.ok(
    appTsx.includes('src={kinanaLogo}'),
    "App should render kinanaLogo"
  );
  assert.ok(
    appTsx.includes('className="h-36 sm:h-40 w-auto object-contain drop-shadow-xl"'),
    "Logo should have responsive height h-36 sm:h-40 (~144-160px)"
  );

  // Tagline outside card
  assert.ok(
    appTsx.includes('{t("auth.tagline")}'),
    "Tagline should be rendered with localized key"
  );

  // Responsive clear separation (~64px / 4rem) between tagline and form card
  assert.ok(
    appTsx.includes('className="h-10 sm:h-16 shrink-0" aria-hidden="true"'),
    "Dedicated vertical spacer (~64px on sm+ screens) should separate header from form card"
  );

  // Form card constrained to max 420-440px
  assert.ok(
    appTsx.includes('max-w-[440px]'),
    "Form card should be constrained to max-w-[440px]"
  );
});

test("Start a New Vault reset feature is wired securely inside recovery modal and dedicated confirmation dialog", () => {
  const appTsx = fs.readFileSync(appTsxPath, "utf-8");

  // Notice card and trigger button inside recovery modal
  assert.ok(
    appTsx.includes('t("resetVault.recoveryNoticeTitle")'),
    "Recovery modal should show reset notice title"
  );
  assert.ok(
    appTsx.includes('t("resetVault.recoveryNoticeDesc")'),
    "Recovery modal should explain that reset does not recover old password"
  );
  assert.ok(
    appTsx.includes('t("resetVault.startNewVaultButton")'),
    "Recovery modal should include trigger button for Start a New Vault"
  );

  // Dedicated confirmation dialog
  assert.ok(
    appTsx.includes('showResetConfirmModal'),
    "App should manage showResetConfirmModal state"
  );
  assert.ok(
    appTsx.includes('resetConfirmationInput.trim() !== "RESET"'),
    "Reset button must be disabled unless confirmation input is 'RESET'"
  );

  // Safe defaults
  assert.ok(
    appTsx.includes('resetCancelButtonRef.current?.focus()'),
    "Reset dialog should auto-focus Cancel button on open"
  );
  assert.ok(
    appTsx.includes('if (e.key === "Enter")'),
    "Reset dialog should prevent accidental Enter key submission"
  );

  // Backend invocation and post-reset state
  assert.ok(
    appTsx.includes('await invoke("reset_vault")'),
    "Reset handler should invoke backend reset_vault command"
  );
  assert.ok(
    appTsx.includes('setExists(false)'),
    "Successful reset should switch state to first-time setup (setExists(false))"
  );
});
