import { NextResponse } from "next/server";
import { getPool } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const checks: Record<string, "ok" | "not_configured" | "error"> = {
    application: "ok",
    database: "not_configured",
    whatsapp: process.env.WHATSAPP_ACCESS_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID ? "ok" : "not_configured",
    ai: process.env.AI_API_KEY && process.env.AI_PROVIDER ? "ok" : "not_configured",
  };

  if (process.env.DATABASE_URL) {
    try {
      const pool = getPool();
      await pool.query("SELECT 1");
      checks.database = "ok";
    } catch {
      checks.database = "error";
    }
  }

  const ready = Object.values(checks).every((value) => value === "ok");
  return NextResponse.json({ status: ready ? "ready" : "setup_required", checks }, { status: checks.database === "error" ? 503 : 200 });
}
