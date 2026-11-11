import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  EditSecretRevealController,
  formatStoredSecretForEditDisplay,
} from "../src/editSecretReveal.ts";
import { buildUpdateAccountPayload } from "../src/accountForm.ts";
import {
  clearNonEditableDocumentSelection,
  shouldHandleSelectAllShortcut,
  shouldPreventNativeSelectAll,
} from "../src/keyboard.ts";
import {
  NOTIFICATION_DURATIONS_MS,
  TimedNotificationController,
} from "../src/notifications.ts";
import { createSessionGuard } from "../src/session.ts";
import {
  createHiddenRecoveryKeyState,
  getVisibleRecoveryKeyText,
  revealVaultRecoveryKey,
} from "../src/recoveryKeyState.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uiRoot = path.resolve(__dirname, "..");

function createFakeTimers() {
  let nextTimerId = 1;
  let now = 0;
  const tasks = new Map();

  const api = {
    setTimeout(fn, ms) {
      const id = nextTimerId++;
      tasks.set(id, { id, runAt: now + ms, fn });
      return id;
    },
    clearTimeout(id) {
      tasks.delete(id);
    },
  };

  function advanceBy(ms) {
    const target = now + ms;
    while (true) {
      let nextTask = null;
      for (const task of tasks.values()) {
        if (task.runAt <= target && (!nextTask || task.runAt < nextTask.runAt)) {
          nextTask = task;
        }
      }
      if (!nextTask) break;
      tasks.delete(nextTask.id);
      now = nextTask.runAt;
      nextTask.fn();
    }
    now = target;
  }

  return {
    api,
    advanceBy,
    pendingCount: () => tasks.size,
  };
}

test("EditSecretRevealController reveals, re-hides, replaces, clears, and formats all login & card secrets on demand", async () => {
  const guard = createSessionGuard();
  guard.unlock();

  const calls = [];
  const invoke = async (cmd, args) => {
    calls.push({ cmd, args });
    if (cmd === "get_account_password") {
      return args.accountId === "card-1" ? "4111222233334444" : "DummyPass#99";
    }
    if (cmd === "get_account_recovery_key") {
      return args.accountId === "card-1" ? "847" : "REC-KEY-ALPHA-123";
    }
    if (cmd === "get_account_pin") {
      return "9051";
    }
    throw new Error(`Unexpected command ${cmd}`);
  };

  let latest = null;
  const ctrl = new EditSecretRevealController((next) => {
    latest = next;
  });

  // 1-4: Open Edit on saved Login account -> zero preloaded secrets -> reveal on click
  ctrl.setTarget("svc-login", "acc-1");
  assert.equal(calls.length, 0, "Opening Edit must never preload secrets");
  assert.equal(latest.password.revealed, false);
  assert.equal(latest.recoveryKey.revealedStoredValue, null);

  await ctrl.toggle(
    {
      field: "password",
      serviceId: "svc-login",
      accountId: "acc-1",
      hasExistingSecret: true,
      hasDraftValue: false,
    },
    guard,
    invoke
  );
  assert.equal(latest.password.revealed, true);
  assert.equal(latest.password.revealedStoredValue, "DummyPass#99");

  await ctrl.toggle(
    {
      field: "recoveryKey",
      serviceId: "svc-login",
      accountId: "acc-1",
      hasExistingSecret: true,
      hasDraftValue: false,
    },
    guard,
    invoke
  );
  assert.equal(latest.recoveryKey.revealed, true);
  assert.equal(latest.recoveryKey.revealedStoredValue, "REC-KEY-ALPHA-123");

  // Save payload with untouched blank drafts MUST keep stored values and never send revealed secrets or bullets
  const untouchedPayload = buildUpdateAccountPayload(
    "svc-login",
    "acc-1",
    "login",
    {
      label: "Main",
      username: "user1",
      email: "",
      password: "",
      recoveryKey: "",
      url: "",
      notes: "",
      clearRecoveryKey: false,
    },
    { label: "", holder: "", number: "", expiry: "", cvv: "", pin: "", notes: "" }
  );
  assert.equal(untouchedPayload.password, null);
  assert.equal(untouchedPayload.recoveryKey, null);

  // 5: Hide both clears revealed values immediately
  await ctrl.toggle(
    {
      field: "password",
      serviceId: "svc-login",
      accountId: "acc-1",
      hasExistingSecret: true,
      hasDraftValue: false,
    },
    guard,
    invoke
  );
  await ctrl.toggle(
    {
      field: "recoveryKey",
      serviceId: "svc-login",
      accountId: "acc-1",
      hasExistingSecret: true,
      hasDraftValue: false,
    },
    guard,
    invoke
  );
  assert.equal(latest.password.revealedStoredValue, null);
  assert.equal(latest.recoveryKey.revealedStoredValue, null);

  // 6: Replacement draft clears temporary preview; erasing draft back to empty resets to hidden
  ctrl.onDraftChanged("recoveryKey", "REC-KEY-NEW-777", true);
  assert.equal(latest.recoveryKey.revealedStoredValue, null);
  ctrl.onDraftChanged("recoveryKey", "", true);
  assert.equal(latest.recoveryKey.revealed, false);

  // 8-9: Marked for removal blocks reveal cleanly
  await ctrl.toggle(
    {
      field: "recoveryKey",
      serviceId: "svc-login",
      accountId: "acc-1",
      hasExistingSecret: true,
      hasDraftValue: false,
      markedForRemoval: true,
    },
    guard,
    invoke
  );
  assert.equal(latest.recoveryKey.revealed, false);
  assert.equal(latest.recoveryKey.revealedStoredValue, null);

  // 11: Bank card number, CVV, and PIN explicit on-demand reveal
  ctrl.setTarget("svc-bank", "card-1");
  await ctrl.toggle(
    { field: "cardNumber", serviceId: "svc-bank", accountId: "card-1", hasExistingSecret: true, hasDraftValue: false },
    guard,
    invoke
  );
  await ctrl.toggle(
    { field: "cardCvv", serviceId: "svc-bank", accountId: "card-1", hasExistingSecret: true, hasDraftValue: false },
    guard,
    invoke
  );
  await ctrl.toggle(
    { field: "cardPin", serviceId: "svc-bank", accountId: "card-1", hasExistingSecret: true, hasDraftValue: false },
    guard,
    invoke
  );
  assert.equal(formatStoredSecretForEditDisplay("cardNumber", "4111222233334444"), "4111 2222 3333 4444");
  assert.equal(latest.cardNumber.revealedStoredValue, "4111 2222 3333 4444");
  assert.equal(latest.cardCvv.revealedStoredValue, "847");
  assert.equal(latest.cardPin.revealedStoredValue, "9051");

  // Vault Emergency Recovery Key remains masked until revealed cleanly
  assert.equal(getVisibleRecoveryKeyText(createHiddenRecoveryKeyState()), "KN-••••-••••-••••-••••");
  const vaultRec = await revealVaultRecoveryKey(guard, async () => "KN-TEST-1234-5678-9012");
  assert.equal(getVisibleRecoveryKeyText(vaultRec), "KN-TEST-1234-5678-9012");
});

test("EditSecretRevealController rejects stale responses on account switch, dialog close, draft edit, and vault lock", async () => {
  const guard = createSessionGuard();
  guard.unlock();

  let resolveAccountA;
  const invoke = async () =>
    new Promise((resolve) => {
      resolveAccountA = resolve;
    });

  let latest = null;
  const ctrl = new EditSecretRevealController((next) => {
    latest = next;
  });

  // Case A: Switching accounts while recovery key fetch is in flight
  ctrl.setTarget("svc-1", "acc-A");
  const pendingSwitch = ctrl.toggle(
    { field: "recoveryKey", serviceId: "svc-1", accountId: "acc-A", hasExistingSecret: true, hasDraftValue: false },
    guard,
    invoke
  );
  ctrl.setTarget("svc-1", "acc-B");
  resolveAccountA("SECRET-FROM-A");
  const switchRes = await pendingSwitch;
  assert.equal(switchRes.stale, true);
  assert.equal(latest.recoveryKey.revealedStoredValue, null);
  assert.equal(latest.recoveryKey.revealed, false);

  // Case B: Closing modal during in-flight card CVV fetch
  ctrl.setTarget("svc-1", "card-1");
  const pendingClose = ctrl.toggle(
    { field: "cardCvv", serviceId: "svc-1", accountId: "card-1", hasExistingSecret: true, hasDraftValue: false },
    guard,
    invoke
  );
  ctrl.setTarget(null, null);
  resolveAccountA("999");
  const closeRes = await pendingClose;
  assert.equal(closeRes.stale, true);
  assert.equal(latest.cardCvv.revealedStoredValue, null);

  // Case C: Locking vault while PIN fetch is in flight
  ctrl.setTarget("svc-1", "card-1");
  const pendingLock = ctrl.toggle(
    { field: "cardPin", serviceId: "svc-1", accountId: "card-1", hasExistingSecret: true, hasDraftValue: false },
    guard,
    invoke
  );
  guard.lock();
  ctrl.hideAll();
  resolveAccountA("1234");
  const lockRes = await pendingLock;
  assert.equal(lockRes.stale, true);
  assert.equal(latest.cardPin.revealedStoredValue, null);

  // Case D: Typing replacement draft cancels in-flight password reveal
  guard.unlock();
  ctrl.setTarget("svc-1", "acc-1");
  const pendingDraft = ctrl.toggle(
    { field: "password", serviceId: "svc-1", accountId: "acc-1", hasExistingSecret: true, hasDraftValue: false },
    guard,
    invoke
  );
  ctrl.onDraftChanged("password", "NewTypedPass", true);
  resolveAccountA("OldSecretFromServer");
  const draftRes = await pendingDraft;
  assert.equal(draftRes.stale, true);
  assert.equal(latest.password.revealedStoredValue, null);
});

test("Ctrl+A / Cmd+A prevents native page selection in dialogs/cards while keeping editable input selection intact", () => {
  const openDialogCtx = {
    unlocked: true,
    selectionMode: true,
    selectedCount: 1,
    hasOpenDialog: true,
    target: { tagName: "BUTTON" },
  };
  assert.equal(shouldHandleSelectAllShortcut({ key: "a", ctrlKey: true }, openDialogCtx), false);
  assert.equal(shouldPreventNativeSelectAll({ key: "a", ctrlKey: true }, openDialogCtx.target), true);
  assert.equal(shouldPreventNativeSelectAll({ key: "ش", code: "KeyA", metaKey: true }, { tagName: "DIV" }), true);

  // Editable targets NEVER trigger native prevention or service selection
  for (const editableTarget of [
    { tagName: "INPUT" },
    { tagName: "TEXTAREA" },
    { tagName: "DIV", isContentEditable: true },
    { tagName: "SPAN", getAttribute: (n) => (n === "role" ? "textbox" : null) },
  ]) {
    assert.equal(
      shouldPreventNativeSelectAll({ key: "a", ctrlKey: true }, editableTarget),
      false
    );
    assert.equal(
      shouldHandleSelectAllShortcut(
        { key: "a", ctrlKey: true },
        { ...openDialogCtx, hasOpenDialog: false, target: editableTarget }
      ),
      false
    );
  }

  // Non-editable selection range is cleared, whereas input-anchored selection is preserved
  let removed = false;
  const mockDocPage = {
    activeElement: { tagName: "BUTTON" },
    defaultView: {
      getSelection: () => ({
        rangeCount: 1,
        anchorNode: { nodeType: 1, tagName: "P" },
        focusNode: { nodeType: 1, tagName: "H2" },
        removeAllRanges: () => {
          removed = true;
        },
      }),
    },
  };
  assert.equal(clearNonEditableDocumentSelection(mockDocPage), true);
  assert.equal(removed, true);

  let clearedContentEditable = false;
  const mockDocEditable = {
    activeElement: { tagName: "DIV", isContentEditable: true },
    defaultView: {
      getSelection: () => ({
        rangeCount: 1,
        anchorNode: { nodeType: 1, tagName: "DIV", isContentEditable: true },
        focusNode: { nodeType: 1, tagName: "DIV", isContentEditable: true },
        removeAllRanges: () => {
          clearedContentEditable = true;
        },
      }),
    },
  };
  assert.equal(clearNonEditableDocumentSelection(mockDocEditable), false);
  assert.equal(clearedContentEditable, false);
});

test("TimedNotificationController handles auto-dismiss durations, manual close, timer reset, stale tokens, and persistent errors", () => {
  const timers = createFakeTimers();
  const ctrl = new TimedNotificationController(timers.api);
  const history = [];
  const unsubscribe = ctrl.subscribe((v) => history.push(v ? `${v.type}:${v.message}` : null));

  // Success auto-dismisses at 4000ms
  ctrl.show({ type: "success", message: "تم الحفظ" });
  timers.advanceBy(NOTIFICATION_DURATIONS_MS.success - 1);
  assert.equal(ctrl.snapshot?.message, "تم الحفظ");
  timers.advanceBy(1);
  assert.equal(ctrl.snapshot, null);

  // Warning auto-dismisses at 6000ms
  ctrl.show({ type: "warning", message: "تنبيه" });
  timers.advanceBy(NOTIFICATION_DURATIONS_MS.warning - 1);
  assert.equal(ctrl.snapshot?.message, "تنبيه");
  timers.advanceBy(1);
  assert.equal(ctrl.snapshot, null);

  // Error toast auto-dismisses at 8000ms
  ctrl.show({ type: "error", message: "خطأ مؤقت" });
  timers.advanceBy(NOTIFICATION_DURATIONS_MS.error - 1);
  assert.equal(ctrl.snapshot?.message, "خطأ مؤقت");
  timers.advanceBy(1);
  assert.equal(ctrl.snapshot, null);

  // Rapid replacement resets timer and stale ID cannot dismiss newer toast
  const firstId = ctrl.show({ type: "success", message: "First" });
  timers.advanceBy(3000);
  const secondId = ctrl.show({ type: "warning", message: "Second" });
  assert.equal(ctrl.dismiss(firstId), false, "Stale notification ID must never dismiss newer notification");
  timers.advanceBy(2000); // 5000ms total since first, 2000ms since second (< 6000ms)
  assert.equal(ctrl.snapshot?.id, secondId);
  timers.advanceBy(4000);
  assert.equal(ctrl.snapshot, null);

  // Manual dismissal clears active timer immediately
  ctrl.show({ type: "error", message: "Manual close test" });
  assert.equal(timers.pendingCount(), 1);
  ctrl.dismiss();
  assert.equal(ctrl.snapshot, null);
  assert.equal(timers.pendingCount(), 0);

  // Actionable persistent errors (durationMs: null) do not auto-dismiss
  ctrl.show({ type: "error", message: "Export failed" }, { durationMs: null });
  timers.advanceBy(60000);
  assert.equal(ctrl.snapshot?.message, "Export failed");
  ctrl.dispose();
  assert.equal(timers.pendingCount(), 0);
  unsubscribe();
});

test("App.tsx wires Edit secret reveals across all fields, blur/navigation clearing, and notification controller cleanly", () => {
  const appSrc = fs.readFileSync(path.join(uiRoot, "src/App.tsx"), "utf8");
  const fieldsSrc = fs.readFileSync(path.join(uiRoot, "src/components/AccountFormFields.tsx"), "utf8");

  assert.ok(appSrc.includes("EditSecretRevealController"));
  assert.ok(appSrc.includes("useTimedNotification"));
  assert.ok(appSrc.includes("shouldPreventNativeSelectAll"));
  assert.ok(appSrc.includes("clearNonEditableDocumentSelection"));
  assert.ok(appSrc.includes("clearDetailRevealedSecrets"));
  assert.ok(!appSrc.includes("setCardCvv(acc.recovery_key"));
  assert.ok(!appSrc.includes("setEditRecoveryKey(acc.recovery_key"));
  assert.ok(!appSrc.includes("setCardPin(extractCardPin"));

  assert.ok(fieldsSrc.includes("revealedStoredRecoveryKey"));
  assert.ok(fieldsSrc.includes("revealedStoredCardNumber"));
  assert.ok(fieldsSrc.includes("revealedStoredCardCvv"));
  assert.ok(fieldsSrc.includes("revealedStoredCardPin"));
});
