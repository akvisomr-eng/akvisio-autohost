import { NextRequest, NextResponse } from "next/server";
import { getPool } from "@/lib/db";
import { createSessionToken, SESSION_COOKIE, sessionCookieOptions, verifyPassword } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  let body: { email?: string; password?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Format permintaan tidak valid." }, { status: 400 });
  }

  const email = body.email?.trim().toLowerCase();
  const password = body.password;
  if (!email || email.length > 254 || typeof password !== "string" || password.length > 256) {
    return NextResponse.json({ error: "Email atau kata sandi tidak valid." }, { status: 400 });
  }

  try {
    const pool = getPool();
    const result = await pool.query<{
      id: string;
      organization_id: string;
      email: string;
      full_name: string;
      role: string;
      password_hash: string | null;
      is_active: boolean;
    }>(
      `SELECT u.id, u.organization_id, u.email, u.full_name, u.role, u.password_hash, u.is_active
       FROM users u
       JOIN organizations o ON o.id = u.organization_id
       WHERE lower(u.email) = $1 AND o.slug = $2
       LIMIT 1`,
      [email, "sans-rent-cars"],
    );
    const user = result.rows[0];
    if (!user || !user.is_active || !verifyPassword(password, user.password_hash)) {
      return NextResponse.json({ error: "Email atau kata sandi salah." }, { status: 401 });
    }

    const token = createSessionToken({
      userId: user.id,
      organizationId: user.organization_id,
      email: user.email,
      fullName: user.full_name,
      role: user.role,
    });
    await pool.query("UPDATE users SET last_login_at = now() WHERE id = $1", [user.id]);

    const response = NextResponse.json({
      status: "authenticated",
      user: { id: user.id, email: user.email, fullName: user.full_name, role: user.role },
    });
    response.cookies.set(SESSION_COOKIE, token, sessionCookieOptions);
    return response;
  } catch (error) {
    console.error("Admin login failed", error instanceof Error ? error.message : "unknown error");
    return NextResponse.json({ error: "Login belum tersedia. Periksa konfigurasi SESSION_SECRET dan database." }, { status: 503 });
  }
}
