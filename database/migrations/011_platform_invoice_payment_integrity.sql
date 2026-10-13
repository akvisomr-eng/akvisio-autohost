-- Invoice period uniqueness and payment-entry idempotency.
BEGIN;
CREATE UNIQUE INDEX IF NOT EXISTS idx_platform_invoice_activation_unique
  ON platform_invoices (organization_id, subscription_id)
  WHERE invoice_type = 'activation' AND subscription_id IS NOT NULL AND status <> 'void';
CREATE UNIQUE INDEX IF NOT EXISTS idx_platform_invoice_period_unique
  ON platform_invoices (organization_id, subscription_id, invoice_type, period_start, period_end)
  WHERE subscription_id IS NOT NULL
    AND period_start IS NOT NULL
    AND period_end IS NOT NULL
    AND invoice_type IN ('subscription','commission')
    AND status <> 'void';
ALTER TABLE platform_payments
  ADD COLUMN IF NOT EXISTS idempotency_key text;
CREATE UNIQUE INDEX IF NOT EXISTS idx_platform_payments_org_idempotency
  ON platform_payments (organization_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
COMMIT;
