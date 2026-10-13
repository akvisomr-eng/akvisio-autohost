import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getPlatformSession } from "@/lib/platform-auth";
import { getPool } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  organizationId: z.string().uuid(),
  planId: z.string().uuid(),
  billingCycle: z.literal("monthly").default("monthly"),
});

export async function POST(request: NextRequest) {
  const session = await getPlatformSession();
  if (!session) return NextResponse.json({ error: "Autentikasi Super Admin diperlukan." }, { status: 401 });
  let raw: unknown;
  try { raw = await request.json(); }
  catch { return NextResponse.json({ error: "Format permintaan tidak valid." }, { status: 400 }); }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: "Tenant, paket, atau siklus tagihan tidak valid." }, { status: 400 });
  const { organizationId, planId } = parsed.data;
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const org = await client.query("SELECT id, name FROM organizations WHERE id = $1 FOR UPDATE", [organizationId]);
    if (!org.rows[0]) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "Tenant tidak ditemukan." }, { status: 404 });
    }
    const planResult = await client.query(
      "SELECT id, code, name, activation_fee, monthly_fee, commission_rate_bps, commission_cap_amount FROM subscription_plans WHERE id = $1 AND is_active = true FOR SHARE",
      [planId],
    );
    const plan = planResult.rows[0];
    if (!plan) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "Paket tidak ditemukan atau tidak aktif." }, { status: 404 });
    }
    const existing = await client.query(
      "SELECT id FROM tenant_subscriptions WHERE organization_id = $1 AND status IN ('pending_activation','trialing','active','past_due','suspended') LIMIT 1",
      [organizationId],
    );
    if (existing.rows[0]) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "Tenant sudah memiliki subscription berjalan. Ubah paket melalui alur perubahan paket, bukan membuat subscription kedua." }, { status: 409 });
    }
    const activationFee = Number(plan.activation_fee);
    const result = await client.query(
      `INSERT INTO tenant_subscriptions
       (organization_id, plan_id, status, billing_cycle, activation_fee_amount, activation_status,
        monthly_fee_amount, commission_rate_bps, commission_cap_amount)
       VALUES ($1, $2, 'pending_activation', 'monthly', $3, $4, $5, $6, $7)
       RETURNING id, organization_id, plan_id, status, billing_cycle, activation_fee_amount, activation_status,
                 monthly_fee_amount, commission_rate_bps, commission_cap_amount, created_at`,
      [organizationId, planId, activationFee, activationFee > 0 ? "due" : "waived",
       plan.monthly_fee, plan.commission_rate_bps, plan.commission_cap_amount],
    );
    const subscription = result.rows[0];
    await client.query(
      `INSERT INTO platform_audit_logs (platform_admin_id, actor_type, action, entity_type, entity_id, details)
       VALUES ($1, 'platform_admin', 'tenant_subscription.assigned', 'tenant_subscription', $2, $3::jsonb)`,
      [session.platformAdminId, subscription.id, JSON.stringify({ organizationId, planId, billingCycle: "monthly", status: "pending_activation" })],
    );
    await client.query("COMMIT");
    return NextResponse.json({ data: subscription, message: "Paket ditetapkan. Subscription masih pending activation; invoice dan verifikasi pembayaran belum dibuat otomatis." }, { status: 201 });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    const code = (error as { code?: string })?.code;
    if (code === "23505") return NextResponse.json({ error: "Tenant sudah memiliki subscription aktif atau menunggu aktivasi." }, { status: 409 });
    console.error("Tenant subscription assignment failed", error instanceof Error ? error.message : "unknown error");
    return NextResponse.json({ error: "Paket tenant belum dapat ditetapkan." }, { status: 503 });
  } finally { client.release(); }
}
