-- Seed the current approved AKVISIO AutoHost subscription prices.
-- Existing tenant subscriptions keep their snapshotted fees; only the catalogue is updated.
BEGIN;

INSERT INTO subscription_plans
  (code, name, description, activation_fee, monthly_fee, commission_rate_bps,
   commission_cap_amount, max_vehicles, max_users, monthly_conversation_limit,
   included_ai_tokens, is_active)
VALUES
  ('starter', 'Starter',
   'Biaya bulanan dasar. Kuota AI, kanal WhatsApp, batas pengguna, dan batas pemakaian dikonfirmasi tertulis sebelum aktivasi; biaya provider pihak ketiga terpisah.',
   3500000, 475000, 0, NULL, NULL, NULL, NULL, 0, true),
  ('business', 'Business',
   'Paket usaha berkembang. Kuota AI, kanal WhatsApp, batas pengguna, dan batas pemakaian dikonfirmasi tertulis sebelum aktivasi; biaya provider pihak ketiga terpisah.',
   3500000, 895000, 0, NULL, NULL, NULL, NULL, 0, true),
  ('pro', 'Pro',
   'Paket operasional lanjutan. Kuota AI, kanal WhatsApp, batas pengguna, dan batas pemakaian dikonfirmasi tertulis sebelum aktivasi; biaya provider pihak ketiga terpisah.',
   3500000, 1595000, 0, NULL, NULL, NULL, NULL, 0, true)
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  activation_fee = EXCLUDED.activation_fee,
  monthly_fee = EXCLUDED.monthly_fee,
  updated_at = now();

COMMIT;
