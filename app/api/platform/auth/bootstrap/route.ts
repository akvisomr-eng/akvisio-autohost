import { createHash, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { hashPassword } from "@/lib/auth";
import { getPool } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function secretMatches(supplied: string, expected: string) {
  const a = Buffer.from(supplied);
  const b = Buffer.from(expected);
  return a.length === b.length && a.length > 0 && timingSafeEqual(a, b);
}

export async function POST(request: NextRequest) {
  const configured = process.env.PLATFORM_BOOTSTRAP_SECRET;
  if (!configured || configured.length < 32) {
    return NextResponse.json({ error: "Bootstrap Super Admin belum dikonfigurasi." }, { status: 503 });
  }
  let body: { secret?: unknown; email?: unknown; fullName?: unknown; password?: unknown };
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: "Format permintaan tidak valid." }, { status: 400 }); }

  const suppliedSecret = typeof body.secret === "string" ? body.secret : "";
  if (!secretMatches(suppliedSecret, configured)) {
    return NextResponse.json({ error: "Bootstrap ditolak." }, { status: 403 });
  }
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const fullName = typeof body.fullName === "string" ? body.fullName.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    return NextResponse.json({ error: "Email tidak valid." }, { status: 400 });
  }
  if (!fullName || fullName.length > 160) return NextResponse.json({ error: "Nama wajib diisi (maksimal 160 karakter)." }, { status: 400 });
  if (password.length < 14 || password.length > 256) return NextResponse.json({ error: "Kata sandi harus 14–256 karakter." }, { status: 400 });

  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const lockKey = createHash("sha256").update("akvisio-platform-admin-bootstrap").digest().readBigInt64BE(0).toString();
    await client.query("SELECT pg_advisory_xact_lock($1::bigint)", [lockKey]);
    const existing = await client.query("SELECT COUNT(*)::int AS count FROM platform_admins");
    if (Number(existing.rows[0]?.count || 0) > 0) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "Bootstrap hanya dapat digunakan sebelum Super Admin pertama dibuat." }, { status: 409 });
    }
    const result = await client.query(
      "INSERT INTO platform_admins (email, full_name, password_hash) VALUES ($1, $2, $3) RETURNING id, email, full_name",
      [email, fullName, hashPassword(password)],
    );
    const admin = result.rows[0];
    await client.query(
      "INSERT INTO platform_audit_logs (platform_admin_id, actor_type, action, entity_type, entity_id, details) VALUES (NULL, 'system', 'platform_admin.bootstrap.created', 'platform_admin', $1, $2::jsonb)",
      [admin.id, JSON.stringify({ email, method: "one_time_bootstrap" })],
    );
    await client.query("COMMIT");
    return NextResponse.json({ data: { id: admin.id, email: admin.email, fullName: admin.full_name }, message: "Super Admin dibuat. Silakan masuk melalui halaman platform." }, { status: 201 });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    console.error("Platform admin bootstrap failed", error instanceof Error ? error.message : "unknown error");
    return NextResponse.json({ error: "Bootstrap Super Admin gagal." }, { status: 503 });
  } finally { client.release(); }
}
