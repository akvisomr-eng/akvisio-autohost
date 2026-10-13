import { isSafeAiHostBaseUrl } from "./ai-host-url.mjs";

export type HealthComponentStatus = "ok" | "not_configured" | "disabled" | "error";

export type HealthChecks = {
  application: "ok";
  core_configuration: HealthComponentStatus;
  database: "ok" | "not_configured" | "error";
  whatsapp_webhook: HealthComponentStatus;
  whatsapp_processor: HealthComponentStatus;
  whatsapp_outbound: HealthComponentStatus;
  ai_draft: HealthComponentStatus;
};

/** Core secrets and the public origin must be valid before the app can be called ready. */
function coreConfigurationStatus(env: Record<string, string | undefined>): HealthComponentStatus {
  const strongSecret = (value: string | undefined) => Boolean(value && value.length >= 32);
  if (!strongSecret(env.SESSION_SECRET) || !strongSecret(env.BOOTSTRAP_SECRET)
    || !strongSecret(env.PLATFORM_SESSION_SECRET) || !strongSecret(env.PLATFORM_BOOTSTRAP_SECRET)) {
    return "not_configured";
  }
  try {
    const base = new URL(env.APP_BASE_URL || "");
    if (base.username || base.password || base.search || base.hash) return "not_configured";
    const localHttp = env.NODE_ENV !== "production" && base.protocol === "http:"
      && ["localhost", "127.0.0.1", "[::1]"].includes(base.hostname);
    if (base.protocol !== "https:" && !localHttp) return "not_configured";
    return "ok";
  } catch {
    return "not_configured";
  }
}

/** Reports capabilities using the actual server-side environment variable names. */
export function buildHealthChecks(env: Record<string, string | undefined>, database: HealthChecks["database"]): HealthChecks {
  const whatsappWebhook: HealthComponentStatus = env.WHATSAPP_VERIFY_TOKEN && env.WHATSAPP_APP_SECRET
    ? "ok" : "not_configured";
  const whatsappProcessor: HealthComponentStatus = env.WHATSAPP_PROCESSOR_SECRET ? "ok" : "not_configured";

  let whatsappOutbound: HealthComponentStatus = "disabled";
  if (env.WHATSAPP_OUTBOUND_ENABLED === "true") {
    const commonConfigured = Boolean(env.WHATSAPP_ACCESS_TOKEN && env.WHATSAPP_PHONE_NUMBER_ID && env.WHATSAPP_GRAPH_API_VERSION);
    if (!commonConfigured || !env.WHATSAPP_OUTBOUND_MODE) {
      whatsappOutbound = "not_configured";
    } else if (env.WHATSAPP_OUTBOUND_MODE === "production") {
      whatsappOutbound = env.WHATSAPP_PRODUCTION_ACTIVATED === "true" ? "ok" : "not_configured";
    } else if (env.WHATSAPP_OUTBOUND_MODE === "trial") {
      whatsappOutbound = env.WHATSAPP_TRIAL_PHONE_NUMBER_ID && env.WHATSAPP_TRIAL_STARTS_AT
        && env.WHATSAPP_TRIAL_ENDS_AT && env.WHATSAPP_TRIAL_ALLOWED_RECIPIENTS ? "ok" : "not_configured";
    } else {
      whatsappOutbound = "not_configured";
    }
  }

  let aiDraft: HealthComponentStatus = "disabled";
  if (env.AI_HOST_ENABLED === "true") {
    aiDraft = env.AI_HOST_API_KEY && env.AI_HOST_MODEL && isSafeAiHostBaseUrl(env.AI_HOST_BASE_URL)
      ? "ok" : "not_configured";
  }

  return {
    application: "ok",
    core_configuration: coreConfigurationStatus(env),
    database,
    whatsapp_webhook: whatsappWebhook,
    whatsapp_processor: whatsappProcessor,
    whatsapp_outbound: whatsappOutbound,
    ai_draft: aiDraft,
  };
}

/** Core readiness requires the database and valid session/bootstrap secrets plus public origin. */
export function isApplicationReady(checks: HealthChecks): boolean {
  return checks.database === "ok" && checks.core_configuration === "ok";
}
