import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getPool } from "@/lib/db";
import { hashPassword } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function secretMatches(provided: string, expected: string) {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(request: NextRequest) {
  const expectedSecret = process.env.BOOTSTRAP_SECRET;
  if (!expectedSecret || expectedSecret.length < 24) {
    return NextResponse.json({ error: "Bootstrap tidak diaktifkan. Konfigurasikan BOOTSTRAP_SECRET yang kuat." }, { status: 503 });
  }

  let body: { secret?: string; email?: string; fullName?: string; password?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Format permintaan tidak valid." }, { status: 400 });
  }

  if (typeof body.secret !== "string" || !secretMatches(body.secret, expectedSecret)) {
    return NextResponse.json({ error: "Tidak diizinkan." }, { status: 401 });
  }

  const email = body.email?.trim().toLowerCase();
  const fullName = body.fullName?.trim();
  const password = body.password;
  if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: "Alamat email tidak valid." }, { status: 400 });
  }
  if (!fullName || fullName.length > 120) {
    return NextResponse.json({ error: "Nama lengkap wajib diisi (maksimal 120 karakter)." }, { status: 400 });
  }
  if (typeof password !== "string" || password.length < 12 || password.length > 256) {
    return NextResponse.json({ error: "Kata sandi harus terdiri dari 12–256 karakter." }, { status: 400 });
  }

  try {
    const pool = getPool();
    const org = await pool.query<{ id: string }>("SELECT id FROM organizations WHERE slug = $1 LIMIT 1", ["sans-rent-cars"]);
    if (!org.rows[0]) return NextResponse.json({ error: "Organisasi Sans Rent Cars belum tersedia." }, { status: 503 });

    const existing = await pool.query<{ id: string }>(
      "SELECT id FROM users WHERE organization_id = $1 AND role IN ('owner','admin') LIMIT 1",
      [org.rows[0].id],
    );
    if (existing.rows[0]) {
      return NextResponse.json({ error: "Admin awal sudah dibuat. Gunakan halaman login." }, { status: 409 });
    }

    const created = await pool.query<{ id: string; email: string; full_name: string; role: string }>(
      "INSERT INTO users (organization_id, email, full_name, role, password_hash) VALUES ($1, $2, $3, 'owner', $4) RETURNING id, email, full_name, role",
      [org.rows[0].id, email, fullName, hashPassword(password)],
    );
    return NextResponse.json({ status: "created", user: created.rows[0] }, { status: 201 });
  } catch (error) {
    console.error("Admin bootstrap failed", error instanceof Error ? error.message : "unknown error");
    return NextResponse.json({ error: "Bootstrap gagal. Periksa konfigurasi aplikasi dan database." }, { status: 503 });
  }
}
