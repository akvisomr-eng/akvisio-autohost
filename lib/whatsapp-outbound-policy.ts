export type WhatsAppOutboundPolicyInput = {
  enabled?: string;
  mode?: string;
  now?: number;
  recipient?: string;
  phoneNumberId?: string;
  configuredPhoneNumberId?: string;
  productionActivated?: string;
  trialStartsAt?: string;
  trialEndsAt?: string;
  trialAllowedRecipients?: string;
  trialPhoneNumberId?: string;
};

export type WhatsAppOutboundPolicyResult = {
  allowed: boolean;
  code: string;
  reason: string;
};

const deny = (code: string, reason: string): WhatsAppOutboundPolicyResult => ({
  allowed: false,
  code,
  reason,
});

const digitsOnly = (value: string): string => value.replace(/\\D/g, "");

const isE164 = (value: string): boolean => /^\\+[1-9]\\d{7,14}$/.test(value);

const parseTimestamp = (value?: string): number => {
  if (!value || !/(?:Z|[+-]\\d{2}:\\d{2})$/.test(value)) return NaN;
  return Date.parse(value);
};

/**
 * Fail-closed policy for outbound WhatsApp. It deliberately requires separate,
 * explicit configuration for a time-boxed test trial versus paid production.
 */
export function evaluateWhatsAppOutboundPolicy(
  input: WhatsAppOutboundPolicyInput,
): WhatsAppOutboundPolicyResult {
  if (input.enabled !== "true") {
    return deny("WHATSAPP_OUTBOUND_DISABLED", "Pengiriman WhatsApp dinonaktifkan.");
  }

  const now = input.now ?? Date.now();
  const phoneNumberId = input.phoneNumberId?.trim() ?? "";
  const configuredPhoneNumberId = input.configuredPhoneNumberId?.trim() ?? "";
  const recipient = input.recipient ? digitsOnly(input.recipient) : "";

  if (!phoneNumberId) {
    return deny("WHATSAPP_PHONE_NUMBER_UNMAPPED", "Nomor WhatsApp Meta belum dipetakan.");
  }

  if (input.mode === "trial") {
    const startsAt = parseTimestamp(input.trialStartsAt);
    const endsAt = parseTimestamp(input.trialEndsAt);
    const maxTrialMs = 72 * 60 * 60 * 1000;

    if (!Number.isFinite(startsAt) || !Number.isFinite(endsAt) || endsAt <= startsAt ||
        endsAt - startsAt > maxTrialMs) {
      return deny("WHATSAPP_TRIAL_CONFIG_INVALID", "Konfigurasi waktu trial tidak valid atau melebihi 72 jam.");
    }
    if (now < startsAt || now >= endsAt) {
      return deny("WHATSAPP_TRIAL_EXPIRED", "Trial WhatsApp belum dimulai atau sudah berakhir.");
    }
    if (!input.trialPhoneNumberId?.trim() || input.trialPhoneNumberId.trim() !== phoneNumberId) {
      return deny("WHATSAPP_TRIAL_NUMBER_MISMATCH", "Nomor WhatsApp tidak cocok dengan nomor uji yang disetujui.");
    }

    const rawAllowlist = input.trialAllowedRecipients?.split(",").map((item) => item.trim()) ?? [];
    if (rawAllowlist.length === 0 || rawAllowlist.some((item) => !isE164(item))) {
      return deny("WHATSAPP_TRIAL_ALLOWLIST_INVALID", "Daftar penerima uji tidak ada atau formatnya tidak valid.");
    }
    const allowedRecipients = new Set(rawAllowlist.map(digitsOnly));
    if (!recipient || !allowedRecipients.has(recipient)) {
      return deny("WHATSAPP_TRIAL_RECIPIENT_BLOCKED", "Penerima tidak ada dalam daftar nomor uji yang disetujui.");
    }
    return { allowed: true, code: "WHATSAPP_TRIAL_ALLOWED", reason: "Penerima uji diizinkan dalam periode trial." };
  }

  if (input.mode === "production") {
    if (input.productionActivated !== "true") {
      return deny("WHATSAPP_PRODUCTION_NOT_ACTIVATED", "Aktivasi produksi belum disetujui secara eksplisit.");
    }
    if (!configuredPhoneNumberId || configuredPhoneNumberId !== phoneNumberId) {
      return deny("WHATSAPP_PRODUCTION_NUMBER_MISMATCH", "Nomor Meta tidak cocok dengan konfigurasi produksi yang disetujui.");
    }
    return { allowed: true, code: "WHATSAPP_PRODUCTION_ALLOWED", reason: "Aktivasi produksi terkonfirmasi." };
  }

  return deny("WHATSAPP_OUTBOUND_MODE_INVALID", "Mode pengiriman tidak disetel secara eksplisit ke trial atau production.");
}
