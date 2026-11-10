import assert from "node:assert/strict";
import test from "node:test";

import {
  buildAddAccountPayload,
  buildUpdateAccountPayload,
  extractCardPin,
  extractCleanCardNotes,
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

  assert.equal(addCard.label, "بطاقة بنكية");
  assert.equal(addCard.password, "4111111111111111");
  assert.equal(addCard.notes, "[CARD]\nPIN: 4321\nATM card");

  assert.equal(extractCardPin(addCard.notes), "4321");
  assert.equal(extractCleanCardNotes(addCard.notes), "ATM card");
});
