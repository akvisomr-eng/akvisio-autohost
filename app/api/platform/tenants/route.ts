import { NextResponse } from "next/server";
import { getPlatformSession } from "@/lib/platform-auth";
import { getPool } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getPlatformSession();
  if (!session) return NextResponse.json({ error: "Autentikasi Super Admin diperlukan." }, { status: 401 });
  try {
    const result = await getPool().query(
      `SELECT o.id, o.name, o.slug, o.default_locale, o.timezone, o.currency, o.created_at,
              ts.id AS subscription_id, ts.status AS subscription_status, ts.activation_status,
              ts.billing_cycle, ts.current_period_end, ts.next_billing_at,
              sp.id AS plan_id, sp.name AS plan_name,
              COALESCE(inv.open_invoice_count, 0)::int AS open_platform_invoices
       FROM organizations o
       LEFT JOIN LATERAL (
         SELECT s.* FROM tenant_subscriptions s
         WHERE s.organization_id = o.id
         ORDER BY CASE WHEN s.status IN ('pending_activation','trialing','active','past_due','suspended') THEN 0 ELSE 1 END,
                  s.created_at DESC LIMIT 1
       ) ts ON true
       LEFT JOIN subscription_plans sp ON sp.id = ts.plan_id
       LEFT JOIN LATERAL (
         SELECT COUNT(*) AS open_invoice_count FROM platform_invoices i
         WHERE i.organization_id = o.id AND i.status IN ('issued','partially_paid','overdue')
       ) inv ON true
       ORDER BY o.created_at DESC LIMIT 500`,
    );
    return NextResponse.json({ data: result.rows });
  } catch (error) {
    console.error("Platform tenant list failed", error instanceof Error ? error.message : "unknown error");
    return NextResponse.json({ error: "Daftar tenant belum dapat dimuat. Pastikan migrasi platform billing telah diterapkan." }, { status: 503 });
  }
}
