-- Platform-admin lockout fields; tenant-user authentication remains separate.
BEGIN;
ALTER TABLE platform_admins
  ADD COLUMN IF NOT EXISTS failed_login_count integer NOT NULL DEFAULT 0 CHECK (failed_login_count >= 0),
  ADD COLUMN IF NOT EXISTS locked_until timestamptz;
COMMIT;
