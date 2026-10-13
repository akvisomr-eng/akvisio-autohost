-- Enforce tenant ownership at the database boundary, not only in API predicates.
-- Apply to development/staging first. This migration does not alter production automatically.
BEGIN;

CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_org_id_pair ON customers (organization_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_vehicles_org_id_pair ON vehicles (organization_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_bookings_org_id_pair ON bookings (organization_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_invoices_org_id_pair ON invoices (organization_id, id);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bookings_customer_same_organization' AND conrelid = 'bookings'::regclass) THEN
    ALTER TABLE bookings ADD CONSTRAINT bookings_customer_same_organization
      FOREIGN KEY (organization_id, customer_id) REFERENCES customers (organization_id, id) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bookings_vehicle_same_organization' AND conrelid = 'bookings'::regclass) THEN
    ALTER TABLE bookings ADD CONSTRAINT bookings_vehicle_same_organization
      FOREIGN KEY (organization_id, vehicle_id) REFERENCES vehicles (organization_id, id) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'invoices_booking_same_organization' AND conrelid = 'invoices'::regclass) THEN
    ALTER TABLE invoices ADD CONSTRAINT invoices_booking_same_organization
      FOREIGN KEY (organization_id, booking_id) REFERENCES bookings (organization_id, id) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payments_booking_same_organization' AND conrelid = 'payments'::regclass) THEN
    ALTER TABLE payments ADD CONSTRAINT payments_booking_same_organization
      FOREIGN KEY (organization_id, booking_id) REFERENCES bookings (organization_id, id) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payments_invoice_same_organization' AND conrelid = 'payments'::regclass) THEN
    ALTER TABLE payments ADD CONSTRAINT payments_invoice_same_organization
      FOREIGN KEY (organization_id, invoice_id) REFERENCES invoices (organization_id, id) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'expenses_vehicle_same_organization' AND conrelid = 'expenses'::regclass) THEN
    ALTER TABLE expenses ADD CONSTRAINT expenses_vehicle_same_organization
      FOREIGN KEY (organization_id, vehicle_id) REFERENCES vehicles (organization_id, id) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'expenses_booking_same_organization' AND conrelid = 'expenses'::regclass) THEN
    ALTER TABLE expenses ADD CONSTRAINT expenses_booking_same_organization
      FOREIGN KEY (organization_id, booking_id) REFERENCES bookings (organization_id, id) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'maintenance_vehicle_same_organization' AND conrelid = 'vehicle_maintenance'::regclass) THEN
    ALTER TABLE vehicle_maintenance ADD CONSTRAINT maintenance_vehicle_same_organization
      FOREIGN KEY (organization_id, vehicle_id) REFERENCES vehicles (organization_id, id) NOT VALID;
  END IF;
END $$;

ALTER TABLE bookings VALIDATE CONSTRAINT bookings_customer_same_organization;
ALTER TABLE bookings VALIDATE CONSTRAINT bookings_vehicle_same_organization;
ALTER TABLE invoices VALIDATE CONSTRAINT invoices_booking_same_organization;
ALTER TABLE payments VALIDATE CONSTRAINT payments_booking_same_organization;
ALTER TABLE payments VALIDATE CONSTRAINT payments_invoice_same_organization;
ALTER TABLE expenses VALIDATE CONSTRAINT expenses_vehicle_same_organization;
ALTER TABLE expenses VALIDATE CONSTRAINT expenses_booking_same_organization;
ALTER TABLE vehicle_maintenance VALIDATE CONSTRAINT maintenance_vehicle_same_organization;

COMMIT;
