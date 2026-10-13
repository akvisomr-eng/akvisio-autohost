import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getPool } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Autentikasi diperlukan." }, { status: 401 });

  const search = request.nextUrl.searchParams.get("q")?.trim().slice(0, 100);
  try {
    const result = await getPool().query(
      `SELECT id, full_name, whatsapp_number, email, preferred_locale, consent_marketing_at, notes, created_at
       FROM customers
       WHERE organization_id = $1
         AND ($2::text IS NULL OR full_name ILIKE '%' || $2 || '%' OR whatsapp_number ILIKE '%' || $2 || '%' OR COALESCE(email, '') ILIKE '%' || $2 || '%')
       ORDER BY created_at DESC
       LIMIT 100`,
      [session.organizationId, search || null],
    );
    return NextResponse.json({ data: result.rows });
  } catch (error) {
    console.error("Customer list failed", error instanceof Error ? error.message : "unknown error");
    return NextResponse.json({ error: "Data pelanggan belum dapat dimuat." }, { status: 503 });
  }
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Autentikasi diperlukan." }, { status: 401 });
  if (!["owner", "admin", "manager", "staff"].includes(session.role)) {
    return NextResponse.json({ error: "Akses tidak diizinkan." }, { status: 403 });
  }

  let body: { fullName?: string; whatsappNumber?: string; email?: string; preferredLocale?: string; notes?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Format permintaan tidak valid." }, { status: 400 });
  }

  const fullName = body.fullName?.trim() || null;
  const whatsappNumber = body.whatsappNumber?.trim().replace(/[\s()-]/g, "");
  const email = body.email?.trim().toLowerCase() || null;
  const preferredLocale = body.preferredLocale?.trim() || "id-ID";
  const notes = body.notes?.trim() || null;

  if (!whatsappNumber || whatsappNumber.length > 20 || !/^\+?[0-9]{8,18}$/.test(whatsappNumber)) {
    return NextResponse.json({ error: "Nomor WhatsApp harus berisi 8–18 digit dan boleh diawali tanda +." }, { status: 400 });
  }
  if (fullName && fullName.length > 160) return NextResponse.json({ error: "Nama maksimal 160 karakter." }, { status: 400 });
  if (email && (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) {
    return NextResponse.json({ error: "Alamat email tidak valid." }, { status: 400 });
  }
  if (!["id-ID", "en-US", "en-GB", "ms-MY"].includes(preferredLocale)) {
    return NextResponse.json({ error: "Bahasa pilihan belum didukung." }, { status: 400 });
  }
  if (notes && notes.length > 2000) return NextResponse.json({ error: "Catatan maksimal 2.000 karakter." }, { status: 400 });

  try {
    const result = await getPool().query(
      `INSERT INTO customers (organization_id, full_name, whatsapp_number, email, preferred_locale, notes)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (organization_id, whatsapp_number) DO NOTHING
       RETURNING id, full_name, whatsapp_number, email, preferred_locale, notes, created_at`,
      [session.organizationId, fullName, whatsappNumber, email, preferredLocale, notes],
    );
    if (!result.rows[0]) {
      return NextResponse.json({ error: "Nomor WhatsApp sudah terdaftar pada organisasi ini." }, { status: 409 });
    }
    await getPool().query(
      "INSERT INTO audit_logs (organization_id, actor_user_id, actor_type, action, entity_type, entity_id) VALUES ($1, $2, 'user', 'customer.created', 'customer', $3)",
      [session.organizationId, session.userId, result.rows[0].id],
    );
    return NextResponse.json({ data: result.rows[0] }, { status: 201 });
  } catch (error) {
    console.error("Customer create failed", error instanceof Error ? error.message : "unknown error");
    return NextResponse.json({ error: "Pelanggan gagal disimpan." }, { status: 503 });
  }
}
