import { NextRequest, NextResponse } from "next/server";
import type { PoolClient } from "pg";
import { getSession } from "@/lib/auth";
import { getPool } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const financeRoles = ["owner", "admin", "manager", "finance"];
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Autentikasi diperlukan." }, { status: 401 });
  if (!financeRoles.includes(session.role)) return NextResponse.json({ error: "Hanya bagian keuangan atau manajemen yang dapat memverifikasi pembayaran." }, { status: 403 });

  const { id } = await context.params;
  if (!uuidPattern.test(id)) return NextResponse.json({ error: "ID pembayaran tidak valid." }, { status: 400 });
  let body: { status?: string; note?: string };
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: "Format permintaan tidak valid." }, { status: 400 }); }
  if (!["verified", "rejected"].includes(body.status || "")) {
    return NextResponse.json({ error: "Status verifikasi harus verified atau rejected." }, { status: 400 });
  }
  const note = body.note?.trim() || null;
  if (note && note.length > 500) return NextResponse.json({ error: "Catatan verifikasi maksimal 500 karakter." }, { status: 400 });

  let client: PoolClient | undefined;
  try {
    client = await getPool().connect();
    await client.query("BEGIN");
    const found = await client.query(
      "SELECT id, booking_id, invoice_id, amount, payment_type, status FROM payments WHERE id = $1 AND organization_id = $2 FOR UPDATE",
      [id, session.organizationId],
    );
    const payment = found.rows[0];
    if (!payment) { await client.query("ROLLBACK"); return NextResponse.json({ error: "Pembayaran tidak ditemukan." }, { status: 404 }); }
    if (payment.status !== "pending") {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "Hanya pembayaran berstatus pending yang dapat diputuskan. Status sebelumnya tidak dapat ditimpa." }, { status: 409 });
    }

    if (body.status === "verified" && payment.invoice_id) {
      // Serialize verification per invoice so concurrent pending payments cannot over-collect.
      const invoiceResult = await client.query(
        "SELECT id, amount, status FROM invoices WHERE id = $1 AND organization_id = $2 FOR UPDATE",
        [payment.invoice_id, session.organizationId],
      );
      const invoice = invoiceResult.rows[0];
      if (!invoice || invoice.status === "void") {
        await client.query("ROLLBACK");
        return NextResponse.json({ error: "Invoice tidak ditemukan atau sudah dibatalkan." }, { status: 409 });
      }
      if (payment.payment_type !== "refund") {
        const receivedResult = await client.query(
          `SELECT COALESCE(SUM(CASE WHEN status = 'verified' AND payment_type <> 'refund' THEN amount
                                    WHEN status = 'verified' AND payment_type = 'refund' THEN -amount ELSE 0 END), 0) AS received
           FROM payments WHERE invoice_id = $1 AND organization_id = $2`,
          [payment.invoice_id, session.organizationId],
        );
        const received = Number(receivedResult.rows[0]?.received || 0);
        if (received + Number(payment.amount) > Number(invoice.amount)) {
          await client.query("ROLLBACK");
          return NextResponse.json({
            error: "Nominal ini melebihi sisa tagihan invoice. Periksa pembayaran terverifikasi dan jumlah yang diterima sebelum melanjutkan.",
          }, { status: 409 });
        }
      }
    }

    const updated = await client.query(
      `UPDATE payments SET status = $1,
         verified_by = CASE WHEN $1 = 'verified' THEN $2 ELSE NULL END,
         verified_at = CASE WHEN $1 = 'verified' THEN now() ELSE NULL END
       WHERE id = $3 AND organization_id = $4
       RETURNING id, booking_id, invoice_id, amount, payment_type, status, verified_by, verified_at`,
      [body.status, session.userId, id, session.organizationId],
    );

    if (body.status === "verified" && payment.invoice_id) {
      await client.query("SELECT id FROM invoices WHERE id = $1 AND organization_id = $2 FOR UPDATE", [payment.invoice_id, session.organizationId]);
      const totals = await client.query(
        `SELECT i.amount,
          COALESCE(SUM(CASE WHEN p.status = 'verified' AND p.payment_type <> 'refund' THEN p.amount
                            WHEN p.status = 'verified' AND p.payment_type = 'refund' THEN -p.amount ELSE 0 END), 0) AS received
         FROM invoices i LEFT JOIN payments p ON p.invoice_id = i.id AND p.organization_id = i.organization_id
         WHERE i.id = $1 AND i.organization_id = $2
         GROUP BY i.id, i.amount`,
        [payment.invoice_id, session.organizationId],
      );
      const invoice = totals.rows[0];
      if (invoice) {
        const received = Number(invoice.received);
        const amount = Number(invoice.amount);
        const status = received >= amount ? "paid" : received > 0 ? "partially_paid" : "issued";
        await client.query(
          "UPDATE invoices SET status = $1, issued_at = COALESCE(issued_at, now()) WHERE id = $2 AND organization_id = $3 AND status <> 'void'",
          [status, payment.invoice_id, session.organizationId],
        );
      }
    }

    if (body.status === "verified" && payment.booking_id) {
      await client.query("SELECT id FROM bookings WHERE id = $1 AND organization_id = $2 FOR UPDATE", [payment.booking_id, session.organizationId]);
      const totals = await client.query(
        `SELECT b.estimated_total,
          COALESCE(SUM(CASE WHEN p.status = 'verified' AND p.payment_type <> 'refund' THEN p.amount
                            WHEN p.status = 'verified' AND p.payment_type = 'refund' THEN -p.amount ELSE 0 END), 0) AS received
         FROM bookings b LEFT JOIN payments p ON p.booking_id = b.id AND p.organization_id = b.organization_id
         WHERE b.id = $1 AND b.organization_id = $2
         GROUP BY b.id, b.estimated_total`,
        [payment.booking_id, session.organizationId],
      );
      const booking = totals.rows[0];
      if (booking) {
        const received = Number(booking.received);
        const total = Number(booking.estimated_total);
        const status = received >= total ? "paid" : received > 0 ? "partial" : "unpaid";
        await client.query(
          "UPDATE bookings SET payment_status = $1, updated_at = now() WHERE id = $2 AND organization_id = $3",
          [status, payment.booking_id, session.organizationId],
        );
      }
    }

    await client.query(
      "INSERT INTO audit_logs (organization_id, actor_user_id, actor_type, action, entity_type, entity_id, details) VALUES ($1, $2, 'user', $3, 'payment', $4, $5::jsonb)",
      [session.organizationId, session.userId, `payment.${body.status}`, id, JSON.stringify({ note, previousStatus: payment.status, amount: payment.amount, paymentType: payment.payment_type })],
    );
    await client.query("COMMIT");
    return NextResponse.json({ data: updated.rows[0], message: body.status === "verified" ? "Pembayaran terverifikasi dan ringkasan terkait diperbarui." : "Pembayaran ditolak; tidak dihitung sebagai penerimaan." });
  } catch (error) {
    if (client) await client.query("ROLLBACK").catch(() => undefined);
    console.error("Payment verification failed", error instanceof Error ? error.message : "unknown error");
    return NextResponse.json({ error: "Verifikasi pembayaran gagal." }, { status: 503 });
  } finally { client?.release(); }
}
