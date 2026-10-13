import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getPlatformSession } from "@/lib/platform-auth";
import { getPool } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const nullablePositiveInt = z.number().int().positive().nullable();
const planSchema = z.object({
  code: z.string().trim().min(2).max(48).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(1000).default(""),
  activationFee: z.number().finite().min(0).max(999999999999.99),
  monthlyFee: z.number().finite().min(0).max(999999999999.99),
  commissionRateBps: z.number().int().min(0).max(10000),
  commissionCapAmount: z.number().finite().min(0).max(999999999999.99).nullable(),
  maxVehicles: nullablePositiveInt,
  maxUsers: nullablePositiveInt,
  monthlyConversationLimit: nullablePositiveInt,
  includedAiTokens: z.number().int().min(0).max(1000000000000),
});

export async function GET() {
  const session = await getPlatformSession();
  if (!session) return NextResponse.json({ error: "Autentikasi Super Admin diperlukan." }, { status: 401 });
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(
      `INSERT INTO subscription_plans
       (code, name, description, activation_fee, monthly_fee, commission_rate_bps, commission_cap_amount,
        max_vehicles, max_users, monthly_conversation_limit, included_ai_tokens)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       RETURNING id, code, name, description, activation_fee, monthly_fee, commission_rate_bps,
                 commission_cap_amount, max_vehicles, max_users, monthly_conversation_limit,
                 included_ai_tokens, is_active, created_at, updated_at`,
      [p.code, p.name, p.description, p.activationFee, p.monthlyFee, p.commissionRateBps,
        p.commissionCapAmount, p.maxVehicles, p.maxUsers, p.monthlyConversationLimit, p.includedAiTokens],
    );
    const plan = result.rows[0];
    await client.query(
      `INSERT INTO platform_audit_logs (platform_admin_id, actor_type, action, entity_type, entity_id, details)
       VALUES ($1, 'platform_admin', 'subscription_plan.created', 'subscription_plan', $2, $3::jsonb)`,
      [session.platformAdminId, plan.id, JSON.stringify({ code: plan.code, name: plan.name })],
    );
    await client.query("COMMIT");
    return NextResponse.json({ data: plan }, { status: 201 });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    const code = (error as { code?: string })?.code;
    if (code === "23505") return NextResponse.json({ error: "Kode paket sudah digunakan." }, { status: 409 });
    console.error("Platform plan creation failed", error instanceof Error ? error.message : "unknown error");
    return NextResponse.json({ error: "Paket belum dapat disimpan." }, { status: 503 });
  } finally { client.release(); }
}
