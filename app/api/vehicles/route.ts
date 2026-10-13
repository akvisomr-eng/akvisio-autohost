import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getPool } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Autentikasi diperlukan." }, { status: 401 });

  try {
    const result = await getPool().query(
      `SELECT id, registration_number, make, model, model_year, transmission, seats, service_mode,
              status, daily_rate, overtime_rate, odometer_km, notes, created_at
       FROM vehicles
       WHERE organization_id = $1
       ORDER BY registration_number ASC
       LIMIT 250`,
      [session.organizationId],
    );
    return NextResponse.json({ data: result.rows });
  } catch (error) {
    console.error("Vehicle list failed", error instanceof Error ? error.message : "unknown error");
    return NextResponse.json({ error: "Data armada belum dapat dimuat." }, { status: 503 });
  }
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Autentikasi diperlukan." }, { status: 401 });
  if (!["owner", "admin", "manager"].includes(session.role)) {
    return NextResponse.json({ error: "Hanya pemilik, admin, atau manajer yang dapat menambah kendaraan." }, { status: 403 });
  }

  let body: {
    registrationNumber?: string; make?: string; model?: string; modelYear?: number | string;
    transmission?: string; seats?: number | string; serviceMode?: string; dailyRate?: number | string;
    overtimeRate?: number | string; odometerKm?: number | string; notes?: string;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Format permintaan tidak valid." }, { status: 400 });
  }

  const registrationNumber = body.registrationNumber?.trim().toUpperCase();
  const make = body.make?.trim();
  const model = body.model?.trim();
  const modelYear = body.modelYear === undefined || body.modelYear === "" ? null : Number(body.modelYear);
  const transmission = body.transmission || "other";
  const seats = body.seats === undefined || body.seats === "" ? null : Number(body.seats);
  const serviceMode = body.serviceMode || "both";
  const dailyRate = body.dailyRate === undefined || body.dailyRate === "" ? 0 : Number(body.dailyRate);
  const overtimeRate = body.overtimeRate === undefined || body.overtimeRate === "" ? 0 : Number(body.overtimeRate);
  const odometerKm = body.odometerKm === undefined || body.odometerKm === "" ? 0 : Number(body.odometerKm);
  const notes = body.notes?.trim() || null;

  if (!registrationNumber || registrationNumber.length > 20 || !/^[A-Z0-9 -]+$/.test(registrationNumber)) {
    return NextResponse.json({ error: "Nomor polisi wajib diisi dan hanya boleh berisi huruf, angka, spasi, atau tanda hubung." }, { status: 400 });
  }
  if (!make || make.length > 80 || !model || model.length > 80) {
    return NextResponse.json({ error: "Merek dan model kendaraan wajib diisi (maksimal 80 karakter)." }, { status: 400 });
  }
  if (modelYear !== null && (!Number.isInteger(modelYear) || modelYear < 1950 || modelYear > new Date().getFullYear() + 2)) {
    return NextResponse.json({ error: "Tahun kendaraan tidak valid." }, { status: 400 });
  }
  if (!["automatic", "manual", "other"].includes(transmission)) {
    return NextResponse.json({ error: "Jenis transmisi tidak valid." }, { status: 400 });
  }
  if (seats !== null && (!Number.isInteger(seats) || seats < 1 || seats > 100)) {
    return NextResponse.json({ error: "Jumlah kursi harus antara 1 dan 100." }, { status: 400 });
  }
  if (!["self_drive", "chauffeur", "both"].includes(serviceMode)) {
    return NextResponse.json({ error: "Jenis layanan tidak valid." }, { status: 400 });
  }
  if (![dailyRate, overtimeRate].every((n) => Number.isFinite(n) && n >= 0 && n <= 1_000_000_000)) {
    return NextResponse.json({ error: "Tarif tidak valid." }, { status: 400 });
  }
  if (!Number.isInteger(odometerKm) || odometerKm < 0 || odometerKm > 100_000_000) {
    return NextResponse.json({ error: "Kilometer kendaraan tidak valid." }, { status: 400 });
  }
  if (notes && notes.length > 2000) return NextResponse.json({ error: "Catatan maksimal 2.000 karakter." }, { status: 400 });

  let client: Awaited<ReturnType<ReturnType<typeof getPool>["connect"]>> | undefined;
  try {
    client = await getPool().connect();
    await client.query("BEGIN");
    const result = await client.query(
      `INSERT INTO vehicles
       (organization_id, registration_number, make, model, model_year, transmission, seats, service_mode, daily_rate, overtime_rate, odometer_km, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       ON CONFLICT (organization_id, registration_number) DO NOTHING
       RETURNING id, registration_number, make, model, model_year, transmission, seats, service_mode, status, daily_rate, overtime_rate, odometer_km, notes, created_at`,
      [session.organizationId, registrationNumber, make, model, modelYear, transmission, seats, serviceMode, dailyRate, overtimeRate, odometerKm, notes],
    );
    if (!result.rows[0]) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "Nomor polisi sudah terdaftar pada organisasi ini." }, { status: 409 });
    }
    await client.query(
      "INSERT INTO audit_logs (organization_id, actor_user_id, actor_type, action, entity_type, entity_id) VALUES ($1, $2, 'user', 'vehicle.created', 'vehicle', $3)",
      [session.organizationId, session.userId, result.rows[0].id],
    );
    await client.query("COMMIT");
    return NextResponse.json({ data: result.rows[0] }, { status: 201 });
  } catch (error) {
    if (client) await client.query("ROLLBACK").catch(() => undefined);
    console.error("Vehicle create failed", error instanceof Error ? error.message : "unknown error");
    return NextResponse.json({ error: "Kendaraan gagal disimpan." }, { status: 503 });
  } finally {
    client?.release();
  }
}
