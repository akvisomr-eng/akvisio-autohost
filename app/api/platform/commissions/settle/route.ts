import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getPlatformSession } from "@/lib/platform-auth";
import { getPool } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const schema = z.object({
  periodStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  periodEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  organizationId: z.string().uuid().optional(),
});

function validMonth(start: string, end: string) {
  const s = new Date(start + "T00:00:00.000Z");
  const e = new Date(end + "T00:00:00.000Z");
  if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime()) || s.toISOString().slice(0,10) !== start || e.toISOString().slice(0,10) !== end) return false;
  const last = new Date(Date.UTC(s.getUTCFullYear(), s.getUTCMonth() + 1, 0)).toISOString().slice(0,10);
  return s.getUTCDate() === 1 && s.getUTCFullYear() === e.getUTCFullYear() && s.getUTCMonth() === e.getUTCMonth() && end === last;
}
const money = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

export async function POST(request: NextRequest) {
  const session = await getPlatformSession();
  if (!session) return NextResponse.json({ error: "Autentikasi Super Admin diperlukan." }, { status: 401 });
  let raw: unknown;
  try { raw = await request.json(); }
  catch { return NextResponse.json({ error: "Format permintaan tidak valid." }, { status: 400 }); }
  const parsed = schema.safeParse(raw);
  if (!parsed.success || !validMonth(parsed.data.periodStart, parsed.data.periodEnd)) {
    return NextResponse.json({ error: "Periode komisi harus berupa satu bulan kalender penuh." }, { status: 400 });
  }
  const { periodStart, periodEnd, organizationId } = parsed.data;
  const now = new Date();
  const currentMonthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  if (new Date(periodEnd + "T00:00:00.000Z").getTime() >= currentMonthStart.getTime()) {
    return NextResponse.json({ error: "Settlement hanya boleh dijalankan untuk bulan kalender yang sudah selesai." }, { status: 400 });
  }
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const subscriptions = await client.query(
      `SELECT * FROM tenant_subscriptions
       WHERE status IN ('active','past_due') AND commission_rate_bps > 0
         AND ($1::uuid IS NULL OR organization_id = $1)
       ORDER BY organization_id
       FOR UPDATE SKIP LOCKED`,
      [organizationId || null],
    );
    let createdCount = 0;
    let createdCommission = 0;
    let consideredPayments = 0;
    const tenantResults: Array<{ organizationId: string; subscriptionId: string; entriesCreated: number; commissionAmount: number }> = [];

    for (const subscription of subscriptions.rows) {
      const orgId = subscription.organization_id as string;
      const subscriptionId = subscription.id as string;
      const rate = Number(subscription.commission_rate_bps);
      const cap = subscription.commission_cap_amount === null ? null : Number(subscription.commission_cap_amount);
      const existingResult = await client.query(
        `SELECT COALESCE(SUM(commission_amount),0)::numeric(14,2) AS used
         FROM commission_entries
         WHERE organization_id=$1 AND subscription_id=$2 AND status IN ('pending','invoiced')
           AND earned_at >= $3::date AND earned_at < ($4::date + interval '1 day')`,
        [orgId, subscriptionId, periodStart, periodEnd],
      );
      let remainingCap = cap === null ? null : Math.max(0, money(cap - Number(existingResult.rows[0]?.used || 0)));
      const eligible = await client.query(
        `SELECT p.id, p.booking_id, p.payment_type, p.amount, COALESCE(p.verified_at, p.created_at) AS eligible_at
         FROM payments p
         WHERE p.organization_id=$1 AND p.status='verified' AND p.payment_type IN ('rental','extra_charge')
           AND COALESCE(p.verified_at, p.created_at) >= $2::date
           AND COALESCE(p.verified_at, p.created_at) < ($3::date + interval '1 day')
           AND NOT EXISTS (
             SELECT 1 FROM commission_entries ce
             WHERE ce.organization_id=p.organization_id AND ce.source_payment_id=p.id
           )
         ORDER BY COALESCE(p.verified_at, p.created_at), p.id
         FOR UPDATE OF p`,
        [orgId, periodStart, periodEnd],
      );
      let tenantCount = 0;
      let tenantCommission = 0;
      consideredPayments += eligible.rows.length;
      for (const payment of eligible.rows) {
        const gross = Number(payment.amount);
        const rawCommission = money(gross * rate / 10000);
        if (remainingCap !== null && remainingCap <= 0) continue;
        const commission = remainingCap === null ? rawCommission : Math.min(rawCommission, remainingCap);
        if (commission <= 0) continue;
        await client.query(
          `INSERT INTO commission_entries
           (organization_id, subscription_id, source_payment_id, source_booking_id, source_payment_type,
            gross_amount, commissionable_amount, commission_rate_bps, commission_amount, status, earned_at)
           VALUES ($1,$2,$3,$4,$5,$6,$6,$7,$8,'pending',$9)
           ON CONFLICT (organization_id, source_payment_id) DO NOTHING`,
          [orgId, subscriptionId, payment.id, payment.booking_id, payment.payment_type, gross, rate, commission, payment.eligible_at],
        );
        tenantCount++;
        tenantCommission = money(tenantCommission + commission);
        if (remainingCap !== null) remainingCap = money(remainingCap - commission);
      }
      if (tenantCount) {
        createdCount += tenantCount;
        createdCommission = money(createdCommission + tenantCommission);
        tenantResults.push({ organizationId: orgId, subscriptionId, entriesCreated: tenantCount, commissionAmount: tenantCommission });
      }
      await client.query(
        `INSERT INTO tenant_usage_monthly (organization_id, period_start, commissionable_revenue)
         SELECT $1, $2::date, COALESCE(SUM(amount),0)
         FROM payments
         WHERE organization_id=$1 AND status='verified' AND payment_type IN ('rental','extra_charge')
           AND COALESCE(verified_at, created_at) >= $2::date
           AND COALESCE(verified_at, created_at) < ($3::date + interval '1 day')
         ON CONFLICT (organization_id, period_start)
         DO UPDATE SET commissionable_revenue=EXCLUDED.commissionable_revenue, updated_at=now()`,
        [orgId, periodStart, periodEnd],
      );
    }

    await client.query(
      `INSERT INTO platform_audit_logs (platform_admin_id, actor_type, action, entity_type, details)
       VALUES ($1, 'platform_admin', 'commission.settlement.completed', 'commission_period', $2::jsonb)`,
      [session.platformAdminId, JSON.stringify({ periodStart, periodEnd, organizationId: organizationId || null, entriesCreated: createdCount, commissionAmount: createdCommission, eligiblePaymentsConsidered: consideredPayments })],
    );
    await client.query("COMMIT");
    return NextResponse.json({ data: { periodStart, periodEnd, entriesCreated: createdCount, commissionAmount: createdCommission, eligiblePaymentsConsidered: consideredPayments, tenants: tenantResults }, message: "Komisi dihitung dari pembayaran rental/biaya tambahan yang terverifikasi. Deposit dan refund dikecualikan." });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    console.error("Commission settlement failed", error instanceof Error ? error.message : "unknown error");
    return NextResponse.json({ error: "Settlement komisi gagal; transaksi dibatalkan dan dapat dicoba kembali." }, { status: 503 });
  } finally { client.release(); }
}
