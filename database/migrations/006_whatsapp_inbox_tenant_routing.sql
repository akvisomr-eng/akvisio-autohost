-- WhatsApp tenant routing and composite tenant integrity.
-- Apply to development first; configure the Meta phone_number_id separately.
BEGIN;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS whatsapp_phone_number_id text;
CREATE UNIQUE INDEX IF NOT EXISTS idx_organizations_whatsapp_phone_number_id
  ON organizations (whatsapp_phone_number_id) WHERE whatsapp_phone_number_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_org_id_pair ON customers (organization_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_conversations_org_id_pair ON conversations (organization_id, id);
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'conversations_customer_same_organization' AND conrelid = 'conversations'::regclass) THEN
    ALTER TABLE conversations ADD CONSTRAINT conversations_customer_same_organization
      FOREIGN KEY (organization_id, customer_id) REFERENCES customers (organization_id, id) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'messages_conversation_same_organization' AND conrelid = 'messages'::regclass) THEN
    ALTER TABLE messages ADD CONSTRAINT messages_conversation_same_organization
      FOREIGN KEY (organization_id, conversation_id) REFERENCES conversations (organization_id, id) NOT VALID;
  END IF;
END $$;
ALTER TABLE conversations VALIDATE CONSTRAINT conversations_customer_same_organization;
ALTER TABLE messages VALIDATE CONSTRAINT messages_conversation_same_organization;
CREATE INDEX IF NOT EXISTS idx_conversations_customer_recent ON conversations (organization_id, customer_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_org_provider_message ON messages (organization_id, provider_message_id);
COMMIT;
