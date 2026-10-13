-- Outbound reply retries must not create duplicate WhatsApp sends.
-- Apply this migration to development/staging before deploying the reply endpoint.
BEGIN;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS client_request_id text;
CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_org_client_request
  ON messages (organization_id, client_request_id)
  WHERE client_request_id IS NOT NULL;
COMMIT;
