-- Safety and AI foundations added after the initial schema.
BEGIN;

CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS hold_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS idempotency_key text;

CREATE UNIQUE INDEX IF NOT EXISTS idx_bookings_org_idempotency
  ON bookings(organization_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'bookings_no_overlapping_vehicle_time'
      AND conrelid = 'bookings'::regclass
  ) THEN
    ALTER TABLE bookings
      ADD CONSTRAINT bookings_no_overlapping_vehicle_time
      EXCLUDE USING gist (
        vehicle_id WITH =,
        tstzrange(pickup_at, return_at, '[)') WITH &&
      )
      WHERE (status IN ('pending','held','confirmed','ongoing'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS knowledge_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  title text NOT NULL,
  category text NOT NULL DEFAULT 'faq',
  content text NOT NULL,
  source_reference text,
  is_published boolean NOT NULL DEFAULT false,
  reviewed_by uuid REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ai_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  conversation_id uuid REFERENCES conversations(id) ON DELETE RESTRICT,
  provider text,
  model text,
  intent text,
  status text NOT NULL DEFAULT 'completed' CHECK (status IN ('queued','running','completed','failed','blocked','escalated')),
  input_tokens integer CHECK (input_tokens >= 0),
  output_tokens integer CHECK (output_tokens >= 0),
  estimated_cost numeric(14,6) CHECK (estimated_cost >= 0),
  tool_actions jsonb NOT NULL DEFAULT '[]'::jsonb,
  safety_flags jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS follow_ups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  conversation_id uuid REFERENCES conversations(id) ON DELETE RESTRICT,
  booking_id uuid REFERENCES bookings(id) ON DELETE RESTRICT,
  due_at timestamptz NOT NULL,
  channel text NOT NULL DEFAULT 'whatsapp' CHECK (channel IN ('whatsapp','phone','email','internal')),
  message_template text,
  status text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','processing','sent','cancelled','failed')),
  consent_required boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_knowledge_published ON knowledge_documents(organization_id, is_published, category);
CREATE INDEX IF NOT EXISTS idx_ai_runs_org_created ON ai_runs(organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_follow_ups_due ON follow_ups(status, due_at);

COMMIT;
