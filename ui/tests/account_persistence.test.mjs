import assert from "node:assert/strict";
import test from "node:test";

import {
  buildAddAccountPayload,
  buildUpdateAccountPayload,
  extractCardPin,
  extractCleanCardNotes,
  isBankOrCardService,
  resolveAccountKind,
} from "../src/accountForm.ts";

test("buildUpdateAccountPayload clears optional non-secret login fields with empty strings instead of null", () => {
  const payload = buildUpdateAccountPayload(
    "svc-1",
    "acc-1",
    "login",
    {
      label: "   ",
      username: "",
      email: "  ",
      password: "",
      recoveryKey: "",
      url: "",
      notes: "   ",
      clearRecoveryKey: false,
    },
    {
      label: "",
      holder: "",
      number: "",
      expiry: "",
      cvv: "",
      pin: "",
      notes: "",
    }
  );

  assert.equal(payload.label, "");
  assert.equal(payload.username, "");
  assert.equal(payload.email, "");
  assert.equal(payload.url, "");
  assert.equal(payload.notes, "");
  assert.equal(payload.password, null, "Blank edit password must remain null so existing secret stays intact");
  assert.equal(payload.recoveryKey, null, "Blank recovery key without explicit clear must keep existing secret");
  assert.equal(payload.clearRecoveryKey, false);
});

test("buildUpdateAccountPayload preserves generated password and explicit secret clearing semantics", () => {
  const generatedPwd = "X9k#mP2qLz@8wR4vN1tB";
  const payload = buildUpdateAccountPayload(
    "svc-1",
    "acc-2",
    "login",
    {
      label: "Updated Label",
      username: "user1",
      email: "",
      password: generatedPwd,
      recoveryKey: "",
      url: "https://example.com",
      notes: "",
      clearRecoveryKey: true,
    },
    {
      label: "",
      holder: "",
      number: "",
      expiry: "",
      cvv: "",
      pin: "",
      notes: "",
    }
  );

  assert.equal(payload.password, generatedPwd);
  assert.equal(payload.label, "Updated Label");
  assert.equal(payload.email, "");
  assert.equal(payload.notes, "");
  assert.equal(payload.recoveryKey, "");
  assert.equal(payload.clearRecoveryKey, true);
});

test("buildUpdateAccountPayload clears optional card fields while preserving card secrets when left blank", () => {
  const payload = buildUpdateAccountPayload(
    "svc-bank",
    "card-1",
    "card",
    {
      label: "",
      username: "",
      email: "",
      password: "",
      recoveryKey: "",
      url: "",
      notes: "",
    },
    {
      label: "",
      holder: "   ",
      number: "",
      expiry: "",
      cvv: "",
      pin: "",
      notes: "",
      clearRecoveryKey: false,
      clearPin: false,
    }
  );

  assert.equal(payload.label, "", "Clearing card label on edit must persist empty string instead of reverting");
  assert.equal(payload.username, "");
  assert.equal(payload.url, "");
  assert.equal(payload.notes, "[CARD]");
  assert.equal(payload.password, null);
  assert.equal(payload.recoveryKey, null);
  assert.equal(payload.clearRecoveryKey, false);
  assert.equal(payload.clearPin, false);
});

test("buildAddAccountPayload keeps creation defaults without breaking edit clearing", () => {
  const addCard = buildAddAccountPayload(
    "svc-bank",
    "card",
    {
      label: "",
      username: "",
      email: "",
      password: "",
      recoveryKey: "",
      url: "",
      notes: "",
    },
    {
      label: "",
      holder: "MOHAMMED",
      number: "4111 1111 1111 1111",
      expiry: "08/29",
      cvv: "123",
      pin: "4321",
      notes: "ATM card",
    }
  );

  assert.equal(addCard.accountKind, "card");
  assert.equal(addCard.label, "بطاقة بنكية");
  assert.equal(addCard.password, "4111111111111111");
  assert.equal(addCard.notes, "[CARD]\nPIN: 4321\nATM card");

  assert.equal(extractCardPin(addCard.notes), "4321");
  assert.equal(extractCleanCardNotes(addCard.notes), "ATM card");
});

test("resolveAccountKind honors explicit account_kind in bank and non-bank services and handles legacy records", () => {
  assert.equal(isBankOrCardService("Al Rajhi Bank"), true);
  assert.equal(isBankOrCardService("GitLab"), false);

  // Explicit login inside a banking service MUST stay login
  const bankLoginPayload = buildAddAccountPayload(
    "svc-rajhi",
    "login",
    {
      label: "Al Mubasher Online",
      username: "user_rajhi",
      email: "user@example.com",
      password: "BankLogin#1234",
      recoveryKey: "",
      url: "https://almubasher.com.sa",
      notes: "Login account inside Al Rajhi Bank",
    },
    {
      label: "",
      holder: "",
      number: "",
      expiry: "",
      cvv: "",
      pin: "",
      notes: "",
    }
  );
  assert.equal(bankLoginPayload.accountKind, "login");
  assert.equal(
    resolveAccountKind({
      account_kind: "login",
      notes: bankLoginPayload.notes,
      url: bankLoginPayload.url,
    }),
    "login"
  );

  // Explicit bank card inside Al Rajhi Bank and inside a generic service stay card
  assert.equal(
    resolveAccountKind({ account_kind: "card", notes: "[CARD]", url: "08/29" }),
    "card"
  );
  assert.equal(
    resolveAccountKind({ account_kind: "card", notes: null, url: null }),
    "card"
  );

  // Legacy records without explicit account_kind fallback cleanly without using service name
  assert.equal(
    resolveAccountKind({ notes: "[CARD]\nPIN: 1234", url: "05/28" }),
    "card"
  );
  assert.equal(
    resolveAccountKind({ notes: null, url: "12/29" }),
    "card"
  );
  assert.equal(
    resolveAccountKind({ notes: null, url: "https://alrajhibank.com.sa" }),
    "login"
  );
});
