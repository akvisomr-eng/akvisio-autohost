import test from "node:test";
import assert from "node:assert/strict";
import { evaluateWhatsAppOutboundPolicy } from "../lib/whatsapp-outbound-policy.ts";

const now = Date.parse("2026-10-13T12:00:00.000Z");
const trial = {
  enabled: "true",
  mode: "trial",
  now,
  recipient: "+6281234567890",
  phoneNumberId: "test-phone-id",
  trialPhoneNumberId: "test-phone-id",
  trialStartsAt: "2026-10-13T11:00:00.000Z",
  trialEndsAt: "2026-10-13T14:00:00.000Z",
  trialAllowedRecipients: "+6281234567890",
};

test("blocks outbound by default", () => {
  assert.equal(evaluateWhatsAppOutboundPolicy({ ...trial, enabled: "false" }).code, "WHATSAPP_OUTBOUND_DISABLED");
});

test("allows only an approved recipient during a valid trial", () => {
  assert.equal(evaluateWhatsAppOutboundPolicy(trial).allowed, true);
});

test("blocks recipients outside the trial allowlist", () => {
  const result = evaluateWhatsAppOutboundPolicy({ ...trial, recipient: "+6281111111111" });
  assert.equal(result.code, "WHATSAPP_TRIAL_RECIPIENT_BLOCKED");
});

test("blocks expired trials", () => {
  const result = evaluateWhatsAppOutboundPolicy({ ...trial, now: Date.parse("2026-10-13T14:00:00.000Z") });
  assert.equal(result.code, "WHATSAPP_TRIAL_EXPIRED");
});

test("blocks trial configuration longer than 72 hours", () => {
  const result = evaluateWhatsAppOutboundPolicy({
    ...trial,
    trialEndsAt: "2026-10-16T12:00:01.000Z",
  });
  assert.equal(result.code, "WHATSAPP_TRIAL_CONFIG_INVALID");
});

test("blocks a Meta phone-number ID different from the approved test number", () => {
  const result = evaluateWhatsAppOutboundPolicy({ ...trial, phoneNumberId: "customer-production-number" });
  assert.equal(result.code, "WHATSAPP_TRIAL_NUMBER_MISMATCH");
});

test("blocks malformed or missing recipient allowlists", () => {
  assert.equal(evaluateWhatsAppOutboundPolicy({ ...trial, trialAllowedRecipients: "" }).code, "WHATSAPP_TRIAL_ALLOWLIST_INVALID");
  assert.equal(evaluateWhatsAppOutboundPolicy({ ...trial, trialAllowedRecipients: "081234567890" }).code, "WHATSAPP_TRIAL_ALLOWLIST_INVALID");
});

test("production requires explicit activation and the approved phone-number ID", () => {
  const production = {
    enabled: "true",
    mode: "production",
    now,
    recipient: "+6281234567890",
    phoneNumberId: "paid-production-id",
    configuredPhoneNumberId: "paid-production-id",
  };
  assert.equal(evaluateWhatsAppOutboundPolicy(production).code, "WHATSAPP_PRODUCTION_NOT_ACTIVATED");
  assert.equal(evaluateWhatsAppOutboundPolicy({ ...production, productionActivated: "true" }).allowed, true);
  assert.equal(evaluateWhatsAppOutboundPolicy({
    ...production,
    productionActivated: "true",
    configuredPhoneNumberId: "different-id",
  }).code, "WHATSAPP_PRODUCTION_NUMBER_MISMATCH");
});
