import test from "node:test";
import assert from "node:assert/strict";
import { buildHealthChecks, isApplicationReady } from "../lib/health-checks.ts";

test("core readiness depends on database, not optional AI or WhatsApp integrations", () => {
  const checks = buildHealthChecks({
    SESSION_SECRET: "s".repeat(40), BOOTSTRAP_SECRET: "b".repeat(40),
    PLATFORM_SESSION_SECRET: "p".repeat(40), PLATFORM_BOOTSTRAP_SECRET: "q".repeat(40),
    APP_BASE_URL: "http://localhost:3000", NODE_ENV: "test",
  }, "ok");
  assert.equal(isApplicationReady(checks), true);
  assert.equal(checks.core_configuration, "ok");
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


test("health does not mark private or malformed AI provider URLs ready", () => {
  for (const url of ["https://localhost/v1", "https://127.0.0.1/v1", "http://provider.example/v1"]) {
    const checks = buildHealthChecks({
      AI_HOST_ENABLED: "true",
      AI_HOST_API_KEY: "secret",
      AI_HOST_BASE_URL: url,
      AI_HOST_MODEL: "model-a",
    }, "ok");
    assert.equal(checks.ai_draft, "not_configured", url);
  }
});

 
test("health rejects all literal IPv6 endpoints and documentation IPv4 ranges", () => {
  for (const url of [
    "https://[::1]/v1",
    "https://[fd00::1]/v1",
    "https://192.0.2.10/v1",
    "https://198.51.100.20/v1",
    "https://203.0.113.20/v1",
  ]) {
    const checks = buildHealthChecks({
      AI_HOST_ENABLED: "true",
      AI_HOST_API_KEY: "secret",
      AI_HOST_BASE_URL: url,
      AI_HOST_MODEL: "model-a",
    }, "ok");
    assert.equal(checks.ai_draft, "not_configured", url);
  }
});


test("core readiness fails closed when session/bootstrap secrets are weak or missing", () => {
  const base = {
    SESSION_SECRET: "s".repeat(40), BOOTSTRAP_SECRET: "b".repeat(40),
    PLATFORM_SESSION_SECRET: "p".repeat(40), PLATFORM_BOOTSTRAP_SECRET: "q".repeat(40),
    APP_BASE_URL: "https://autohost.example.com", NODE_ENV: "production",
  };
  assert.equal(isApplicationReady(buildHealthChecks(base, "ok")), true);
  assert.equal(isApplicationReady(buildHealthChecks({ ...base, SESSION_SECRET: "short" }, "ok")), false);
  assert.equal(isApplicationReady(buildHealthChecks({ ...base, PLATFORM_BOOTSTRAP_SECRET: undefined }, "ok")), false);
  assert.equal(isApplicationReady(buildHealthChecks({ ...base, APP_BASE_URL: "http://autohost.example.com" }, "ok")), false);
  assert.equal(isApplicationReady(buildHealthChecks({ ...base, APP_BASE_URL: "https://user:pass@autohost.example.com" }, "ok")), false);
});

test("local HTTP origin is allowed only outside production", () => {
  const env = {
    SESSION_SECRET: "s".repeat(40), BOOTSTRAP_SECRET: "b".repeat(40),
    PLATFORM_SESSION_SECRET: "p".repeat(40), PLATFORM_BOOTSTRAP_SECRET: "q".repeat(40),
    APP_BASE_URL: "http://localhost:3000",
  };
  assert.equal(buildHealthChecks({ ...env, NODE_ENV: "development" }, "ok").core_configuration, "ok");
  assert.equal(buildHealthChecks({ ...env, NODE_ENV: "production" }, "ok").core_configuration, "not_configured");
});
