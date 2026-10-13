-- Admin authentication foundation. Apply only to the development branch first.
BEGIN;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS password_hash text,
  ADD COLUMN IF NOT EXISTS last_login_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_users_org_active
  ON users(organization_id, is_active);

COMMIT;
