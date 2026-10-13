import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { getPool } from "@/lib/db";

export const SESSION_COOKIE = "src_session";
const SESSION_TTL_SECONDS = 60 * 60 * 12;

export type AppSession = {
  userId: string;
  organizationId: string;
  email: string;
  fullName: string;
  role: string;
  exp: number;
};

function sessionSecret() {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("SESSION_SECRET must be configured with at least 32 characters");
  }
  return secret;
}

export function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string | null | undefined) {
  if (!stored) return false;
  const [salt, expectedHex] = stored.split(":");
  if (!salt || !expectedHex || !/^[a-f0-9]{128}$/i.test(expectedHex)) return false;
  const actual = scryptSync(password, salt, 64);
  const expected = Buffer.from(expectedHex, "hex");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function sign(value: string) {
  return createHmac("sha256", sessionSecret()).update(value).digest("base64url");
}

export function createSessionToken(input: Omit<AppSession, "exp">) {
  const payload = Buffer.from(JSON.stringify({
    ...input,
    exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS,
  })).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

export function verifySessionToken(token: string | undefined): AppSession | null {
  if (!token) return null;
  const [payload, signature, extra] = token.split(".");
  if (!payload || !signature || extra) return null;
  try {
    const expected = Buffer.from(sign(payload));
    const actual = Buffer.from(signature);
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as AppSession;
    if (!parsed.userId || !parsed.organizationId || !parsed.email || !parsed.exp) return null;
    if (parsed.exp <= Math.floor(Date.now() / 1000)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function getSession(): Promise<AppSession | null> {
  try {
    const jar = await cookies();
    const tokenSession = verifySessionToken(jar.get(SESSION_COOKIE)?.value);
    if (!tokenSession) return null;

    // Revalidate active account and current role on every authenticated request.
    const result = await getPool().query<{
      id: string;
      organization_id: string;
      email: string;
      full_name: string;
      role: string;
      is_active: boolean;
    }>(
      "SELECT id, organization_id, email, full_name, role, is_active FROM users WHERE id = $1 AND organization_id = $2 LIMIT 1",
      [tokenSession.userId, tokenSession.organizationId],
    );
    const user = result.rows[0];
    if (!user || !user.is_active) return null;
    return {
      ...tokenSession,
      userId: user.id,
      organizationId: user.organization_id,
      email: user.email,
      fullName: user.full_name,
      role: user.role,
    };
  } catch {
    return null;
  }
}

export async function requireSession() {
  return getSession();
}

export const sessionCookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
  maxAge: SESSION_TTL_SECONDS,
};
