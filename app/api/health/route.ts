import { NextResponse } from "next/server";
import { getPool } from "@/lib/db";
import { buildHealthChecks, isApplicationReady } from "@/lib/health-checks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  let database: "ok" | "not_configured" | "error" = "not_configured";
  if (process.env.DATABASE_URL) {
    try {
      await getPool().query("SELECT 1");
      database = "ok";
    } catch {
      database = "error";
    }
  }

  const checks = buildHealthChecks(process.env, database);
  const ready = isApplicationReady(checks);
  return NextResponse.json(
    { status: ready ? "ready" : "setup_required", checks },
    { status: ready ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
}
