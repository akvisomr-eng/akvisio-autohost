-- Enforce tenant consistency for booking references at the database boundary.
-- Additive migration; apply to development first and verify before production promotion.
BEGIN;

CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_org_id_pair
  ON customers (organization_id, id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_vehicles_org_id_pair
  ON vehicles (organization_id, id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'bookings_customer_same_organization'
      AND conrelid = 'bookings'::regclass
  ) THEN
    ALTER TABLE bookings
      ADD CONSTRAINT bookings_customer_same_organization
      FOREIGN KEY (organization_id, customer_id)
      REFERENCES customers (organization_id, id)
      NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'bookings_vehicle_same_organization'
      AND conrelid = 'bookings'::regclass
  ) THEN
    ALTER TABLE bookings
      ADD CONSTRAINT bookings_vehicle_same_organization
      FOREIGN KEY (organization_id, vehicle_id)
      REFERENCES vehicles (organization_id, id)
      NOT VALID;
  END IF;
END $$;

ALTER TABLE bookings VALIDATE CONSTRAINT bookings_customer_same_organization;
ALTER TABLE bookings VALIDATE CONSTRAINT bookings_vehicle_same_organization;

COMMIT;
