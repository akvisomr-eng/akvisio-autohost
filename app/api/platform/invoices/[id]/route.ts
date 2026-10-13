import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getPlatformSession } from "@/lib/platform-auth";
import { getPool } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const issueSchema = z.object({
  action: z.literal("issue"),
  taxAmount: z.number().finite().min(0).max(999999999999.99),
  dueAt: z.string().datetime({ offset: true }),
});
const voidSchema = z.object({ action: z.literal("void") });

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const session = await getPlatformSession();
  if (!session) return NextResponse.json({ error: "Autentikasi Super Admin diperlukan." }, { status: 401 });
  const { id } = await context.params;
  let raw: unknown;
  try { raw = await request.json(); }
  catch { return NextResponse.json({ error: "Format permintaan tidak valid." }, { status: 400 }); }
  const action = raw && typeof raw === "object" ? (raw as { action?: unknown }).action : undefined;
  const parsed = action === "issue" ? issueSchema.safeParse(raw) : voidSchema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: "Perintah invoice tidak valid.", details: parsed.error.flatten().fieldErrors }, { status: 400 });

  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(
      "SELECT * FROM platform_invoices WHERE id = $1 FOR UPDATE",
      [id],
    );
    const invoice = result.rows[0];
    if (!invoice) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "Invoice tidak ditemukan." }, { status: 404 });
    }
    if (parsed.data.action === "issue") {
      if (invoice.status !== "draft") {
        await client.query("ROLLBACK");
        return NextResponse.json({ error: "Hanya draft invoice yang dapat diterbitkan." }, { status: 409 });
      }
      const issue = parsed.data;
      if (new Date(issue.dueAt).getTime() <= Date.now()) {
        await client.query("ROLLBACK");
        return NextResponse.json({ error: "Tanggal jatuh tempo harus berada di masa depan." }, { status: 400 });
      }
      let subtotal = Number(invoice.subtotal_amount);
      let discount = Number(invoice.discount_amount || 0);
      let commissionIds: string[] = [];
      if (invoice.invoice_type === "commission") {
        await client.query("SELECT id FROM tenant_subscriptions WHERE id=$1 AND organization_id=$2 FOR UPDATE", [invoice.subscription_id, invoice.organization_id]);
        const entries = await client.query(
          `SELECT id FROM commission_entries
           WHERE organization_id = $1 AND subscription_id = $2 AND status = 'pending'
             AND earned_at >= $3::date AND earned_at < ($4::date + interval '1 day')
           FOR UPDATE`,
          [invoice.organization_id, invoice.subscription_id, invoice.period_start, invoice.period_end],
        );
        commissionIds = entries.rows.map((row) => row.id as string);
        if (!commissionIds.length) {
          await client.query("ROLLBACK");
          return NextResponse.json({ error: "Tidak ada entri komisi pending untuk periode invoice ini." }, { status: 409 });
        }
        const sum = await client.query(
          "SELECT COALESCE(SUM(commission_amount),0)::numeric(14,2) AS amount FROM commission_entries WHERE id = ANY($1::uuid[]) AND organization_id = $2",
          [commissionIds, invoice.organization_id],
        );
        subtotal = Number(sum.rows[0]?.amount || 0);
        discount = 0;
      }
      if (!Number.isFinite(discount) || discount < 0 || discount > subtotal) {
        await client.query("ROLLBACK");
        return NextResponse.json({ error: "Nilai diskon invoice tidak valid." }, { status: 409 });
      }
      const total = Math.round((subtotal - discount + issue.taxAmount) * 100) / 100;
      if (!Number.isFinite(total) || total <= 0) {
        await client.query("ROLLBACK");
        return NextResponse.json({ error: "Total invoice harus lebih besar dari nol." }, { status: 400 });
      }
      const updated = await client.query(
        `UPDATE platform_invoices SET subtotal_amount=$1, discount_amount=$2, tax_amount=$3, total_amount=$4,
          status='issued', due_at=$4::timestamptz, issued_at=now(), updated_at=now()
         WHERE id=$6 RETURNING *`,
        [subtotal, discount, issue.taxAmount, total, issue.dueAt, id],
      );
      if (commissionIds.length) {
        await client.query(
          "UPDATE commission_entries SET status='invoiced', platform_invoice_id=$1 WHERE id = ANY($2::uuid[]) AND organization_id=$3 AND status='pending'",
          [id, commissionIds, invoice.organization_id],
        );
      }
      await client.query(
        `INSERT INTO platform_audit_logs (platform_admin_id, actor_type, action, entity_type, entity_id, details)
         VALUES ($1, 'platform_admin', 'platform_invoice.issued', 'platform_invoice', $2, $3::jsonb)`,
        [session.platformAdminId, id, JSON.stringify({ invoiceNumber: invoice.invoice_number, subtotal, discount, taxAmount: issue.taxAmount, total, dueAt: issue.dueAt })],
      );
      await client.query("COMMIT");
      return NextResponse.json({ data: updated.rows[0] });
    }

    if (!["draft", "issued", "overdue"].includes(invoice.status)) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "Invoice dengan status ini tidak dapat dibatalkan." }, { status: 409 });
    }
    const payments = await client.query(
      "SELECT COUNT(*)::int AS count FROM platform_payments WHERE organization_id=$1 AND platform_invoice_id=$2 AND status IN ('pending','verified')",
      [invoice.organization_id, id],
    );
    if (Number(payments.rows[0]?.count || 0) > 0) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "Batalkan atau selesaikan klaim pembayaran pending terlebih dahulu; pembayaran terverifikasi tidak dapat dihapus dari audit." }, { status: 409 });
    }
    await client.query(
      "UPDATE commission_entries SET status='pending', platform_invoice_id=NULL WHERE organization_id=$1 AND platform_invoice_id=$2 AND status='invoiced'",
      [invoice.organization_id, id],
    );
    const updated = await client.query(
      "UPDATE platform_invoices SET status='void', updated_at=now() WHERE id=$1 RETURNING *",
      [id],
    );
    await client.query(
      `INSERT INTO platform_audit_logs (platform_admin_id, actor_type, action, entity_type, entity_id, details)
       VALUES ($1, 'platform_admin', 'platform_invoice.voided', 'platform_invoice', $2, $3::jsonb)`,
      [session.platformAdminId, id, JSON.stringify({ invoiceNumber: invoice.invoice_number })],
    );
    await client.query("COMMIT");
    return NextResponse.json({ data: updated.rows[0] });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    console.error("Platform invoice state update failed", error instanceof Error ? error.message : "unknown error");
    return NextResponse.json({ error: "Status invoice belum dapat diperbarui." }, { status: 503 });
  } finally { client.release(); }
}
