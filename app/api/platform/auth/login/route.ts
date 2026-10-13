import { NextRequest, NextResponse } from "next/server";
import { verifyPassword } from "@/lib/auth";
import { createPlatformSessionToken, PLATFORM_SESSION_COOKIE, platformSessionCookieOptions } from "@/lib/platform-auth";
import { getPool } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  if (!process.env.PLATFORM_SESSION_SECRET || process.env.PLATFORM_SESSION_SECRET.length < 32) {
    return NextResponse.json({ error: "Sesi Super Admin belum dikonfigurasi." }, { status: 503 });
  }
  let body: { email?: unknown; password?: unknown };
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: "Format permintaan tidak valid." }, { status: 400 }); }
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (!email || email.length > 254 || !password || password.length > 256) {
    return NextResponse.json({ error: "Email atau kata sandi tidak valid." }, { status: 400 });
  }

  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(
      "SELECT id, email, full_name, password_hash, is_active, failed_login_count, locked_until FROM platform_admins WHERE lower(email) = $1 LIMIT 1 FOR UPDATE",
      [email],
    );
    const admin = result.rows[0];
    if (admin?.locked_until && new Date(admin.locked_until).getTime() > Date.now()) {
      await client.query("COMMIT");
      return NextResponse.json({ error: "Login sementara dikunci. Coba lagi nanti." }, { status: 429 });
    }
    const valid = Boolean(admin?.is_active) && verifyPassword(password, admin?.password_hash);
    if (!valid) {
      if (admin) {
        await client.query(
          `UPDATE platform_admins
           SET failed_login_count = CASE WHEN locked_until IS NOT NULL AND locked_until <= now() THEN 1 ELSE failed_login_count + 1 END,
               locked_until = CASE WHEN (CASE WHEN locked_until IS NOT NULL AND locked_until <= now() THEN 1 ELSE failed_login_count + 1 END) >= 5
                 THEN now() + interval '15 minutes' ELSE NULL END,
               updated_at = now()
           WHERE id = $1`,
          [admin.id],
        );
      }
      await client.query("COMMIT");
      return NextResponse.json({ error: "Email atau kata sandi salah." }, { status: 401 });
    }

    await client.query(
      "UPDATE platform_admins SET failed_login_count = 0, locked_until = NULL, last_login_at = now(), updated_at = now() WHERE id = $1",
      [admin.id],
    );
    await client.query(
      "INSERT INTO platform_audit_logs (platform_admin_id, actor_type, action, entity_type, entity_id, details) VALUES ($1, 'platform_admin', 'platform_admin.login.succeeded', 'platform_admin', $1, '{}'::jsonb)",
      [admin.id],
    );
    await client.query("COMMIT");
    const token = createPlatformSessionToken({ platformAdminId: admin.id, email: admin.email, fullName: admin.full_name });
    const response = NextResponse.json({ data: { id: admin.id, email: admin.email, fullName: admin.full_name } });
    response.cookies.set(PLATFORM_SESSION_COOKIE, token, platformSessionCookieOptions);
    return response;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    console.error("Platform admin login failed", error instanceof Error ? error.message : "unknown error");
    return NextResponse.json({ error: "Login Super Admin belum dapat diproses." }, { status: 503 });
  } finally { client.release(); }
}
