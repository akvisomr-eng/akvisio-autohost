import { NextRequest, NextResponse } from "next/server";
import type { PoolClient } from "pg";
import { getSession } from "@/lib/auth";
import { getPool } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const financeRoles = ["owner", "admin", "manager", "finance"];
const staffRoles = [...financeRoles, "staff"];
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Autentikasi diperlukan." }, { status: 401 });
  const from = request.nextUrl.searchParams.get("from");
  const to = request.nextUrl.searchParams.get("to");
  if ((from && !/^\d{4}-\d{2}-\d{2}$/.test(from)) || (to && !/^\d{4}-\d{2}-\d{2}$/.test(to))) {
    return NextResponse.json({ error: "Rentang tanggal harus berformat YYYY-MM-DD." }, { status: 400 });
  }
  if (from && to && from > to) return NextResponse.json({ error: "Tanggal awal tidak boleh melewati tanggal akhir." }, { status: 400 });

  try {
    const pool = getPool();
    const params = [session.organizationId, from || null, to || null];
    const [summary, payments, expenses] = await Promise.all([
      pool.query(
        `SELECT
          COALESCE(SUM(CASE WHEN p.status = 'verified' AND p.payment_type <> 'refund' THEN p.amount
                            WHEN p.status = 'verified' AND p.payment_type = 'refund' THEN -p.amount ELSE 0 END), 0)::numeric AS net_received,
          COALESCE(SUM(CASE WHEN p.status = 'pending' THEN p.amount ELSE 0 END), 0)::numeric AS pending_payments,
          COALESCE(SUM(CASE WHEN p.status = 'verified' THEN 1 ELSE 0 END), 0)::int AS verified_count,
          COALESCE((SELECT SUM(e.amount) FROM expenses e WHERE e.organization_id = $1
            AND ($2::date IS NULL OR e.spent_at >= $2::date)
            AND ($3::date IS NULL OR e.spent_at <= $3::date)), 0)::numeric AS expenses_total
         FROM payments p
         WHERE p.organization_id = $1
           AND ($2::date IS NULL OR p.created_at::date >= $2::date)
           AND ($3::date IS NULL OR p.created_at::date <= $3::date)`,
        params,
      ),
      pool.query(
        `SELECT p.id, p.booking_id, p.invoice_id, p.provider, p.provider_reference, p.amount,
                p.payment_type, p.status, p.created_at, p.verified_at,
                b.booking_code, c.full_name AS customer_name
         FROM payments p
         LEFT JOIN bookings b ON b.id = p.booking_id AND b.organization_id = p.organization_id
         LEFT JOIN customers c ON c.id = b.customer_id AND c.organization_id = b.organization_id
         WHERE p.organization_id = $1
           AND ($2::date IS NULL OR p.created_at::date >= $2::date)
           AND ($3::date IS NULL OR p.created_at::date <= $3::date)
         ORDER BY p.created_at DESC LIMIT 100`,
        params,
      ),
      pool.query(
        `SELECT e.id, e.vehicle_id, e.booking_id, e.category, e.description, e.amount, e.spent_at, e.created_at,
                v.registration_number, b.booking_code
         FROM expenses e
         LEFT JOIN vehicles v ON v.id = e.vehicle_id AND v.organization_id = e.organization_id
         LEFT JOIN bookings b ON b.id = e.booking_id AND b.organization_id = e.organization_id
         WHERE e.organization_id = $1
           AND ($2::date IS NULL OR e.spent_at >= $2::date)
           AND ($3::date IS NULL OR e.spent_at <= $3::date)
         ORDER BY e.spent_at DESC, e.created_at DESC LIMIT 100`,
        params,
      ),
    ]);
    return NextResponse.json({ summary: summary.rows[0], payments: payments.rows, expenses: expenses.rows });
  } catch (error) {
    console.error("Finance workspace load failed", error instanceof Error ? error.message : "unknown error");
    return NextResponse.json({ error: "Data keuangan belum dapat dimuat." }, { status: 503 });
  }
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Autentikasi diperlukan." }, { status: 401 });
  if (!staffRoles.includes(session.role)) return NextResponse.json({ error: "Akses pencatatan keuangan tidak diizinkan." }, { status: 403 });

  let body: {
    kind?: string; bookingId?: string; invoiceId?: string; vehicleId?: string;
    amount?: number | string; paymentType?: string; provider?: string;
    providerReference?: string; category?: string; description?: string; spentAt?: string;
  };
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: "Format permintaan tidak valid." }, { status: 400 }); }

  const amount = Number(body.amount);
  if (!Number.isFinite(amount) || amount <= 0 || amount > 1_000_000_000_000) {
    return NextResponse.json({ error: "Nominal harus lebih dari Rp0 dan tidak melebihi Rp1 triliun." }, { status: 400 });
  }

  let bookingId = body.bookingId?.trim() || null;
  const invoiceId = body.invoiceId?.trim() || null;
  const vehicleId = body.vehicleId?.trim() || null;
  if ([bookingId, invoiceId, vehicleId].some((id) => id && !uuidPattern.test(id))) {
    return NextResponse.json({ error: "Referensi transaksi tidak valid." }, { status: 400 });
  }

  if (body.kind === "payment") {
    if (!bookingId && !invoiceId) return NextResponse.json({ error: "Pembayaran harus terkait pemesanan atau invoice." }, { status: 400 });
    const paymentType = body.paymentType || "rental";
    if (!["rental", "deposit", "refund", "extra_charge"].includes(paymentType)) {
      return NextResponse.json({ error: "Jenis pembayaran tidak valid." }, { status: 400 });
    }
    const provider = body.provider?.trim() || "manual";
    const providerReference = body.providerReference?.trim() || null;
    if (provider.length > 80 || (providerReference && providerReference.length > 180)) {
      return NextResponse.json({ error: "Nama provider maksimal 80 karakter dan referensi maksimal 180 karakter." }, { status: 400 });
    }
    if (paymentType === "refund" && !financeRoles.includes(session.role)) {
      return NextResponse.json({ error: "Hanya bagian keuangan atau manajemen yang dapat mencatat pengembalian dana." }, { status: 403 });
    }
    let client: PoolClient | undefined;
    try {
      client = await getPool().connect();
      await client.query("BEGIN");
      if (bookingId) {
        const found = await client.query("SELECT id FROM bookings WHERE id = $1 AND organization_id = $2 FOR SHARE", [bookingId, session.organizationId]);
        if (!found.rows[0]) { await client.query("ROLLBACK"); return NextResponse.json({ error: "Pemesanan tidak ditemukan pada organisasi ini." }, { status: 404 }); }
      }
      if (invoiceId) {
        const found = await client.query("SELECT id, booking_id, status FROM invoices WHERE id = $1 AND organization_id = $2 FOR SHARE", [invoiceId, session.organizationId]);
        if (!found.rows[0]) { await client.query("ROLLBACK"); return NextResponse.json({ error: "Invoice tidak ditemukan pada organisasi ini." }, { status: 404 }); }
        if (["void", "paid"].includes(found.rows[0].status)) { await client.query("ROLLBACK"); return NextResponse.json({ error: "Invoice sudah lunas atau dibatalkan." }, { status: 409 }); }
        const invoiceBookingId = found.rows[0].booking_id as string | null;
        if (bookingId && invoiceBookingId && bookingId !== invoiceBookingId) {
          await client.query("ROLLBACK");
          return NextResponse.json({ error: "Invoice dan pemesanan yang dipilih tidak saling terkait." }, { status: 409 });
        }
        if (!bookingId && invoiceBookingId) bookingId = invoiceBookingId;
      }
      const inserted = await client.query(
        `INSERT INTO payments (organization_id, booking_id, invoice_id, provider, provider_reference, amount, payment_type, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending')
         RETURNING id, booking_id, invoice_id, provider, provider_reference, amount, payment_type, status, created_at`,
        [session.organizationId, bookingId, invoiceId, provider, providerReference, amount, paymentType],
      );
      await client.query(
        "INSERT INTO audit_logs (organization_id, actor_user_id, actor_type, action, entity_type, entity_id, details) VALUES ($1, $2, 'user', 'payment.recorded_pending', 'payment', $3, $4::jsonb)",
        [session.organizationId, session.userId, inserted.rows[0].id, JSON.stringify({ amount, paymentType, provider })],
      );
      await client.query("COMMIT");
      return NextResponse.json({ data: inserted.rows[0], message: "Pembayaran dicatat sebagai menunggu verifikasi." }, { status: 201 });
    } catch (error) {
      if (client) await client.query("ROLLBACK").catch(() => undefined);
      console.error("Payment record failed", error instanceof Error ? error.message : "unknown error");
      return NextResponse.json({ error: "Pembayaran gagal dicatat." }, { status: 503 });
    } finally { client?.release(); }
  }

  if (body.kind === "expense") {
    if (!financeRoles.includes(session.role)) return NextResponse.json({ error: "Hanya bagian keuangan atau manajemen yang dapat mencatat pengeluaran." }, { status: 403 });
    const category = body.category?.trim();
    const description = body.description?.trim();
    const spentAt = body.spentAt || new Date().toISOString().slice(0, 10);
    if (!category || category.length > 80 || !description || description.length > 500) {
      return NextResponse.json({ error: "Kategori wajib diisi (maksimal 80 karakter) dan keterangan maksimal 500 karakter." }, { status: 400 });
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(spentAt) || !Number.isFinite(Date.parse(`${spentAt}T00:00:00Z`))) {
      return NextResponse.json({ error: "Tanggal pengeluaran tidak valid." }, { status: 400 });
    }
    let client: PoolClient | undefined;
    try {
      client = await getPool().connect();
      await client.query("BEGIN");
      if (vehicleId) {
        const found = await client.query("SELECT id FROM vehicles WHERE id = $1 AND organization_id = $2 FOR SHARE", [vehicleId, session.organizationId]);
        if (!found.rows[0]) { await client.query("ROLLBACK"); return NextResponse.json({ error: "Kendaraan tidak ditemukan pada organisasi ini." }, { status: 404 }); }
      }
      if (bookingId) {
        const found = await client.query("SELECT id FROM bookings WHERE id = $1 AND organization_id = $2 FOR SHARE", [bookingId, session.organizationId]);
        if (!found.rows[0]) { await client.query("ROLLBACK"); return NextResponse.json({ error: "Pemesanan tidak ditemukan pada organisasi ini." }, { status: 404 }); }
      }
      const inserted = await client.query(
        `INSERT INTO expenses (organization_id, vehicle_id, booking_id, category, description, amount, spent_at, recorded_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7::date, $8)
         RETURNING id, vehicle_id, booking_id, category, description, amount, spent_at, created_at`,
        [session.organizationId, vehicleId, bookingId, category, description, amount, spentAt, session.userId],
      );
      await client.query(
        "INSERT INTO audit_logs (organization_id, actor_user_id, actor_type, action, entity_type, entity_id, details) VALUES ($1, $2, 'user', 'expense.created', 'expense', $3, $4::jsonb)",
        [session.organizationId, session.userId, inserted.rows[0].id, JSON.stringify({ amount, category, spentAt })],
      );
      await client.query("COMMIT");
      return NextResponse.json({ data: inserted.rows[0] }, { status: 201 });
    } catch (error) {
      if (client) await client.query("ROLLBACK").catch(() => undefined);
      console.error("Expense record failed", error instanceof Error ? error.message : "unknown error");
      return NextResponse.json({ error: "Pengeluaran gagal dicatat." }, { status: 503 });
    } finally { client?.release(); }
  }

  return NextResponse.json({ error: "Jenis transaksi harus payment atau expense." }, { status: 400 });
}
