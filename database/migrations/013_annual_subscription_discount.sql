-- Explicit 10% discount line for annual subscription invoices.
BEGIN;
ALTER TABLE platform_invoices
  ADD COLUMN IF NOT EXISTS discount_amount numeric(14,2) NOT NULL DEFAULT 0
  CHECK (discount_amount >= 0);
ALTER TABLE platform_invoices DROP CONSTRAINT IF EXISTS platform_invoices_check;
ALTER TABLE platform_invoices
  ADD CONSTRAINT platform_invoices_total_after_discount_check
  CHECK (total_amount >= 0 AND discount_amount <= subtotal_amount
    AND total_amount = subtotal_amount - discount_amount + tax_amount);
COMMIT;