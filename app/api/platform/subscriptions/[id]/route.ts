import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getPlatformSession } from "@/lib/platform-auth";
import { getPool } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({ action: z.enum(["activate", "suspend", "reactivate", "cancel"]) });

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const session = await getPlatformSession();
  if (!session) return NextResponse.json({ error: "Autentikasi Super Admin diperlukan." }, { status: 401 });
  const { id } = await context.params;
  let raw: unknown;
  try { raw = await request.json(); }
  catch { return NextResponse.json({ error: "Format permintaan tidak valid." }, { status: 400 }); }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: "Aksi subscription tidak valid." }, { status: 400 });
  const action = parsed.data.action;
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const result = await client.query("SELECT * FROM tenant_subscriptions WHERE id=$1 FOR UPDATE", [id]);
    const subscription = result.rows[0];
    if (!subscription) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "Subscription tidak ditemukan." }, { status: 404 });
    }

    let nextStatus = subscription.status as string;
    if (action === "activate") {
      if (subscription.status !== "pending_activation" || !["paid", "waived"].includes(subscription.activation_status)) {
        await client.query("ROLLBACK");
        return NextResponse.json({ error: "Aktivasi memerlukan subscription pending dan biaya aktivasi berstatus paid/waived." }, { status: 409 });
      }
      nextStatus = "active";
    } else if (action === "suspend") {
      if (!["active", "past_due", "trialing"].includes(subscription.status)) {
        await client.query("ROLLBACK");
        return NextResponse.json({ error: "Hanya subscription aktif, trial, atau menunggak yang dapat ditangguhkan." }, { status: 409 });
      }
      nextStatus = "suspended";
    } else if (action === "reactivate") {
      if (subscription.status !== "suspended") {
        await client.query("ROLLBACK");
        return NextResponse.json({ error: "Hanya subscription suspended yang dapat diaktifkan kembali." }, { status: 409 });
      }
      const open = await client.query(
        "SELECT COUNT(*)::int AS count FROM platform_invoices WHERE organization_id=$1 AND subscription_id=$2 AND status IN ('issued','partially_paid','overdue')",
        [subscription.organization_id, id],
      );
      if (Number(open.rows[0]?.count || 0) > 0) {
        await client.query("ROLLBACK");
        return NextResponse.json({ error: "Selesaikan invoice platform terbuka sebelum reaktivasi." }, { status: 409 });
      }
      nextStatus = "active";
    } else {
      if (!["pending_activation", "trialing", "active", "past_due", "suspended"].includes(subscription.status)) {
        await client.query("ROLLBACK");
        return NextResponse.json({ error: "Subscription tidak dapat dibatalkan dari status saat ini." }, { status: 409 });
      }
      nextStatus = "cancelled";
    }

    const updated = await client.query(
      "UPDATE tenant_subscriptions SET status=$1, cancelled_at=CASE WHEN $1='cancelled' THEN now() ELSE cancelled_at END, updated_at=now() WHERE id=$2 RETURNING id, organization_id, plan_id, status, activation_status, billing_cycle, current_period_end, updated_at",
      [nextStatus, id],
    );
    await client.query(
      `INSERT INTO platform_audit_logs (platform_admin_id, actor_type, action, entity_type, entity_id, details)
       VALUES ($1, 'platform_admin', $2, 'tenant_subscription', $3, $4::jsonb)`,
      [session.platformAdminId, "tenant_subscription." + action, id, JSON.stringify({ previousStatus: subscription.status, nextStatus })],
    );
    await client.query("COMMIT");
    return NextResponse.json({ data: updated.rows[0] });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    console.error("Subscription lifecycle update failed", error instanceof Error ? error.message : "unknown error");
    return NextResponse.json({ error: "Status subscription belum dapat diperbarui." }, { status: 503 });
  } finally { client.release(); }
}
