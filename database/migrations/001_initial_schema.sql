-- Sans Rent Cars CRM: additive initial schema for PostgreSQL / Neon.
-- Apply first to the Neon development branch. Never store credentials or identity documents in plain text.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  whatsapp_business_number text,
  default_locale text NOT NULL DEFAULT 'id-ID',
  timezone text NOT NULL DEFAULT 'Asia/Jakarta',
  currency char(3) NOT NULL DEFAULT 'IDR',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  email text NOT NULL,
  full_name text NOT NULL,
  role text NOT NULL DEFAULT 'staff' CHECK (role IN ('owner','admin','manager','staff','finance','dispatcher','viewer')),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, email)
);

CREATE TABLE IF NOT EXISTS customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  full_name text,
  whatsapp_number text NOT NULL,
  email text,
  preferred_locale text NOT NULL DEFAULT 'id-ID',
  consent_marketing_at timestamptz,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, whatsapp_number)
);

CREATE TABLE IF NOT EXISTS conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  channel text NOT NULL DEFAULT 'whatsapp' CHECK (channel IN ('whatsapp','web','phone','manual')),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','pending_human','resolved','archived')),
  assigned_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  last_message_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE RESTRICT,
  provider_message_id text,
  direction text NOT NULL CHECK (direction IN ('inbound','outbound')),
  sender_type text NOT NULL CHECK (sender_type IN ('customer','ai','staff','system')),
  body text NOT NULL,
  delivery_status text NOT NULL DEFAULT 'received' CHECK (delivery_status IN ('received','queued','sent','delivered','read','failed')),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, provider_message_id)
);

CREATE TABLE IF NOT EXISTS vehicles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  registration_number text NOT NULL,
  make text NOT NULL,
  model text NOT NULL,
  model_year integer,
  transmission text CHECK (transmission IN ('automatic','manual','other')),
  seats integer CHECK (seats > 0),
  service_mode text NOT NULL DEFAULT 'both' CHECK (service_mode IN ('self_drive','chauffeur','both')),
  status text NOT NULL DEFAULT 'available' CHECK (status IN ('available','maintenance','inactive')),
  daily_rate numeric(14,2) NOT NULL DEFAULT 0 CHECK (daily_rate >= 0),
  overtime_rate numeric(14,2) NOT NULL DEFAULT 0 CHECK (overtime_rate >= 0),
  odometer_km integer NOT NULL DEFAULT 0 CHECK (odometer_km >= 0),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, registration_number)
);

CREATE TABLE IF NOT EXISTS bookings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  booking_code text NOT NULL,
  customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  vehicle_id uuid NOT NULL REFERENCES vehicles(id) ON DELETE RESTRICT,
  service_mode text NOT NULL CHECK (service_mode IN ('self_drive','chauffeur')),
  pickup_at timestamptz NOT NULL,
  return_at timestamptz NOT NULL,
  pickup_location text,
  return_location text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','held','confirmed','ongoing','completed','cancelled','rejected','expired')),
  daily_rate numeric(14,2) NOT NULL CHECK (daily_rate >= 0),
  estimated_total numeric(14,2) NOT NULL CHECK (estimated_total >= 0),
  deposit_amount numeric(14,2) NOT NULL DEFAULT 0 CHECK (deposit_amount >= 0),
  payment_status text NOT NULL DEFAULT 'unpaid' CHECK (payment_status IN ('unpaid','partial','paid','refunded','review_required')),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, booking_code),
  CHECK (return_at > pickup_at)
);

CREATE TABLE IF NOT EXISTS invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  booking_id uuid REFERENCES bookings(id) ON DELETE RESTRICT,
  invoice_number text NOT NULL,
  amount numeric(14,2) NOT NULL CHECK (amount >= 0),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','issued','partially_paid','paid','void','overdue')),
  due_at timestamptz,
  issued_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, invoice_number)
);

CREATE TABLE IF NOT EXISTS payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  booking_id uuid REFERENCES bookings(id) ON DELETE RESTRICT,
  invoice_id uuid REFERENCES invoices(id) ON DELETE RESTRICT,
  provider text NOT NULL DEFAULT 'manual',
  provider_reference text,
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  payment_type text NOT NULL DEFAULT 'rental' CHECK (payment_type IN ('rental','deposit','refund','extra_charge')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','verified','rejected','refunded')),
  verified_by uuid REFERENCES users(id) ON DELETE SET NULL,
  verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS expenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  vehicle_id uuid REFERENCES vehicles(id) ON DELETE RESTRICT,
  booking_id uuid REFERENCES bookings(id) ON DELETE RESTRICT,
  category text NOT NULL,
  description text NOT NULL,
  amount numeric(14,2) NOT NULL CHECK (amount >= 0),
  spent_at date NOT NULL DEFAULT current_date,
  recorded_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS vehicle_maintenance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  vehicle_id uuid NOT NULL REFERENCES vehicles(id) ON DELETE RESTRICT,
  maintenance_type text NOT NULL,
  due_at date,
  due_odometer_km integer CHECK (due_odometer_km >= 0),
  status text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','in_progress','completed','cancelled')),
  cost numeric(14,2) CHECK (cost >= 0),
  notes text,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS webhook_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL,
  provider_event_id text NOT NULL,
  event_type text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  processing_status text NOT NULL DEFAULT 'pending' CHECK (processing_status IN ('pending','processing','processed','failed','ignored')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  last_error text,
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  UNIQUE (provider, provider_event_id)
);

CREATE TABLE IF NOT EXISTS addon_catalog (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  implementation_price numeric(14,2) NOT NULL DEFAULT 0 CHECK (implementation_price >= 0),
  monthly_price numeric(14,2) NOT NULL DEFAULT 0 CHECK (monthly_price >= 0),
  is_available boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS organization_addons (
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  addon_id uuid NOT NULL REFERENCES addon_catalog(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'inactive' CHECK (status IN ('inactive','pending','active','suspended','cancelled')),
  activated_at timestamptz,
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (organization_id, addon_id)
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id bigserial PRIMARY KEY,
  organization_id uuid REFERENCES organizations(id) ON DELETE RESTRICT,
  actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  actor_type text NOT NULL CHECK (actor_type IN ('user','ai','system','webhook')),
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id text,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_customers_org_created ON customers(organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_conversations_org_status ON conversations(organization_id, status, last_message_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_conversation_created ON messages(conversation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_vehicles_org_status ON vehicles(organization_id, status);
CREATE INDEX IF NOT EXISTS idx_bookings_vehicle_dates ON bookings(vehicle_id, pickup_at, return_at);
CREATE INDEX IF NOT EXISTS idx_bookings_org_status_pickup ON bookings(organization_id, status, pickup_at);
CREATE INDEX IF NOT EXISTS idx_payments_org_status ON payments(organization_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_webhook_events_status_received ON webhook_events(processing_status, received_at);

INSERT INTO organizations (name, slug, whatsapp_business_number)
VALUES ('Sans Rent Cars', 'sans-rent-cars', '+6281586878487')
ON CONFLICT (slug) DO NOTHING;

INSERT INTO addon_catalog (code, name, description, implementation_price, monthly_price) VALUES
('ai-sales-pro','AI Sales Pro','Kualifikasi prospek dan tindak lanjut cerdas',1500000,150000),
('ai-multilingual','AI Multibahasa','Layanan percakapan multi-bahasa',1000000,100000),
('marketing-automation','Marketing Automation','Segmentasi dan kampanye sesuai persetujuan',1500000,150000),
('loyalty-referral','Loyalty & Referral','Poin, voucher, dan referral pelanggan',1750000,100000),
('review-reputation','Review & Reputation','Permintaan ulasan dan ringkasan umpan balik',750000,75000),
('website-booking','Website Booking','Katalog kendaraan dan permintaan reservasi online',3000000,150000),
('fleet-maintenance-pro','Fleet Maintenance Pro','Jadwal servis, kilometer, dan biaya perawatan',1500000,100000),
('digital-handover','Digital Handover','Checklist serah terima dan foto kondisi kendaraan',1750000,100000),
('driver-dispatch','Driver & Dispatch','Penjadwalan sopir dan penugasan perjalanan',2000000,125000),
('gps-fleet-tracking','GPS & Fleet Tracking','Integrasi penyedia GPS yang kompatibel',2500000,150000),
('dynamic-pricing','Dynamic Pricing','Aturan tarif berbasis waktu dan permintaan',2000000,125000),
('multi-branch','Multi-Branch','Pengelolaan cabang dan laporan per lokasi',3000000,200000),
('rental-partner-network','Rental Partner Network','Armada mitra, komisi, dan rekonsiliasi',3500000,200000),
('accounting-pro','Accounting Pro','Jurnal, buku besar, piutang, dan utang',2500000,150000),
('payment-gateway','Payment Gateway','Integrasi pembayaran online',1500000,100000),
('e-contract-document-ai','E-Contract & Document AI','Draft kontrak dan pengelolaan dokumen',2000000,125000),
('claims-insurance','Claims & Insurance','Pencatatan kerusakan dan klaim',1500000,100000),
('ai-business-intelligence','AI Business Intelligence','Analitik utilisasi armada dan profitabilitas',2500000,200000),
('ai-system-guardian-pro','AI System Guardian Pro','Pemantauan dan analisis insiden lanjutan',1500000,150000),
('backup-recovery-pro','Backup & Recovery Pro','Pemeriksaan backup dan prosedur pemulihan',1000000,100000)
ON CONFLICT (code) DO NOTHING;

COMMIT;
