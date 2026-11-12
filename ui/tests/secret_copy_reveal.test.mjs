import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { EditSecretRevealController } from "../src/editSecretReveal.ts";
import {
  canCopySecretField,
  executeSecretCopy,
  resolveSecretCopyAction,
} from "../src/secretCopy.ts";
import { createSessionGuard } from "../src/session.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uiRoot = path.resolve(__dirname, "..");

test("resolveSecretCopyAction distinguishes missing, draft, pending-removal, and stored secrets across all 5 field types", async () => {
  const cases = [
    {
      field: "password",
      expectedStoredCmd: "copy_password",
      draft: "DraftPass!23",
      expectedDraftText: "DraftPass!23",
    },
    {
      field: "recoveryKey",
      expectedStoredCmd: "copy_account_recovery_key",
      draft: " REC-NEW-777 ",
      expectedDraftText: "REC-NEW-777",
    },
    {
      field: "cardNumber",
      expectedStoredCmd: "copy_password",
      draft: "4111 2222 3333 4444",
      expectedDraftText: "4111222233334444",
    },
    {
      field: "cardCvv",
      expectedStoredCmd: "copy_account_recovery_key",
      draft: " 912 ",
      expectedDraftText: "912",
    },
    {
      field: "cardPin",
      expectedStoredCmd: "copy_account_pin",
      draft: " 2468 ",
      expectedDraftText: "2468",
    },
  ];

  for (const item of cases) {
    // 1. Add form with empty input -> not copyable
    assert.equal(
      canCopySecretField({
        field: item.field,
        isEdit: false,
        draftValue: "",
      }),
      false,
      `${item.field} must not be copyable when empty in Add mode`
    );

    // 2. Add form with draft -> copies draft directly via copy_secure_text
    assert.deepEqual(
      resolveSecretCopyAction({
        field: item.field,
        isEdit: false,
        draftValue: item.draft,
      }),
      {
        copyable: true,
        source: "draft",
        command: "copy_secure_text",
        args: { text: item.expectedDraftText },
      }
    );

    // 3. Edit form with untouched stored secret -> copies directly via backend without fetching plaintext
    assert.deepEqual(
      resolveSecretCopyAction({
        field: item.field,
        isEdit: true,
        serviceId: "svc-1",
        accountId: "acc-1",
        hasExistingSecret: true,
        draftValue: "",
      }),
      {
        copyable: true,
        source: "stored",
        command: item.expectedStoredCmd,
        args: { serviceId: "svc-1", accountId: "acc-1" },
      }
    );

    // 4. Edit form with replacement draft -> copies draft rather than old stored secret
    assert.deepEqual(
      resolveSecretCopyAction({
        field: item.field,
        isEdit: true,
        serviceId: "svc-1",
        accountId: "acc-1",
        hasExistingSecret: true,
        draftValue: item.draft,
      }),
      {
        copyable: true,
        source: "draft",
        command: "copy_secure_text",
        args: { text: item.expectedDraftText },
      }
    );

    // 5. Edit form with missing secret -> not copyable
    assert.equal(
      canCopySecretField({
        field: item.field,
        isEdit: true,
        serviceId: "svc-1",
        accountId: "acc-1",
        hasExistingSecret: false,
        draftValue: "",
      }),
      false,
      `${item.field} must not be copyable when missing in Edit mode`
    );

    // 6. Edit form marked for removal -> not copyable even if stored secret exists
    assert.equal(
      canCopySecretField({
        field: item.field,
        isEdit: true,
        serviceId: "svc-1",
        accountId: "acc-1",
        hasExistingSecret: true,
        draftValue: "",
        markedForRemoval: true,
      }),
      false,
      `${item.field} must not be copyable when pending removal`
    );
  }
});

test("Copy and Eye controls stay strictly independent in Edit forms without preloading plaintext", async () => {
  const guard = createSessionGuard();
  guard.unlock();

  const calls = [];
  const invoke = async (cmd, args) => {
    calls.push({ cmd, args });
    if (cmd === "get_account_password") return "4111222233334444";
    if (cmd === "get_account_recovery_key") return "847";
    if (cmd === "get_account_pin") return "9051";
    return undefined;
  };

  let state = null;
  const ctrl = new EditSecretRevealController((next) => {
    state = next;
  });
  ctrl.setTarget("svc-bank", "card-1");

  // Copy stored CVV while masked: must copy directly via backend, never fetch plaintext, never reveal
  const hiddenCopy = await executeSecretCopy(
    {
      field: "cardCvv",
      isEdit: true,
      serviceId: "svc-bank",
      accountId: "card-1",
      hasExistingSecret: true,
      draftValue: "",
    },
    invoke
  );
  assert.deepEqual(hiddenCopy, {
    copied: true,
    source: "stored",
    command: "copy_account_recovery_key",
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].cmd, "copy_account_recovery_key");
  assert.equal(state.cardCvv.revealed, false);
  assert.equal(state.cardCvv.revealedStoredValue, null);

  // Reveal via Eye: must fetch only display value and never invoke any copy_* command
  await ctrl.toggle(
    {
      field: "cardCvv",
      serviceId: "svc-bank",
      accountId: "card-1",
      hasExistingSecret: true,
      hasDraftValue: false,
      markedForRemoval: false,
    },
    guard,
    invoke
  );
  assert.equal(state.cardCvv.revealed, true);
  assert.equal(state.cardCvv.revealedStoredValue, "847");
  assert.equal(
    calls.filter((entry) => entry.cmd.startsWith("copy_")).length,
    1,
    "Revealing with Eye must never trigger a clipboard copy"
  );

  // Copy while revealed: must keep revealed state untouched
  await executeSecretCopy(
    {
      field: "cardPin",
      isEdit: true,
      serviceId: "svc-bank",
      accountId: "card-1",
      hasExistingSecret: true,
      draftValue: "",
    },
    invoke
  );
  assert.equal(state.cardCvv.revealed, true);
  assert.equal(state.cardPin.revealed, false);
  assert.equal(calls.at(-1).cmd, "copy_account_pin");

  // Copy missing secret: must return missing and issue zero backend calls
  const callCountBeforeMissing = calls.length;
  const missingCopy = await executeSecretCopy(
    {
      field: "recoveryKey",
      isEdit: true,
      serviceId: "svc-bank",
      accountId: "card-1",
      hasExistingSecret: false,
      draftValue: "",
    },
    invoke
  );
  assert.deepEqual(missingCopy, { copied: false, reason: "missing" });
  assert.equal(calls.length, callCountBeforeMissing);
});

test("SecretInput, AccountFormFields, and Details View maintain consistent Copy & Eye wiring with zero Master Password copy", () => {
  const secretInputSrc = fs.readFileSync(
    path.join(uiRoot, "src/components/ui/secret-input.tsx"),
    "utf8"
  );
  const accountFormSrc = fs.readFileSync(
    path.join(uiRoot, "src/components/AccountFormFields.tsx"),
    "utf8"
  );
  const appSrc = fs.readFileSync(path.join(uiRoot, "src/App.tsx"), "utf8");

  // SecretInput only renders Copy button when onCopy is explicitly provided
  assert.match(secretInputSrc, /const showCopyButton = typeof onCopy === "function"/);
  assert.match(secretInputSrc, /\{showCopyButton && \(/);

  // AccountFormFields wires Copy controls onto all 5 account/card secret fields
  for (const propName of [
    "onCopyPassword",
    "onCopyRecoveryKey",
    "onCopyCardNumber",
    "onCopyCardCvv",
    "onCopyCardPin",
  ]) {
    assert.ok(
      accountFormSrc.includes(propName),
      `AccountFormFields must wire ${propName}`
    );
  }

  // Master password / unlock / setup SecretInputs must never pass onCopy
  const onCopyMatches = appSrc.match(/\bonCopy\s*=/g) ?? [];
  assert.equal(
    onCopyMatches.length,
    0,
    "Master password and modal standalone SecretInput controls in App.tsx must not receive onCopy"
  );

  // Card Number Detail View must gate Eye & Copy on acc.has_password so missing card numbers show no Copy action
  assert.match(
    appSrc,
    /!acc\.has_password\s*\?\s*"—"\s*:\s*revealedAccountPasswords\[acc\.id\]/
  );
  assert.match(
    appSrc,
    /\{acc\.has_password && \(\s*<div className="flex items-center gap-2 shrink-0">/
  );

  // Add & Edit AccountFormFields invocations pass all 5 formCopyHandler bindings (Add + Edit = 10 calls)
  const formCopyMatches = appSrc.match(/formCopyHandler\(/g) ?? [];
  assert.equal(formCopyMatches.length, 10);
});
