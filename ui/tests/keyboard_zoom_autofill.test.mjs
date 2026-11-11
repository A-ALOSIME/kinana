import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  getDestructiveDialogArrowTarget,
  getZoomActionFromKeyboardEvent,
  isEditableTarget,
  shouldActivateServiceCard,
  shouldHandleDeleteSelectionShortcut,
  shouldHandleSelectAllShortcut,
  shouldHandleSelectionEscape,
} from "../src/keyboard.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uiRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(uiRoot, "..");

test("Keyboard shortcuts scope strictly to unlocked selection mode and never intercept inputs or open dialogs", () => {
  const activeSelectionCtx = {
    unlocked: true,
    selectionMode: true,
    selectedCount: 2,
    hasOpenDialog: false,
    target: { tagName: "DIV" },
  };

  // Ctrl+A (Windows/Linux) and Cmd+A (macOS), including Arabic layout KeyA code
  assert.equal(
    shouldHandleSelectAllShortcut({ key: "a", ctrlKey: true }, activeSelectionCtx),
    true
  );
  assert.equal(
    shouldHandleSelectAllShortcut({ key: "ش", code: "KeyA", metaKey: true }, activeSelectionCtx),
    true
  );
  assert.equal(
    shouldHandleSelectAllShortcut(
      { key: "a", ctrlKey: true },
      { ...activeSelectionCtx, selectionMode: false }
    ),
    false
  );
  assert.equal(
    shouldHandleSelectAllShortcut(
      { key: "a", ctrlKey: true },
      { ...activeSelectionCtx, hasOpenDialog: true }
    ),
    false
  );
  assert.equal(
    shouldHandleSelectAllShortcut(
      { key: "a", ctrlKey: true },
      { ...activeSelectionCtx, target: { tagName: "INPUT" } }
    ),
    false
  );
  assert.equal(
    shouldHandleSelectAllShortcut(
      { key: "a", ctrlKey: true },
      { ...activeSelectionCtx, target: { tagName: "TEXTAREA", isContentEditable: false } }
    ),
    false
  );
  assert.equal(isEditableTarget({ tagName: "DIV", isContentEditable: true }), true);
  assert.equal(isEditableTarget({ tagName: "SELECT" }), true);
  assert.equal(isEditableTarget({ tagName: "BUTTON" }), false);

  // Delete in selection mode requires >= 1 selected, no dialog open, and non-editable focus
  assert.equal(
    shouldHandleDeleteSelectionShortcut({ key: "Delete" }, activeSelectionCtx),
    true
  );
  assert.equal(
    shouldHandleDeleteSelectionShortcut(
      { key: "Delete" },
      { ...activeSelectionCtx, selectedCount: 0 }
    ),
    false
  );
  assert.equal(
    shouldHandleDeleteSelectionShortcut(
      { key: "Delete" },
      { ...activeSelectionCtx, hasOpenDialog: true }
    ),
    false
  );
  assert.equal(
    shouldHandleDeleteSelectionShortcut(
      { key: "Delete" },
      { ...activeSelectionCtx, target: { tagName: "INPUT" } }
    ),
    false
  );

  // Escape exits selection mode only when no modal/dialog is open above it
  assert.equal(
    shouldHandleSelectionEscape({ key: "Escape" }, activeSelectionCtx),
    true
  );
  assert.equal(
    shouldHandleSelectionEscape(
      { key: "Escape" },
      { ...activeSelectionCtx, hasOpenDialog: true }
    ),
    false
  );

  // Zoom shortcuts work on Ctrl/Cmd without colliding with selection shortcuts
  assert.equal(getZoomActionFromKeyboardEvent({ key: "=", ctrlKey: true }), "in");
  assert.equal(getZoomActionFromKeyboardEvent({ key: "-", metaKey: true }), "out");
  assert.equal(getZoomActionFromKeyboardEvent({ key: "0", ctrlKey: true }), "reset");
  assert.equal(getZoomActionFromKeyboardEvent({ key: "a", ctrlKey: true }), null);

  // Service card keyboard activation triggers on direct card Enter/Space only
  const cardEl = {};
  const innerButton = {};
  assert.equal(
    shouldActivateServiceCard({ key: "Enter", target: cardEl, currentTarget: cardEl }),
    true
  );
  assert.equal(
    shouldActivateServiceCard({ key: " ", target: cardEl, currentTarget: cardEl }),
    true
  );
  assert.equal(
    shouldActivateServiceCard({ key: "Enter", target: innerButton, currentTarget: cardEl }),
    false
  );
});

test("English Kinana identity, NSIS upgrade hooks, destructive dialog RTL ordering, masked edit passwords, and autofill disabling invariants", () => {
  const tauriConf = JSON.parse(
    fs.readFileSync(path.join(repoRoot, "src-tauri/tauri.conf.json"), "utf8")
  );
  assert.equal(tauriConf.productName, "Kinana");
  assert.equal(tauriConf.identifier, "com.kinana.vault");
  assert.equal(tauriConf.app?.windows?.[0]?.title, "Kinana");
  assert.equal(tauriConf.app?.windows?.[0]?.generalAutofillEnabled, false);
  assert.equal(tauriConf.bundle?.windows?.nsis?.installerHooks, "nsis/hooks.nsh");

  const nsisHooks = fs.readFileSync(
    path.join(repoRoot, "src-tauri/nsis/hooks.nsh"),
    "utf8"
  );
  assert.ok(nsisHooks.includes("NSIS_HOOK_PREINSTALL"));
  assert.ok(nsisHooks.includes("NSIS_HOOK_POSTINSTALL"));
  assert.ok(nsisHooks.includes("/S /UPDATE"));

  const desktopTemplate = fs.readFileSync(
    path.join(repoRoot, "src-tauri/desktop.template"),
    "utf8"
  );
  assert.ok(desktopTemplate.includes("Name=Kinana"));
  assert.ok(!desktopTemplate.includes("Name[ar]="));

  const mainRs = fs.readFileSync(
    path.join(repoRoot, "src-tauri/src/main.rs"),
    "utf8"
  );
  assert.ok(mainRs.includes("SetIsGeneralAutofillEnabled(false)"));
  assert.ok(mainRs.includes("SetIsPasswordAutosaveEnabled(false)"));
  assert.ok(mainRs.includes("account_kind: Option<AccountKind>"));
  assert.ok(mainRs.includes("COREWEBVIEW2_BROWSING_DATA_KINDS_PASSWORD_AUTOSAVE"));

  const confirmDialogSrc = fs.readFileSync(
    path.join(uiRoot, "src/components/ui/destructive-confirm-dialog.tsx"),
    "utf8"
  );
  const dialogSrc = fs.readFileSync(
    path.join(uiRoot, "src/components/ui/dialog.tsx"),
    "utf8"
  );
  const deletePos = confirmDialogSrc.indexOf('variant="destructive"');
  const cancelPos = confirmDialogSrc.indexOf('variant="outline"');
  assert.ok(
    deletePos !== -1 && cancelPos !== -1 && deletePos < cancelPos,
    "In RTL flex-row, Delete button must precede Cancel in DOM order so Delete renders on the right and Cancel immediately on the left"
  );
  assert.ok(confirmDialogSrc.includes("cancelButtonRef.current?.focus()"));
  assert.ok(confirmDialogSrc.includes("border-border/80"));
  assert.ok(!confirmDialogSrc.includes("border-destructive/45"));
  assert.ok(confirmDialogSrc.includes("bg-destructive/15 border border-destructive/35"));
  assert.ok(confirmDialogSrc.includes("focus-visible:ring-1 focus-visible:ring-ring/50"));
  assert.ok(!confirmDialogSrc.includes("focus-visible:ring-2"));
  assert.ok(confirmDialogSrc.includes("getDestructiveDialogArrowTarget"));
  assert.ok(confirmDialogSrc.includes("confirmLockedRef"));
  assert.ok(confirmDialogSrc.includes("onCloseAutoFocus"));
  assert.ok(!confirmDialogSrc.includes("window.addEventListener"));
  assert.ok(!confirmDialogSrc.includes('type="submit"'));
  assert.ok(dialogSrc.includes("focus-visible:ring-1 focus-visible:ring-ring/50"));
  assert.ok(!dialogSrc.includes("focus:ring-2"));

  // Unit assertions for RTL arrow navigation inside DestructiveConfirmDialog
  assert.equal(getDestructiveDialogArrowTarget({ key: "ArrowRight" }), "delete");
  assert.equal(getDestructiveDialogArrowTarget({ key: "ArrowLeft" }), "cancel");
  assert.equal(getDestructiveDialogArrowTarget({ key: "ArrowUp" }), null);
  assert.equal(getDestructiveDialogArrowTarget({ key: "ArrowDown" }), null);
  assert.equal(getDestructiveDialogArrowTarget({ key: "ArrowRight", ctrlKey: true }), null);
  assert.equal(getDestructiveDialogArrowTarget({ key: "ArrowLeft", altKey: true }), null);
  assert.equal(getDestructiveDialogArrowTarget({ key: "ArrowRight", shiftKey: true }), null);
  assert.equal(getDestructiveDialogArrowTarget({ key: "ArrowRight", defaultPrevented: true }), null);
  assert.equal(
    getDestructiveDialogArrowTarget({ key: "ArrowRight" }, { tagName: "INPUT" }),
    null
  );
  assert.equal(
    getDestructiveDialogArrowTarget({ key: "ArrowLeft" }, { tagName: "TEXTAREA" }),
    null
  );

  const inputSrc = fs.readFileSync(path.join(uiRoot, "src/components/ui/input.tsx"), "utf8");
  assert.ok(inputSrc.includes('autoComplete = "off"'));
  const secretInputSrc = fs.readFileSync(
    path.join(uiRoot, "src/components/ui/secret-input.tsx"),
    "utf8"
  );
  assert.ok(secretInputSrc.includes('autoComplete = "new-password"'));
  assert.ok(secretInputSrc.includes("storedSecretMask"));
  assert.ok(secretInputSrc.includes("revealedStoredValue"));

  const accountFormFieldsSrc = fs.readFileSync(
    path.join(uiRoot, "src/components/AccountFormFields.tsx"),
    "utf8"
  );
  assert.ok(accountFormFieldsSrc.includes("hasExistingPassword"));
  assert.ok(accountFormFieldsSrc.includes("توجد كلمة مرور محفوظة ومخفية"));
  assert.ok(accountFormFieldsSrc.includes("لا توجد كلمة مرور محفوظة لهذا الحساب حالياً"));

  const appSrc = fs.readFileSync(path.join(uiRoot, "src/App.tsx"), "utf8");
  assert.ok(!appSrc.includes("isBankOrCardService(serviceName)"));
  assert.ok(appSrc.includes("DestructiveConfirmDialog"));
  assert.ok(appSrc.includes("handleToggleEditPasswordReveal"));
});
