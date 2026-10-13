import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import type { PoolClient } from "pg";
import { getSession } from "@/lib/auth";
import { getPool } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";


export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Autentikasi diperlukan." }, { status: 401 });

  const from = request.nextUrl.searchParams.get("from");
  const to = request.nextUrl.searchParams.get("to");
  if ((from && !Number.isFinite(Date.parse(from))) || (to && !Number.isFinite(Date.parse(to)))) {
    return NextResponse.json({ error: "Rentang tanggal tidak valid." }, { status: 400 });
  }

  try {
    const result = await getPool().query(
      `SELECT b.id, b.booking_code, b.customer_id, b.vehicle_id, b.service_mode,
              b.pickup_at, b.return_at, b.pickup_location, b.return_location, b.status,
              b.daily_rate, b.estimated_total, b.deposit_amount, b.payment_status, b.notes, b.created_at,
              c.full_name AS customer_name, c.whatsapp_number,
              v.registration_number, v.make, v.model
       FROM bookings b
       JOIN customers c ON c.id = b.customer_id AND c.organization_id = b.organization_id
       JOIN vehicles v ON v.id = b.vehicle_id AND v.organization_id = b.organization_id
       WHERE b.organization_id = $1
         AND ($2::timestamptz IS NULL OR b.return_at >= $2)
         AND ($3::timestamptz IS NULL OR b.pickup_at <= $3)
       ORDER BY b.pickup_at DESC
       LIMIT 250`,
      [session.organizationId, from || null, to || null],
    );
    return NextResponse.json({ data: result.rows });
  } catch (error) {
    console.error("Booking list failed", error instanceof Error ? error.message : "unknown error");
    return NextResponse.json({ error: "Data pemesanan belum dapat dimuat." }, { status: 503 });
  }
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Autentikasi diperlukan." }, { status: 401 });
  if (!["owner", "admin", "manager", "staff"].includes(session.role)) {
    return NextResponse.json({ error: "Peran Anda tidak diizinkan membuat pemesanan." }, { status: 403 });
  }

  let body: {
    customerId?: string;
    vehicleId?: string;
    serviceMode?: string;
    pickupAt?: string;
    returnAt?: string;
    pickupLocation?: string;
    returnLocation?: string;
    depositAmount?: number | string;
    notes?: string;
    idempotencyKey?: string;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Format permintaan tidak valid." }, { status: 400 });
  }

  const customerId = body.customerId?.trim();
  const vehicleId = body.vehicleId?.trim();
  const serviceMode = body.serviceMode;
  const pickupAt = body.pickupAt ? new Date(body.pickupAt) : null;
  const returnAt = body.returnAt ? new Date(body.returnAt) : null;
  const pickupLocation = body.pickupLocation?.trim() || null;
  const returnLocation = body.returnLocation?.trim() || null;
  const depositAmount = body.depositAmount === undefined || body.depositAmount === "" ? 0 : Number(body.depositAmount);
  const notes = body.notes?.trim() || null;
  const idempotencyKey = body.idempotencyKey?.trim() || randomUUID();

  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!customerId || !uuidPattern.test(customerId) || !vehicleId || !uuidPattern.test(vehicleId)) {
    return NextResponse.json({ error: "Pilih pelanggan dan kendaraan yang valid." }, { status: 400 });
  }
  if (!["self_drive", "chauffeur"].includes(serviceMode || "")) {
    return NextResponse.json({ error: "Pilih layanan lepas kunci atau dengan sopir." }, { status: 400 });
  }
  if (!pickupAt || !returnAt || !Number.isFinite(pickupAt.getTime()) || !Number.isFinite(returnAt.getTime()) || returnAt <= pickupAt) {
    return NextResponse.json({ error: "Waktu pengambilan dan pengembalian tidak valid." }, { status: 400 });
  }
  if (pickupAt.getTime() < Date.now() - 5 * 60 * 1000) {
    return NextResponse.json({ error: "Waktu pengambilan tidak boleh berada di masa lalu." }, { status: 400 });
  }
  if (![depositAmount].every((n) => Number.isFinite(n) && n >= 0 && n <= 1_000_000_000)) {
    return NextResponse.json({ error: "Nominal deposit tidak valid." }, { status: 400 });
  }
  if (idempotencyKey.length > 120 || !/^[a-zA-Z0-9._:-]+$/.test(idempotencyKey)) {
    return NextResponse.json({ error: "Kunci idempotensi tidak valid." }, { status: 400 });
  }
  if ([pickupLocation, returnLocation].some((value) => value && value.length > 250) || (notes && notes.length > 2000)) {
    return NextResponse.json({ error: "Lokasi maksimal 250 karakter dan catatan maksimal 2.000 karakter." }, { status: 400 });
  }

  let client: PoolClient | undefined;
  try {
    client = await getPool().connect();
    await client.query("BEGIN");
    // Serialize retries that use the same organization-scoped idempotency key.
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))", [session.organizationId, idempotencyKey]);

    const existing = await client.query(
      `SELECT id, booking_code, status, estimated_total, pickup_at, return_at
       FROM bookings WHERE organization_id = $1 AND idempotency_key = $2 LIMIT 1`,
      [session.organizationId, idempotencyKey],
    );
    if (existing.rows[0]) {
      await client.query("COMMIT");
      return NextResponse.json({ data: existing.rows[0], idempotentReplay: true }, { status: 200 });
    }

    const refs = await client.query(
      `SELECT c.id AS customer_id, v.id AS vehicle_id, v.registration_number,
              v.make, v.model, v.status AS vehicle_status, v.service_mode AS vehicle_service_mode,
              v.daily_rate, v.organization_id
       FROM customers c
       CROSS JOIN vehicles v
       WHERE c.id = $1 AND c.organization_id = $3
         AND v.id = $2 AND v.organization_id = $3
       FOR UPDATE OF v`,
      [customerId, vehicleId, session.organizationId],
    );
    const ref = refs.rows[0];
    if (!ref) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "Pelanggan atau kendaraan tidak ditemukan pada organisasi Anda." }, { status: 404 });
    }
    if (ref.vehicle_status !== "available") {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "Kendaraan tidak berstatus tersedia." }, { status: 409 });
    }
    if (ref.vehicle_service_mode !== "both" && ref.vehicle_service_mode !== serviceMode) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "Jenis layanan tidak sesuai dengan konfigurasi kendaraan." }, { status: 400 });
    }

    const durationMs = returnAt.getTime() - pickupAt.getTime();
    const rentalDays = Math.max(1, Math.ceil(durationMs / 86_400_000));
    const dailyRate = Number(ref.daily_rate);
    const estimatedTotal = Math.round(dailyRate * rentalDays * 100) / 100;
    if (!Number.isFinite(estimatedTotal) || estimatedTotal > 9_999_999_999_999) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "Total estimasi melewati batas yang didukung." }, { status: 400 });
    }

    const bookingCode = `SRC-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${randomUUID().slice(0, 8).toUpperCase()}`;
    const created = await client.query(
      `INSERT INTO bookings
       (organization_id, booking_code, customer_id, vehicle_id, service_mode, pickup_at, return_at,
        pickup_location, return_location, status, daily_rate, estimated_total, deposit_amount, notes, idempotency_key)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'pending', $10, $11, $12, $13, $14)
       RETURNING id, booking_code, customer_id, vehicle_id, service_mode, pickup_at, return_at,
                 pickup_location, return_location, status, daily_rate, estimated_total, deposit_amount,
                 payment_status, notes, created_at`,
      [session.organizationId, bookingCode, customerId, vehicleId, serviceMode, pickupAt.toISOString(), returnAt.toISOString(),
       pickupLocation, returnLocation, dailyRate, estimatedTotal, depositAmount, notes, idempotencyKey],
    );
    await client.query(
      "INSERT INTO audit_logs (organization_id, actor_user_id, actor_type, action, entity_type, entity_id) VALUES ($1, $2, 'user', 'booking.created', 'booking', $3)",
      [session.organizationId, session.userId, created.rows[0].id],
    );
    await client.query("COMMIT");
    return NextResponse.json({ data: { ...created.rows[0], rentalDays, customer_name: null, registration_number: ref.registration_number, make: ref.make, model: ref.model } }, { status: 201 });
  } catch (error) {
    if (client) await client.query("ROLLBACK").catch(() => undefined);
    const pgError = error as { code?: string; constraint?: string };
    if (pgError.code === "23P01" && pgError.constraint === "bookings_no_overlapping_vehicle_time") {
      return NextResponse.json({ error: "Kendaraan sudah memiliki pemesanan pada rentang waktu tersebut. Pilih kendaraan atau jadwal lain." }, { status: 409 });
    }
    if (pgError.code === "23505") {
      return NextResponse.json({ error: "Permintaan duplikat terdeteksi. Muat ulang data sebelum mencoba kembali." }, { status: 409 });
    }
    console.error("Booking create failed", error instanceof Error ? error.message : "unknown error");
    return NextResponse.json({ error: "Pemesanan gagal disimpan." }, { status: 503 });
  } finally {
    client?.release();
  }
}
