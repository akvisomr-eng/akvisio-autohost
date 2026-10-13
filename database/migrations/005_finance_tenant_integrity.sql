-- Finance ledger integrity: enforce organization boundaries at the database layer.
-- Apply to development first; do not apply to production until reviewed and verified.
BEGIN;

CREATE UNIQUE INDEX IF NOT EXISTS idx_bookings_org_id_pair
  ON bookings (organization_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_invoices_org_id_pair
  ON invoices (organization_id, id);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'invoices_booking_same_organization' AND conrelid = 'invoices'::regclass) THEN
    ALTER TABLE invoices ADD CONSTRAINT invoices_booking_same_organization
      FOREIGN KEY (organization_id, booking_id)
      REFERENCES bookings (organization_id, id) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payments_booking_same_organization' AND conrelid = 'payments'::regclass) THEN
    ALTER TABLE payments ADD CONSTRAINT payments_booking_same_organization
      FOREIGN KEY (organization_id, booking_id)
      REFERENCES bookings (organization_id, id) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payments_invoice_same_organization' AND conrelid = 'payments'::regclass) THEN
    ALTER TABLE payments ADD CONSTRAINT payments_invoice_same_organization
      FOREIGN KEY (organization_id, invoice_id)
      REFERENCES invoices (organization_id, id) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'expenses_vehicle_same_organization' AND conrelid = 'expenses'::regclass) THEN
    ALTER TABLE expenses ADD CONSTRAINT expenses_vehicle_same_organization
      FOREIGN KEY (organization_id, vehicle_id)
      REFERENCES vehicles (organization_id, id) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'expenses_booking_same_organization' AND conrelid = 'expenses'::regclass) THEN
    ALTER TABLE expenses ADD CONSTRAINT expenses_booking_same_organization
      FOREIGN KEY (organization_id, booking_id)
      REFERENCES bookings (organization_id, id) NOT VALID;
  END IF;
END $$;

ALTER TABLE invoices VALIDATE CONSTRAINT invoices_booking_same_organization;
ALTER TABLE payments VALIDATE CONSTRAINT payments_booking_same_organization;
ALTER TABLE payments VALIDATE CONSTRAINT payments_invoice_same_organization;
ALTER TABLE expenses VALIDATE CONSTRAINT expenses_vehicle_same_organization;
ALTER TABLE expenses VALIDATE CONSTRAINT expenses_booking_same_organization;

CREATE INDEX IF NOT EXISTS idx_expenses_org_spent_at ON expenses (organization_id, spent_at DESC);
CREATE INDEX IF NOT EXISTS idx_invoices_org_status ON invoices (organization_id, status, created_at DESC);

COMMIT;
