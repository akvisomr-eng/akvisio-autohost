import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { getPool } from "@/lib/db";

export const PLATFORM_SESSION_COOKIE = "akvisio_platform_session";
const SESSION_TTL_SECONDS = 60 * 60 * 8;

export type PlatformSession = {
  platformAdminId: string;
  email: string;
  fullName: string;
  exp: number;
};

function secret() {
  const value = process.env.PLATFORM_SESSION_SECRET;
  if (!value || value.length < 32) throw new Error("PLATFORM_SESSION_SECRET must contain at least 32 characters");
  return value;
}

function signature(payload: string) {
  return createHmac("sha256", secret()).update(payload).digest("base64url");
}

export function createPlatformSessionToken(input: Omit<PlatformSession, "exp">) {
  const payload = Buffer.from(JSON.stringify({ ...input, exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS })).toString("base64url");
  return payload + "." + signature(payload);
}

export function verifyPlatformSessionToken(token: string | undefined): PlatformSession | null {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  try {
    const expected = Buffer.from(signature(parts[0]));
    const supplied = Buffer.from(parts[1]);
    if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) return null;
    const parsed = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8")) as PlatformSession;
    if (!parsed.platformAdminId || !parsed.email || !parsed.exp || parsed.exp <= Math.floor(Date.now() / 1000)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function getPlatformSession(): Promise<PlatformSession | null> {
  try {
    const jar = await cookies();
    const token = verifyPlatformSessionToken(jar.get(PLATFORM_SESSION_COOKIE)?.value);
    if (!token) return null;
    const result = await getPool().query(
      "SELECT id, email, full_name, is_active FROM platform_admins WHERE id = $1 LIMIT 1",
      [token.platformAdminId],
    );
    const admin = result.rows[0];
    if (!admin?.is_active) return null;
    return { platformAdminId: admin.id, email: admin.email, fullName: admin.full_name, exp: token.exp };
  } catch {
    return null;
  }
}

export const platformSessionCookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "strict" as const,
  path: "/platform",
  maxAge: SESSION_TTL_SECONDS,
};
