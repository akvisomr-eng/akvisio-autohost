import test from "node:test";
import assert from "node:assert/strict";
import { buildHealthChecks, isApplicationReady } from "../lib/health-checks.ts";

test("core readiness depends on database, not optional AI or WhatsApp integrations", () => {
  const checks = buildHealthChecks({}, "ok");
  assert.equal(isApplicationReady(checks), true);
  assert.equal(checks.ai_draft, "disabled");
  assert.equal(checks.whatsapp_outbound, "disabled");
});

test("health reports actual AI Host environment variables", () => {
  const checks = buildHealthChecks({
    AI_HOST_ENABLED: "true",
    AI_HOST_API_KEY: "secret",
    AI_HOST_BASE_URL: "https://provider.example/v1",
    AI_HOST_MODEL: "model-a",
  }, "ok");
  assert.equal(checks.ai_draft, "ok");
  assert.equal(buildHealthChecks({ AI_API_KEY: "legacy", AI_PROVIDER: "legacy" }, "ok").ai_draft, "disabled");
});

test("WhatsApp outbound stays disabled by default and production needs explicit activation", () => {
  assert.equal(buildHealthChecks({ WHATSAPP_ACCESS_TOKEN: "token", WHATSAPP_PHONE_NUMBER_ID: "phone" }, "ok").whatsapp_outbound, "disabled");
  const enabledButNotActivated = buildHealthChecks({
    WHATSAPP_OUTBOUND_ENABLED: "true",
    WHATSAPP_OUTBOUND_MODE: "production",
    WHATSAPP_ACCESS_TOKEN: "token",
    WHATSAPP_PHONE_NUMBER_ID: "phone",
    WHATSAPP_GRAPH_API_VERSION: "vXX.X",
  }, "ok");
  assert.equal(enabledButNotActivated.whatsapp_outbound, "not_configured");
});

test("health reports webhook and processor readiness independently", () => {
  const checks = buildHealthChecks({
    WHATSAPP_VERIFY_TOKEN: "verify",
    WHATSAPP_APP_SECRET: "app-secret",
    WHATSAPP_PROCESSOR_SECRET: "processor-secret",
  }, "ok");
  assert.equal(checks.whatsapp_webhook, "ok");
  assert.equal(checks.whatsapp_processor, "ok");
});

test("database failure prevents readiness", () => {
  assert.equal(isApplicationReady(buildHealthChecks({}, "error")), false);
  assert.equal(isApplicationReady(buildHealthChecks({}, "not_configured")), false);
});
