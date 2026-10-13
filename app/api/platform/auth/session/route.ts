import { NextResponse } from "next/server";
import { getPlatformSession } from "@/lib/platform-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getPlatformSession();
  if (!session) return NextResponse.json({ authenticated: false }, { status: 401 });
  return NextResponse.json({ authenticated: true, data: { id: session.platformAdminId, email: session.email, fullName: session.fullName } });
}
