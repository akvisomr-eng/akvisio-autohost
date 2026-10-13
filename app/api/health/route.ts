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
      const schemaResult = await pool.query<{ missing_tables: string[] | null }>(
        "SELECT array_agg(required.name ORDER BY required.name) FILTER (WHERE to_regclass('public.' || required.name) IS NULL) AS missing_tables FROM unnest($1::text[]) AS required(name)",
        [requiredTables],
      );
      databaseSchema = schemaResult.rows[0]?.missing_tables?.length ? "not_configured" : "ok";
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
