import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getPlatformSession } from "@/lib/platform-auth";
import { getPool } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(1000),
  activationFee: z.number().finite().min(0).max(999999999999.99),
  monthlyFee: z.number().finite().min(0).max(999999999999.99),
  commissionRateBps: z.number().int().min(0).max(10000),
  commissionCapAmount: z.number().finite().min(0).max(999999999999.99).nullable(),
  maxVehicles: z.number().int().positive().nullable(),
  maxUsers: z.number().int().positive().nullable(),
  monthlyConversationLimit: z.number().int().positive().nullable(),
  includedAiTokens: z.number().int().min(0).max(1000000000000),
  isActive: z.boolean(),
});

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const session = await getPlatformSession();
  if (!session) return NextResponse.json({ error: "Autentikasi Super Admin diperlukan." }, { status: 401 });
  const { id } = await context.params;
  let raw: unknown;
  try { raw = await request.json(); }
  catch { return NextResponse.json({ error: "Format permintaan tidak valid." }, { status: 400 }); }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: "Data paket tidak valid.", details: parsed.error.flatten().fieldErrors }, { status: 400 });
  const p = parsed.data;
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(
      `UPDATE subscription_plans SET name=$1, description=$2, activation_fee=$3, monthly_fee=$4,
       commission_rate_bps=$5, commission_cap_amount=$6, max_vehicles=$7, max_users=$8,
       monthly_conversation_limit=$9, included_ai_tokens=$10, is_active=$11, updated_at=now()
       WHERE id=$12
       RETURNING id, code, name, description, activation_fee, monthly_fee, commission_rate_bps,
                 commission_cap_amount, max_vehicles, max_users, monthly_conversation_limit,
                 included_ai_tokens, is_active, updated_at`,
      [p.name,p.description,p.activationFee,p.monthlyFee,p.commissionRateBps,p.commissionCapAmount,
       p.maxVehicles,p.maxUsers,p.monthlyConversationLimit,p.includedAiTokens,p.isActive,id],
    );
    if (!result.rows[0]) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "Paket tidak ditemukan." }, { status: 404 });
    }
    await client.query(
      `INSERT INTO platform_audit_logs (platform_admin_id, actor_type, action, entity_type, entity_id, details)
       VALUES ($1, 'platform_admin', 'subscription_plan.updated', 'subscription_plan', $2, $3::jsonb)`,
      [session.platformAdminId, id, JSON.stringify({ isActive: p.isActive, pricingChanged: true })],
    );
    await client.query("COMMIT");
    return NextResponse.json({ data: result.rows[0], note: "Perubahan harga paket tidak mengubah snapshot harga subscription yang sudah ada." });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    console.error("Platform plan update failed", error instanceof Error ? error.message : "unknown error");
    return NextResponse.json({ error: "Paket belum dapat diperbarui." }, { status: 503 });
  } finally { client.release(); }
}
