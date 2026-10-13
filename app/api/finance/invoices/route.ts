import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import type { PoolClient } from "pg";
import { getSession } from "@/lib/auth";
import { getPool } from "@/lib/db";
import { isCalendarDate, toMinorUnits } from "@/lib/finance-validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const financeRoles = ["owner", "admin", "manager", "finance"];
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Autentikasi diperlukan." }, { status: 401 });
  if (!financeRoles.includes(session.role)) {
    return NextResponse.json({ error: "Akses invoice hanya untuk bagian keuangan atau manajemen." }, { status: 403 });
  }

  const status = request.nextUrl.searchParams.get("status");
  if (status && !["draft", "issued", "partially_paid", "paid", "void", "overdue"].includes(status)) {
    return NextResponse.json({ error: "Filter status invoice tidak valid." }, { status: 400 });
  }

  try {
    const result = await getPool().query(
      `SELECT i.id, i.invoice_number, i.booking_id, i.amount, i.status, i.due_at, i.issued_at, i.created_at,
              b.booking_code, c.full_name AS customer_name, c.whatsapp_number,
              COALESCE(SUM(CASE WHEN p.status = 'verified' AND p.payment_type <> 'refund' THEN p.amount
                                WHEN p.status = 'verified' AND p.payment_type = 'refund' THEN -p.amount ELSE 0 END), 0)::numeric AS received
       FROM invoices i
       LEFT JOIN bookings b ON b.id = i.booking_id AND b.organization_id = i.organization_id
       LEFT JOIN customers c ON c.id = b.customer_id AND c.organization_id = b.organization_id
       LEFT JOIN payments p ON p.invoice_id = i.id AND p.organization_id = i.organization_id
       WHERE i.organization_id = $1 AND ($2::text IS NULL OR i.status = $2)
       GROUP BY i.id, b.booking_code, c.full_name, c.whatsapp_number
       ORDER BY i.created_at DESC
       LIMIT 200`,
      [session.organizationId, status || null],
    );
    return NextResponse.json({ data: result.rows });
  } catch (error) {
    console.error("Invoice list failed", error instanceof Error ? error.message : "unknown error");
    return NextResponse.json({ error: "Daftar invoice belum dapat dimuat." }, { status: 503 });
  }
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Autentikasi diperlukan." }, { status: 401 });
  if (!financeRoles.includes(session.role)) {
    return NextResponse.json({ error: "Pembuatan invoice hanya untuk bagian keuangan atau manajemen." }, { status: 403 });
  }

  let body: { bookingId?: string; dueAt?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Format permintaan tidak valid." }, { status: 400 });
  }

  const bookingId = body.bookingId?.trim() || "";
  if (!uuidPattern.test(bookingId)) {
    return NextResponse.json({ error: "Pilih pemesanan yang valid untuk dibuatkan invoice." }, { status: 400 });
  }

  let dueAt: string | null = null;
  if (body.dueAt) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(body.dueAt) || !Number.isFinite(Date.parse(`${body.dueAt}T00:00:00Z`))) {
      return NextResponse.json({ error: "Tanggal jatuh tempo harus berformat YYYY-MM-DD." }, { status: 400 });
    }
    dueAt = body.dueAt;
  }

  let client: PoolClient | undefined;
  try {
    client = await getPool().connect();
    await client.query("BEGIN");
    const bookingResult = await client.query(
      `SELECT id, booking_code, estimated_total, status
       FROM bookings WHERE id = $1 AND organization_id = $2 FOR UPDATE`,
      [bookingId, session.organizationId],
    );
    const booking = bookingResult.rows[0];
    if (!booking) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "Pemesanan tidak ditemukan pada organisasi ini." }, { status: 404 });
    }
    if (["cancelled", "rejected", "expired"].includes(booking.status)) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "Invoice tidak dapat dibuat untuk pemesanan yang batal, ditolak, atau kedaluwarsa." }, { status: 409 });
    }

    const existing = await client.query(
      "SELECT id, invoice_number, status FROM invoices WHERE organization_id = $1 AND booking_id = $2 AND status <> 'void' FOR UPDATE",
      [session.organizationId, bookingId],
    );
    if (existing.rows[0]) {
      await client.query("ROLLBACK");
      return NextResponse.json({
        error: "Pemesanan ini sudah memiliki invoice aktif.",
        existingInvoice: existing.rows[0],
      }, { status: 409 });
    }

    const amountMinor = toMinorUnits(booking.estimated_total);
    if (amountMinor === null || amountMinor <= 0) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "Total pemesanan harus lebih dari Rp0 sebelum invoice diterbitkan." }, { status: 400 });
    }

    const amount = (amountMinor ?? 0) / 100;
    const invoiceNumber = `SRC-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${randomUUID().slice(0, 8).toUpperCase()}`;
    const inserted = await client.query(
      `INSERT INTO invoices (organization_id, booking_id, invoice_number, amount, status, due_at, issued_at)
       VALUES ($1, $2, $3, $4, 'issued', $5::date, now())
       RETURNING id, booking_id, invoice_number, amount, status, due_at, issued_at, created_at`,
      [session.organizationId, bookingId, invoiceNumber, amount, dueAt],
    );
    await client.query(
      "INSERT INTO audit_logs (organization_id, actor_user_id, actor_type, action, entity_type, entity_id, details) VALUES ($1, $2, 'user', 'invoice.issued', 'invoice', $3, $4::jsonb)",
      [session.organizationId, session.userId, inserted.rows[0].id, JSON.stringify({ bookingId, bookingCode: booking.booking_code, amount, dueAt })],
    );
    await client.query("COMMIT");
    return NextResponse.json({ data: inserted.rows[0], message: "Invoice diterbitkan. Pembayaran tetap harus diverifikasi secara terpisah." }, { status: 201 });
  } catch (error) {
    if (client) await client.query("ROLLBACK").catch(() => undefined);
    const pgError = error as { code?: string };
    if (pgError.code === "23505") {
      return NextResponse.json({ error: "Nomor invoice duplikat terdeteksi. Silakan coba kembali." }, { status: 409 });
    }
    console.error("Invoice creation failed", error instanceof Error ? error.message : "unknown error");
    return NextResponse.json({ error: "Invoice gagal diterbitkan." }, { status: 503 });
  } finally {
    client?.release();
  }
}
