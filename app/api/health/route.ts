import { NextResponse } from "next/server";
import { getPool } from "@/lib/db";
import { buildHealthChecks, isApplicationReady } from "@/lib/health-checks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  let database: "ok" | "not_configured" | "error" = "not_configured";
  let databaseSchema: "ok" | "not_configured" | "error" = "not_configured";
  if (process.env.DATABASE_URL) {
    try {
      const pool = getPool();
      await pool.query("SELECT 1");
      database = "ok";
      const requiredTables = [
        "organizations", "users", "customers", "vehicles", "bookings", "conversations", "messages",
        "knowledge_documents", "ai_runs", "follow_ups", "invoices", "payments", "expenses", "audit_logs",
        "webhook_events", "platform_admins", "subscription_plans", "tenant_subscriptions",
        "platform_invoices", "platform_payments", "commission_entries", "tenant_usage_monthly", "platform_audit_logs",
      ];
      const schemaResult = await pool.query<{ missing_tables: string[] | null; missing_columns: string[] | null }>(
        `WITH required_tables(name) AS (
           SELECT unnest($1::text[])
         ), required_columns(table_name, column_name) AS (
           VALUES ('platform_invoices', 'discount_amount'),
                  ('tenant_subscriptions', 'billing_cycle'),
                  ('subscription_plans', 'activation_fee'),
                  ('subscription_plans', 'monthly_fee')
         )
         SELECT
           (SELECT array_agg(name ORDER BY name)
            FROM required_tables WHERE to_regclass('public.' || name) IS NULL) AS missing_tables,
           (SELECT array_agg(rc.table_name || '.' || rc.column_name ORDER BY rc.table_name, rc.column_name)
            FROM required_columns rc
            WHERE NOT EXISTS (
              SELECT 1 FROM information_schema.columns c
              WHERE c.table_schema = 'public' AND c.table_name = rc.table_name AND c.column_name = rc.column_name
            )) AS missing_columns`,
        [requiredTables],
      );
      const schema = schemaResult.rows[0];
      databaseSchema = schema?.missing_tables?.length || schema?.missing_columns?.length ? "not_configured" : "ok";
    } catch {
      database = "error";
      databaseSchema = "error";
    }
  }

  const checks = buildHealthChecks(process.env, database, databaseSchema);
  const ready = isApplicationReady(checks);
  return NextResponse.json(
    { status: ready ? "ready" : "setup_required", checks },
    { status: ready ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
}
