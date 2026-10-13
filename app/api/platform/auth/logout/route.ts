import { NextResponse } from "next/server";
import { PLATFORM_SESSION_COOKIE, platformSessionCookieOptions } from "@/lib/platform-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  const response = NextResponse.json({ success: true });
  response.cookies.set(PLATFORM_SESSION_COOKIE, "", { ...platformSessionCookieOptions, maxAge: 0 });
  return response;
}
