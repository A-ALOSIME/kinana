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

test("computeZoomMetrics scales container, grid tracks, and list metrics proportionally without overflow", () => {
  const baseline = computeZoomMetrics(1.0);
  assert.equal(baseline.percentageLabel, "100%");
  assert.equal(baseline.containerMaxWidthCss, "80rem");
  assert.equal(baseline.gridMinColumnPx, 256);
  assert.equal(
    baseline.gridTemplateColumnsCss,
    "repeat(auto-fill, minmax(min(100%, 256px), 1fr))"
  );

  const zoomedIn = computeZoomMetrics(2.0);
  assert.equal(zoomedIn.percentageLabel, "200%");
  assert.equal(zoomedIn.containerMaxWidthCss, "min(100%, 160.00rem)");
  assert.equal(zoomedIn.gridMinColumnPx, 512);
  assert.equal(
    zoomedIn.gridTemplateColumnsCss,
    "repeat(auto-fill, minmax(min(100%, 512px), 1fr))"
  );
  assert.ok(zoomedIn.listTitleFontRem > baseline.listTitleFontRem);
  assert.ok(zoomedIn.listIconSizePx > baseline.listIconSizePx);

  const zoomedOut = computeZoomMetrics(0.7);
  assert.equal(zoomedOut.percentageLabel, "70%");
  assert.ok(zoomedOut.gridMinColumnPx < baseline.gridMinColumnPx);
  assert.ok(zoomedOut.listTitleFontRem < baseline.listTitleFontRem);
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

  const secretInputSrc = fs.readFileSync(
    path.join(uiRoot, "src/components/ui/secret-input.tsx"),
    "utf8"
  );
  assert.ok(secretInputSrc.includes("top-1/2 -translate-y-1/2"), "Toggle button must stay vertically centered");
  assert.ok(secretInputSrc.includes("codeStyleWhenFilled && hasValue"), "Code font/tracking must apply only when non-empty");
  assert.ok(!secretInputSrc.includes('dir="ltr"'), "Input must not set HTML dir=ltr attribute over Tailwind rtl: selectors");
  assert.ok(secretInputSrc.includes("aria-placeholder={placeholder}"), "SecretInput must expose accessible placeholder semantics while avoiding native WebKit password shadow placeholder glyph corruption");
  assert.ok(secretInputSrc.includes('dir="auto"'), "SecretInput placeholder overlay must auto-detect RTL/LTR direction cleanly");
  assert.ok(secretInputSrc.includes("rtl:pl-14"), "SecretInput must reserve clearance for eye toggle icon");

  const inputSrc = fs.readFileSync(
    path.join(uiRoot, "src/components/ui/input.tsx"),
    "utf8"
  );
  assert.ok(!inputSrc.includes("md:text-sm"), "Input base style must not override desktop form text sizes with md:text-sm");
  assert.ok(inputSrc.includes("leading-[1.65]"), "Input base style must enforce sufficient vertical line height for Arabic descenders and diacritics");
  assert.ok(inputSrc.includes("px-4"), "Input base style must provide comfortable horizontal padding");

  const formLabelSrc = fs.readFileSync(
    path.join(uiRoot, "src/components/ui/form-label.tsx"),
    "utf8"
  );
  assert.ok(formLabelSrc.includes("text-red-400"), "Required fields must display a visible red asterisk");
  assert.ok(formLabelSrc.includes("sr-only"), "Required fields must provide accessible screen-reader semantics");

  const cssSrc = fs.readFileSync(path.join(uiRoot, "src/index.css"), "utf8");
  assert.ok(cssSrc.includes("input::placeholder"), "Placeholder font/tracking reset must exist");
  assert.ok(cssSrc.includes("unicode-bidi: plaintext"), "Placeholders must use plaintext bidi direction");
  assert.ok(cssSrc.includes("letter-spacing: normal"), "Default form letter-spacing must be normalized");
  assert.ok(cssSrc.includes("container-type: inline-size"), "Service cards must establish container-query sizing");

  const rawAppSrc = fs.readFileSync(path.join(uiRoot, "src/App.tsx"), "utf8");
  const appSrcNoComments = rawAppSrc.replace(/\/\*[\s\S]*?\*\/|^[ \t]*\/\/.*$/gm, "");
  assert.ok(!appSrcNoComments.includes("style={{ zoom:"), "Non-standard CSS zoom must not be applied to main container");
  assert.ok(!appSrcNoComments.includes("h-13"), "Invalid Tailwind h-13 class must not remain in App.tsx");
  assert.ok(!appSrcNoComments.includes("فتح مسار ملف الخزنة في ويندوز"), "Cross-platform vault folder label must not say Windows");
  assert.ok(!appSrcNoComments.includes("blur-3xl"), "Service detail modal must avoid expensive blur-3xl FBO effects");

  // Validate form label cleanup, required asterisks, and Arabic placeholders beginning with اتركه فارغاً
  assert.ok(!appSrcNoComments.includes("(اختياري)"), "Redundant optional suffixes must be removed from field labels");
  assert.ok(!appSrcNoComments.includes("- اختياري"), "Redundant optional suffixes must be removed from field labels");
  const formLabelBlocks =
    appSrcNoComments.match(/<FormLabel\b[^>]*>[\s\S]*?<\/FormLabel>/g) || [];
  assert.ok(formLabelBlocks.length >= 25, "FormLabel blocks must cover all form fields");
  for (const labelBlock of formLabelBlocks) {
    assert.ok(
      !labelBlock.includes("اختياري"),
      `Field label must not contain اختياري: ${labelBlock}`
    );
  }

  const requiredLabelMatches = appSrcNoComments.match(/<FormLabel\b[^>]*\brequired\b/g) || [];
  assert.equal(requiredLabelMatches.length, 10, "Exactly the 10 genuinely required form fields must carry red asterisks");

  const requiredFieldIds = [
    "create-vault-password",
    "unlock-vault-password",
    "add-service-name",
    "edit-service-name",
    "add-card-number",
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

  const leaveEmptyMatches = appSrcNoComments.match(/اتركه فارغاً للإبقاء/g) || [];
  assert.equal(leaveEmptyMatches.length, 5, "All 5 edit secret fields must retain contextual اتركه فارغاً placeholders intact");
  assert.ok(!/اتركه فارغاً[\u200B-\u200F\u202A-\u202E\u2066-\u2069]/.test(appSrcNoComments), "Arabic placeholder strings must not contain hidden Unicode control characters");
  assert.ok(
    appSrcNoComments.includes('id="edit-acc-url"') &&
      appSrcNoComments.includes('placeholder="https://..."') &&
      appSrcNoComments.includes('direction: "ltr"'),
    "URL inputs must enforce LTR direction flow so https://... is not visually reversed"
  );

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
