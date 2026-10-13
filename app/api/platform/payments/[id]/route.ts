import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getPlatformSession } from "@/lib/platform-auth";
import { getPool } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({ action: z.enum(["verify", "reject", "refund"]) });

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const session = await getPlatformSession();
  if (!session) return NextResponse.json({ error: "Autentikasi Super Admin diperlukan." }, { status: 401 });
  const { id } = await context.params;
  let raw: unknown;
  try { raw = await request.json(); }
  catch { return NextResponse.json({ error: "Format permintaan tidak valid." }, { status: 400 }); }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: "Aksi pembayaran tidak valid." }, { status: 400 });

  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(
      `SELECT p.*, i.status AS invoice_status, i.total_amount AS invoice_total,
              i.invoice_type, i.subscription_id, i.due_at, i.invoice_number
       FROM platform_payments p
       JOIN platform_invoices i ON i.id = p.platform_invoice_id AND i.organization_id = p.organization_id
       WHERE p.id = $1
       FOR UPDATE OF p, i`,
      [id],
    );
    const payment = result.rows[0];
    if (!payment) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "Pembayaran tidak ditemukan." }, { status: 404 });
    }
    const action = parsed.data.action;
    if (action === "verify") {
      if (payment.status !== "pending" || !["issued", "partially_paid", "overdue"].includes(payment.invoice_status)) {
        await client.query("ROLLBACK");
        return NextResponse.json({ error: "Hanya klaim pending pada invoice terbuka yang dapat diverifikasi." }, { status: 409 });
      }
      const totals = await client.query(
        "SELECT COALESCE(SUM(amount),0)::numeric(14,2) AS total FROM platform_payments WHERE organization_id=$1 AND platform_invoice_id=$2 AND status='verified'",
        [payment.organization_id, payment.platform_invoice_id],
      );
      const paidBefore = Number(totals.rows[0]?.total || 0);
      if (Math.round((paidBefore + Number(payment.amount)) * 100) / 100 > Number(payment.invoice_total)) {
        await client.query("ROLLBACK");
        return NextResponse.json({ error: "Verifikasi ini menyebabkan kelebihan pembayaran invoice." }, { status: 409 });
      }
      await client.query(
        "UPDATE platform_payments SET status='verified', verified_at=now(), verified_by_platform_admin_id=$1 WHERE id=$2",
        [session.platformAdminId, id],
      );
    } else if (action === "reject") {
      if (payment.status !== "pending") {
        await client.query("ROLLBACK");
        return NextResponse.json({ error: "Hanya klaim pending yang dapat ditolak." }, { status: 409 });
      }
      await client.query("UPDATE platform_payments SET status='rejected' WHERE id=$1", [id]);
    } else {
      if (payment.status !== "verified") {
        await client.query("ROLLBACK");
        return NextResponse.json({ error: "Hanya pembayaran terverifikasi yang dapat ditandai dikembalikan." }, { status: 409 });
      }
      await client.query("UPDATE platform_payments SET status='refunded' WHERE id=$1", [id]);
    }

    const totalResult = await client.query(
      "SELECT COALESCE(SUM(amount),0)::numeric(14,2) AS total FROM platform_payments WHERE organization_id=$1 AND platform_invoice_id=$2 AND status='verified'",
      [payment.organization_id, payment.platform_invoice_id],
    );
    const paid = Number(totalResult.rows[0]?.total || 0);
    const invoiceTotal = Number(payment.invoice_total);
    const invoiceStatus = paid >= invoiceTotal ? "paid" : paid > 0 ? "partially_paid"
      : payment.due_at && new Date(payment.due_at).getTime() < Date.now() ? "overdue" : "issued";
    await client.query(
      "UPDATE platform_invoices SET status=$1, updated_at=now() WHERE id=$2",
      [invoiceStatus, payment.platform_invoice_id],
    );
    if (payment.invoice_type === "activation" && payment.subscription_id) {
      await client.query(
        "UPDATE tenant_subscriptions SET activation_status=$1, updated_at=now() WHERE id=$2 AND organization_id=$3",
        [invoiceStatus === "paid" ? "paid" : "due", payment.subscription_id, payment.organization_id],
      );
    }
    await client.query(
      `INSERT INTO platform_audit_logs (platform_admin_id, actor_type, action, entity_type, entity_id, details)
       VALUES ($1, 'platform_admin', $2, 'platform_payment', $3, $4::jsonb)`,
      [session.platformAdminId, "platform_payment." + action, id, JSON.stringify({ invoiceId: payment.platform_invoice_id, invoiceNumber: payment.invoice_number, amount: payment.amount, resultingInvoiceStatus: invoiceStatus })],
    );
    await client.query("COMMIT");
    return NextResponse.json({ data: { id, status: action === "verify" ? "verified" : action === "reject" ? "rejected" : "refunded" }, invoiceStatus });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    console.error("Platform payment verification failed", error instanceof Error ? error.message : "unknown error");
    return NextResponse.json({ error: "Status pembayaran belum dapat diperbarui." }, { status: 503 });
  } finally { client.release(); }
}
