-- SaaS billing foundation for AKVISIO Autohost.
-- Additive only: apply to an isolated development branch first. No production migration is performed here.
BEGIN;

CREATE TABLE IF NOT EXISTS platform_admins (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  full_name text NOT NULL,
  password_hash text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  last_login_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_platform_admins_email_lower ON platform_admins (lower(email));

CREATE TABLE IF NOT EXISTS subscription_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  activation_fee numeric(14,2) NOT NULL DEFAULT 0 CHECK (activation_fee >= 0),
  monthly_fee numeric(14,2) NOT NULL DEFAULT 0 CHECK (monthly_fee >= 0),
  commission_rate_bps integer NOT NULL DEFAULT 0 CHECK (commission_rate_bps BETWEEN 0 AND 10000),
  commission_cap_amount numeric(14,2) CHECK (commission_cap_amount >= 0),
  max_vehicles integer CHECK (max_vehicles > 0),
  max_users integer CHECK (max_users > 0),
  monthly_conversation_limit integer CHECK (monthly_conversation_limit > 0),
  included_ai_tokens bigint NOT NULL DEFAULT 0 CHECK (included_ai_tokens >= 0),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tenant_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  plan_id uuid NOT NULL REFERENCES subscription_plans(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'pending_activation'
    CHECK (status IN ('pending_activation','trialing','active','past_due','suspended','cancelled','expired')),
  billing_cycle text NOT NULL DEFAULT 'monthly' CHECK (billing_cycle IN ('monthly','yearly')),
  activation_fee_amount numeric(14,2) NOT NULL DEFAULT 0 CHECK (activation_fee_amount >= 0),
  activation_status text NOT NULL DEFAULT 'due' CHECK (activation_status IN ('due','paid','waived')),
  monthly_fee_amount numeric(14,2) NOT NULL DEFAULT 0 CHECK (monthly_fee_amount >= 0),
  commission_rate_bps integer NOT NULL DEFAULT 0 CHECK (commission_rate_bps BETWEEN 0 AND 10000),
  commission_cap_amount numeric(14,2) CHECK (commission_cap_amount >= 0),
  started_at timestamptz,
  current_period_start timestamptz,
  current_period_end timestamptz,
  next_billing_at timestamptz,
  trial_ends_at timestamptz,
  grace_until timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  CHECK (current_period_end IS NULL OR current_period_start IS NULL OR current_period_end > current_period_start)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_tenant_subscriptions_one_current
  ON tenant_subscriptions (organization_id)
  WHERE status IN ('pending_activation','trialing','active','past_due','suspended');
CREATE INDEX IF NOT EXISTS idx_tenant_subscriptions_due
  ON tenant_subscriptions (status, next_billing_at);

CREATE TABLE IF NOT EXISTS platform_invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  subscription_id uuid,
  invoice_number text NOT NULL UNIQUE,
  invoice_type text NOT NULL CHECK (invoice_type IN ('activation','subscription','commission','adjustment')),
  period_start date,
  period_end date,
  currency char(3) NOT NULL DEFAULT 'IDR',
  subtotal_amount numeric(14,2) NOT NULL CHECK (subtotal_amount >= 0),
  tax_amount numeric(14,2) NOT NULL DEFAULT 0 CHECK (tax_amount >= 0),
  total_amount numeric(14,2) NOT NULL CHECK (total_amount >= 0 AND total_amount = subtotal_amount + tax_amount),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','issued','partially_paid','paid','void','overdue')),
  due_at timestamptz,
  issued_at timestamptz,
  idempotency_key text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, idempotency_key),
  CHECK (period_end IS NULL OR period_start IS NULL OR period_end >= period_start),
  FOREIGN KEY (organization_id, subscription_id)
    REFERENCES tenant_subscriptions (organization_id, id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS idx_platform_invoices_org_status_due
  ON platform_invoices (organization_id, status, due_at);

CREATE TABLE IF NOT EXISTS platform_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  platform_invoice_id uuid NOT NULL,
  provider text NOT NULL DEFAULT 'manual',
  provider_reference text,
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','verified','rejected','refunded')),
  received_at timestamptz NOT NULL DEFAULT now(),
  verified_at timestamptz,
  verified_by_platform_admin_id uuid REFERENCES platform_admins(id) ON DELETE RESTRICT,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, platform_invoice_id)
    REFERENCES platform_invoices (organization_id, id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_platform_payments_provider_reference
  ON platform_payments (provider, provider_reference) WHERE provider_reference IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_platform_payments_org_status
  ON platform_payments (organization_id, status, received_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_org_id_pair ON payments (organization_id, id);

CREATE TABLE IF NOT EXISTS commission_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  subscription_id uuid NOT NULL,
  source_payment_id uuid NOT NULL,
  source_booking_id uuid,
  platform_invoice_id uuid,
  source_payment_type text NOT NULL CHECK (source_payment_type IN ('rental','extra_charge')),
  gross_amount numeric(14,2) NOT NULL CHECK (gross_amount >= 0),
  commissionable_amount numeric(14,2) NOT NULL CHECK (commissionable_amount >= 0 AND commissionable_amount <= gross_amount),
  commission_rate_bps integer NOT NULL CHECK (commission_rate_bps BETWEEN 0 AND 10000),
  commission_amount numeric(14,2) NOT NULL CHECK (commission_amount >= 0),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','invoiced','void')),
  earned_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, source_payment_id),
  FOREIGN KEY (organization_id, subscription_id)
    REFERENCES tenant_subscriptions (organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, source_payment_id)
    REFERENCES payments (organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, source_booking_id)
    REFERENCES bookings (organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, platform_invoice_id)
    REFERENCES platform_invoices (organization_id, id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS idx_commission_entries_org_status_date
  ON commission_entries (organization_id, status, earned_at);


CREATE OR REPLACE FUNCTION validate_commission_source_payment() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  source_payment payments%ROWTYPE;
BEGIN
  SELECT * INTO source_payment
  FROM payments
  WHERE organization_id = NEW.organization_id AND id = NEW.source_payment_id
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Commission source payment not found for tenant' USING ERRCODE = '23503';
  END IF;
  IF source_payment.status <> 'verified' THEN
    RAISE EXCEPTION 'Commission can only be recorded from verified receipts' USING ERRCODE = '23514';
  END IF;
  IF source_payment.payment_type NOT IN ('rental','extra_charge')
     OR source_payment.payment_type <> NEW.source_payment_type THEN
    RAISE EXCEPTION 'Deposits and refunds are not commissionable' USING ERRCODE = '23514';
  END IF;
  IF NEW.source_booking_id IS NOT NULL AND source_payment.booking_id IS DISTINCT FROM NEW.source_booking_id THEN
    RAISE EXCEPTION 'Commission booking does not match source payment' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_validate_commission_source_payment ON commission_entries;
CREATE TRIGGER trg_validate_commission_source_payment
BEFORE INSERT OR UPDATE OF organization_id, source_payment_id, source_booking_id, source_payment_type
ON commission_entries
FOR EACH ROW EXECUTE FUNCTION validate_commission_source_payment();

CREATE TABLE IF NOT EXISTS tenant_usage_monthly (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  period_start date NOT NULL CHECK (EXTRACT(DAY FROM period_start) = 1),
  inbound_messages bigint NOT NULL DEFAULT 0 CHECK (inbound_messages >= 0),
  outbound_messages bigint NOT NULL DEFAULT 0 CHECK (outbound_messages >= 0),
  ai_runs bigint NOT NULL DEFAULT 0 CHECK (ai_runs >= 0),
  ai_input_tokens bigint NOT NULL DEFAULT 0 CHECK (ai_input_tokens >= 0),
  ai_output_tokens bigint NOT NULL DEFAULT 0 CHECK (ai_output_tokens >= 0),
  estimated_ai_cost numeric(14,6) NOT NULL DEFAULT 0 CHECK (estimated_ai_cost >= 0),
  bookings_created bigint NOT NULL DEFAULT 0 CHECK (bookings_created >= 0),
  commissionable_revenue numeric(14,2) NOT NULL DEFAULT 0 CHECK (commissionable_revenue >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, period_start)
);

CREATE TABLE IF NOT EXISTS platform_audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  platform_admin_id uuid REFERENCES platform_admins(id) ON DELETE SET NULL,
  actor_type text NOT NULL CHECK (actor_type IN ('platform_admin','system')),
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_platform_audit_created ON platform_audit_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_platform_audit_entity ON platform_audit_logs (entity_type, entity_id, created_at DESC);

COMMIT;
