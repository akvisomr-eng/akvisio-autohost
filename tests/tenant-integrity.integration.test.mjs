import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import pg from "pg";

const { Client } = pg;
const here = dirname(fileURLToPath(import.meta.url));
let client;
let fixture;

async function expectForeignKeyViolation(sql, params) {
  await client.query("BEGIN");
  await client.query("SAVEPOINT tenant_integrity_case");
  let caught;
  try {
    await client.query(sql, params);
  } catch (error) {
    caught = error;
  }
  await client.query("ROLLBACK TO SAVEPOINT tenant_integrity_case");
  await client.query("RELEASE SAVEPOINT tenant_integrity_case");
  await client.query("COMMIT");
  assert.equal(caught?.code, "23503", "Expected foreign-key violation, got " + (caught?.code ?? "no error") + ": " + (caught?.message ?? ""));
}

before(async () => {
  const connectionString = process.env.TEST_DATABASE_URL;
  assert.ok(connectionString, "TEST_DATABASE_URL must point to the isolated CI PostgreSQL service");
  client = new Client({ connectionString });
  await client.connect();

  // Build a disposable schema from the baseline plus tenant-integrity migrations.
  for (const file of [
    "001_initial_schema.sql",
    "006_whatsapp_inbox_tenant_routing.sql",
    "007_whatsapp_outbound_idempotency.sql",
    "008_tenant_finance_integrity.sql",
    "009_platform_billing_foundation.sql",
    "010_platform_admin_lockout.sql",
    "011_platform_invoice_payment_integrity.sql",
    "012_seed_commercial_subscription_plans.sql",
    "013_annual_subscription_discount.sql",
  ]) {
    await client.query(await readFile(resolve(here, "../database/migrations", file), "utf8"));
  }

  const stamp = randomUUID().replaceAll("-", "").slice(0, 10);
  const orgA = randomUUID();
  const orgB = randomUUID();
  const customerA = randomUUID();
  const customerB = randomUUID();
  const vehicleA = randomUUID();
  const vehicleB = randomUUID();
  const bookingA = randomUUID();
  const bookingB = randomUUID();
  const invoiceA = randomUUID();
  const invoiceB = randomUUID();

  await client.query(
    "INSERT INTO organizations (id, name, slug) VALUES ($1, 'Tenant Test A', $3), ($2, 'Tenant Test B', $4)",
    [orgA, orgB, "ci-tenant-a-" + stamp, "ci-tenant-b-" + stamp],
  );
  await client.query(
    "INSERT INTO customers (id, organization_id, whatsapp_number) VALUES ($1, $2, $3), ($4, $5, $6)",
    [customerA, orgA, "+1999" + stamp, customerB, orgB, "+1888" + stamp],
  );
  await client.query(
    "INSERT INTO vehicles (id, organization_id, registration_number, make, model) VALUES ($1, $2, $3, 'Test', 'A'), ($4, $5, $6, 'Test', 'B')",
    [vehicleA, orgA, "CITA-" + stamp, vehicleB, orgB, "CITB-" + stamp],
  );
  await client.query(
    "INSERT INTO bookings (id, organization_id, booking_code, customer_id, vehicle_id, service_mode, pickup_at, return_at, daily_rate, estimated_total) " +
    "VALUES ($1, $2, $3, $4, $5, 'self_drive', now() + interval '10 days', now() + interval '11 days', 100, 100), " +
    "($6, $7, $8, $9, $10, 'self_drive', now() + interval '10 days', now() + interval '11 days', 100, 100)",
    [bookingA, orgA, "BKTA-" + stamp, customerA, vehicleA, bookingB, orgB, "BKTB-" + stamp, customerB, vehicleB],
  );
  await client.query(
    "INSERT INTO invoices (id, organization_id, booking_id, invoice_number, amount) VALUES ($1, $2, $3, $4, 100), ($5, $6, $7, $8, 100)",
    [invoiceA, orgA, bookingA, "INTA-" + stamp, invoiceB, orgB, bookingB, "INTB-" + stamp],
  );

  fixture = { orgA, orgB, customerA, vehicleA, vehicleB, bookingA, invoiceA };
});

after(async () => {
  if (!client) return;
  if (fixture) {
    const { orgA, orgB } = fixture;
    await client.query("DELETE FROM commission_entries WHERE organization_id IN ($1, $2)", [orgA, orgB]);
    await client.query("DELETE FROM platform_payments WHERE organization_id IN ($1, $2)", [orgA, orgB]);
    await client.query("DELETE FROM platform_invoices WHERE organization_id IN ($1, $2)", [orgA, orgB]);
    await client.query("DELETE FROM tenant_usage_monthly WHERE organization_id IN ($1, $2)", [orgA, orgB]);
    await client.query("DELETE FROM tenant_subscriptions WHERE organization_id IN ($1, $2)", [orgA, orgB]);
    if (fixture.planId) await client.query("DELETE FROM subscription_plans WHERE id = $1", [fixture.planId]);
    await client.query("DELETE FROM payments WHERE organization_id IN ($1, $2)", [orgA, orgB]);
    await client.query("DELETE FROM expenses WHERE organization_id IN ($1, $2)", [orgA, orgB]);
    await client.query("DELETE FROM vehicle_maintenance WHERE organization_id IN ($1, $2)", [orgA, orgB]);
    await client.query("DELETE FROM invoices WHERE organization_id IN ($1, $2)", [orgA, orgB]);
    await client.query("DELETE FROM bookings WHERE organization_id IN ($1, $2)", [orgA, orgB]);
    await client.query("DELETE FROM vehicles WHERE organization_id IN ($1, $2)", [orgA, orgB]);
    await client.query("DELETE FROM customers WHERE organization_id IN ($1, $2)", [orgA, orgB]);
    await client.query("DELETE FROM organizations WHERE id IN ($1, $2)", [orgA, orgB]);
  }
  await client.end();
});

test("database rejects cross-tenant foreign keys across booking, finance, and fleet", async (t) => {
  const { orgA, orgB, customerA, vehicleA, vehicleB, bookingA, invoiceA } = fixture;
  const stamp = randomUUID().replaceAll("-", "").slice(0, 10);
  const bookingSql =
    "INSERT INTO bookings (organization_id, booking_code, customer_id, vehicle_id, service_mode, pickup_at, return_at, daily_rate, estimated_total) " +
    "VALUES ($1, $2, $3, $4, 'self_drive', now() + interval '20 days', now() + interval '21 days', 100, 100)";

  await t.test("booking cannot reference another tenant's customer", async () => {
    await expectForeignKeyViolation(bookingSql, [orgB, "XBC-" + stamp, customerA, vehicleB]);
  });
  await t.test("booking cannot reference another tenant's vehicle", async () => {
    await expectForeignKeyViolation(bookingSql, [orgA, "XBV-" + stamp, customerA, vehicleB]);
  });
  await t.test("invoice cannot reference another tenant's booking", async () => {
    await expectForeignKeyViolation(
      "INSERT INTO invoices (organization_id, booking_id, invoice_number, amount) VALUES ($1, $2, $3, 100)",
      [orgB, bookingA, "XIB-" + stamp],
    );
  });
  await t.test("payment cannot reference another tenant's booking", async () => {
    await expectForeignKeyViolation(
      "INSERT INTO payments (organization_id, booking_id, amount) VALUES ($1, $2, 10)",
      [orgB, bookingA],
    );
  });
  await t.test("payment cannot reference another tenant's invoice", async () => {
    await expectForeignKeyViolation(
      "INSERT INTO payments (organization_id, invoice_id, amount) VALUES ($1, $2, 10)",
      [orgB, invoiceA],
    );
  });
  await t.test("expense cannot reference another tenant's vehicle", async () => {
    await expectForeignKeyViolation(
      "INSERT INTO expenses (organization_id, vehicle_id, category, description, amount) VALUES ($1, $2, 'test', 'must reject', 1)",
      [orgB, vehicleA],
    );
  });
  await t.test("expense cannot reference another tenant's booking", async () => {
    await expectForeignKeyViolation(
      "INSERT INTO expenses (organization_id, booking_id, category, description, amount) VALUES ($1, $2, 'test', 'must reject', 1)",
      [orgB, bookingA],
    );
  });
  await t.test("maintenance cannot reference another tenant's vehicle", async () => {
    await expectForeignKeyViolation(
      "INSERT INTO vehicle_maintenance (organization_id, vehicle_id, maintenance_type) VALUES ($1, $2, 'test')",
      [orgB, vehicleA],
    );
  });
});


test("SaaS billing schema records commission only from verified eligible receipts", async (t) => {
  const { orgA, orgB, bookingA } = fixture;
  const planResult = await client.query(
    "INSERT INTO subscription_plans (code, name, monthly_fee, commission_rate_bps) VALUES ($1, 'CI Test Plan', 100, 200) RETURNING id",
    ["ci-plan-" + randomUUID()],
  );
  const planId = planResult.rows[0].id;
  fixture.planId = planId;
  const subResult = await client.query(
    "INSERT INTO tenant_subscriptions (organization_id, plan_id, status, activation_status) VALUES ($1, $2, 'active', 'paid') RETURNING id",
    [orgA, planId],
  );
  const subscriptionId = subResult.rows[0].id;
  const pendingDeposit = await client.query(
    "INSERT INTO payments (organization_id, booking_id, amount, payment_type, status) VALUES ($1, $2, 100, 'deposit', 'verified') RETURNING id",
    [orgA, bookingA],
  );

  await t.test("deposit cannot be misclassified as commissionable rental revenue", async () => {
    await client.query("BEGIN");
    await client.query("SAVEPOINT commission_policy_case");
    let caught;
    try {
      await client.query(
        `INSERT INTO commission_entries
         (organization_id, subscription_id, source_payment_id, source_booking_id, source_payment_type,
          gross_amount, commissionable_amount, commission_rate_bps, commission_amount)
         VALUES ($1, $2, $3, $4, 'rental', 100, 100, 200, 2)`,
        [orgA, subscriptionId, pendingDeposit.rows[0].id, bookingA],
      );
    } catch (error) { caught = error; }
    await client.query("ROLLBACK TO SAVEPOINT commission_policy_case");
    await client.query("RELEASE SAVEPOINT commission_policy_case");
    await client.query("COMMIT");
    assert.equal(caught?.code, "23514", "Expected commission policy violation, got " + (caught?.code ?? "no error"));
  });

  await t.test("verified rental receipt can produce one commission entry", async () => {
    const rental = await client.query(
      "INSERT INTO payments (organization_id, booking_id, amount, payment_type, status) VALUES ($1, $2, 1000, 'rental', 'verified') RETURNING id",
      [orgA, bookingA],
    );
    const entry = await client.query(
      `INSERT INTO commission_entries
       (organization_id, subscription_id, source_payment_id, source_booking_id, source_payment_type,
        gross_amount, commissionable_amount, commission_rate_bps, commission_amount)
       VALUES ($1, $2, $3, $4, 'rental', 1000, 1000, 200, 20)
       RETURNING id`,
      [orgA, subscriptionId, rental.rows[0].id, bookingA],
    );
    assert.ok(entry.rows[0].id);
  });

  await t.test("commission source must belong to the same tenant", async () => {
    const rental = await client.query(
      "INSERT INTO payments (organization_id, booking_id, amount, payment_type, status) VALUES ($1, $2, 1000, 'rental', 'verified') RETURNING id",
      [orgA, bookingA],
    );
    await client.query("BEGIN");
    await client.query("SAVEPOINT commission_tenant_case");
    let caught;
    try {
      await client.query(
        `INSERT INTO commission_entries
         (organization_id, subscription_id, source_payment_id, source_booking_id, source_payment_type,
          gross_amount, commissionable_amount, commission_rate_bps, commission_amount)
         VALUES ($1, $2, $3, $4, 'rental', 1000, 1000, 200, 20)`,
        [orgB, subscriptionId, rental.rows[0].id, bookingA],
      );
    } catch (error) { caught = error; }
    await client.query("ROLLBACK TO SAVEPOINT commission_tenant_case");
    await client.query("RELEASE SAVEPOINT commission_tenant_case");
    await client.query("COMMIT");
    assert.equal(caught?.code, "23503", "Expected cross-tenant FK violation, got " + (caught?.code ?? "no error"));
  });
});


test("approved commercial plan prices and activation fee are seeded", async () => {
  const result = await client.query(
    "SELECT code, activation_fee::numeric(14,2)::text AS activation_fee, monthly_fee::numeric(14,2)::text AS monthly_fee FROM subscription_plans WHERE code = ANY($1::text[]) ORDER BY monthly_fee",
    [["starter", "business", "pro"]],
  );
  assert.deepEqual(result.rows, [
    { code: "starter", activation_fee: "3500000.00", monthly_fee: "475000.00" },
    { code: "business", activation_fee: "3500000.00", monthly_fee: "895000.00" },
    { code: "pro", activation_fee: "3500000.00", monthly_fee: "1595000.00" },
  ]);
});
