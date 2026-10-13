import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getPlatformSession } from "@/lib/platform-auth";
import { getPool } from "@/lib/db";
import { calculateSubscriptionInvoice, isValidBillingPeriod } from "@/lib/platform-billing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const createSchema = z.object({
  subscriptionId: z.string().uuid(),
  invoiceType: z.enum(["activation", "subscription", "commission"]),
  idempotencyKey: z.string().trim().min(8).max(128).regex(/^[a-zA-Z0-9_-]+$/),
  periodStart: z.string().optional(),
  periodEnd: z.string().optional(),
});


export async function GET() {
  const session = await getPlatformSession();
  if (!session) return NextResponse.json({ error: "Autentikasi Super Admin diperlukan." }, { status: 401 });
  try {
    const result = await getPool().query(
      `SELECT i.id, i.organization_id, o.name AS tenant_name, i.subscription_id, i.invoice_number,
              i.invoice_type, i.period_start, i.period_end, i.currency, i.subtotal_amount, i.discount_amount,
              i.tax_amount, i.total_amount, i.status, i.due_at, i.issued_at, i.created_at,
              COALESCE(paid.total, 0)::numeric(14,2) AS verified_amount
       FROM platform_invoices i
       JOIN organizations o ON o.id = i.organization_id
       LEFT JOIN LATERAL (
         SELECT SUM(p.amount) AS total FROM platform_payments p
         WHERE p.organization_id = i.organization_id AND p.platform_invoice_id = i.id AND p.status = 'verified'
       ) paid ON true
       ORDER BY i.created_at DESC LIMIT 500`,
    );
    return NextResponse.json({ data: result.rows });
  } catch (error) {
    console.error("Platform invoices list failed", error instanceof Error ? error.message : "unknown error");
    return NextResponse.json({ error: "Invoice platform belum dapat dimuat. Pastikan migrasi 009–011 sudah diterapkan." }, { status: 503 });
  }
}

export async function POST(request: NextRequest) {
  const session = await getPlatformSession();
  if (!session) return NextResponse.json({ error: "Autentikasi Super Admin diperlukan." }, { status: 401 });
  let raw: unknown;
  try { raw = await request.json(); }
  catch { return NextResponse.json({ error: "Format permintaan tidak valid." }, { status: 400 }); }
  const parsed = createSchema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: "Data invoice tidak valid.", details: parsed.error.flatten().fieldErrors }, { status: 400 });
  const input = parsed.data;
  if (input.invoiceType === "activation") {
    if (input.periodStart || input.periodEnd) return NextResponse.json({ error: "Invoice aktivasi tidak menggunakan periode bulanan." }, { status: 400 });
  } else if (!input.periodStart || !input.periodEnd
    || (!isValidBillingPeriod(input.periodStart, input.periodEnd, "monthly")
      && !isValidBillingPeriod(input.periodStart, input.periodEnd, "yearly"))) {
    return NextResponse.json({ error: "Periode invoice harus berupa bulan kalender penuh atau periode tahunan 12 bulan." }, { status: 400 });
  }
  if (input.invoiceType === "commission" && !isValidBillingPeriod(input.periodStart, input.periodEnd, "monthly")) {
    return NextResponse.json({ error: "Periode komisi harus satu bulan kalender penuh." }, { status: 400 });
  }

  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const subscriptionResult = await client.query(
      "SELECT * FROM tenant_subscriptions WHERE id = $1 FOR UPDATE",
      [input.subscriptionId],
    );
    const subscription = subscriptionResult.rows[0];
    if (!subscription) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "Subscription tidak ditemukan." }, { status: 404 });
    }
    const organizationId = subscription.organization_id as string;
    const prior = await client.query(
      "SELECT * FROM platform_invoices WHERE organization_id = $1 AND idempotency_key = $2 LIMIT 1",
      [organizationId, input.idempotencyKey],
    );
    if (prior.rows[0]) {
      const existing = prior.rows[0];
      const sameRequest = existing.subscription_id === input.subscriptionId
        && existing.invoice_type === input.invoiceType
        && (existing.period_start ? String(existing.period_start).slice(0, 10) : "") === (input.periodStart || "")
        && (existing.period_end ? String(existing.period_end).slice(0, 10) : "") === (input.periodEnd || "");
      await client.query("COMMIT");
      if (!sameRequest) return NextResponse.json({ error: "Idempotency key sudah digunakan untuk invoice lain." }, { status: 409 });
      return NextResponse.json({ data: existing, reused: true });
    }

    let subtotal = 0;
    let discount = 0;
    if (input.invoiceType === "activation") {
      if (subscription.status !== "pending_activation" || subscription.activation_status !== "due") {
        await client.query("ROLLBACK");
        return NextResponse.json({ error: "Subscription tidak memerlukan invoice aktivasi." }, { status: 409 });
      }
      subtotal = Number(subscription.activation_fee_amount);
    } else if (input.invoiceType === "subscription") {
      const cycle = subscription.billing_cycle === "yearly" ? "yearly" : "monthly";
      if (!isValidBillingPeriod(input.periodStart, input.periodEnd, cycle)) {
        await client.query("ROLLBACK");
        return NextResponse.json({ error: cycle === "yearly" ? "Langganan tahunan harus mencakup tepat 12 bulan kalender." : "Langganan bulanan harus mencakup satu bulan kalender penuh." }, { status: 400 });
      }
      if (!["active", "past_due"].includes(subscription.status)) {
        await client.query("ROLLBACK");
        return NextResponse.json({ error: "Invoice bulanan hanya dapat dibuat untuk subscription aktif atau menunggak." }, { status: 409 });
      }
      const calculated = calculateSubscriptionInvoice(Number(subscription.monthly_fee_amount), cycle);
      if (!calculated) {
        await client.query("ROLLBACK");
        return NextResponse.json({ error: "Nilai paket subscription tidak valid." }, { status: 409 });
      }
      subtotal = calculated.subtotal;
      discount = calculated.discount;
    } else {
      if (!["active", "past_due"].includes(subscription.status) || Number(subscription.commission_rate_bps) <= 0) {
        await client.query("ROLLBACK");
        return NextResponse.json({ error: "Subscription tidak memiliki komisi yang dapat ditagih." }, { status: 409 });
      }
      const commission = await client.query(
        `SELECT COALESCE(SUM(commission_amount), 0)::numeric(14,2) AS amount
         FROM commission_entries
         WHERE organization_id = $1 AND subscription_id = $2 AND status = 'pending'
           AND earned_at >= $3::date AND earned_at < ($4::date + interval '1 day')`,
        [organizationId, input.subscriptionId, input.periodStart, input.periodEnd],
      );
      subtotal = Number(commission.rows[0]?.amount || 0);
    }
    if (!Number.isFinite(subtotal) || subtotal <= 0) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "Tidak ada nilai positif yang dapat ditagih untuk jenis invoice dan periode ini." }, { status: 409 });
    }

    const today = new Date().toISOString().slice(0, 10).replaceAll("-", "");
    const invoiceNumber = "AHA-INV-" + today + "-" + randomUUID().replaceAll("-", "").slice(0, 8).toUpperCase();
    const created = await client.query(
      `INSERT INTO platform_invoices
       (organization_id, subscription_id, invoice_number, invoice_type, period_start, period_end,
        subtotal_amount, discount_amount, tax_amount, total_amount, status, idempotency_key, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,0,$7-$8,'draft',$9,$10)
       RETURNING id, organization_id, subscription_id, invoice_number, invoice_type, period_start, period_end,
                 subtotal_amount, discount_amount, tax_amount, total_amount, status, idempotency_key, created_at`,
      [organizationId, input.subscriptionId, invoiceNumber, input.invoiceType,
        input.invoiceType === "activation" ? null : input.periodStart,
        input.invoiceType === "activation" ? null : input.periodEnd,
        subtotal, discount, input.idempotencyKey,
        discount > 0 ? "Draft; annual subscription list price for 12 months with 10% discount; tax and due date require review." : "Draft; tax treatment and due date must be reviewed before issue."],
    );
    const invoice = created.rows[0];
    await client.query(
      `INSERT INTO platform_audit_logs (platform_admin_id, actor_type, action, entity_type, entity_id, details)
       VALUES ($1, 'platform_admin', 'platform_invoice.draft_created', 'platform_invoice', $2, $3::jsonb)`,
      [session.platformAdminId, invoice.id, JSON.stringify({ organizationId, subscriptionId: input.subscriptionId, invoiceType: input.invoiceType, subtotal, discount, billingCycle: subscription.billing_cycle })],
    );
    await client.query("COMMIT");
    return NextResponse.json({ data: invoice, message: "Draft invoice dibuat. Tentukan perlakuan pajak dan tanggal jatuh tempo sebelum menerbitkan." }, { status: 201 });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    const code = (error as { code?: string })?.code;
    if (code === "23505") return NextResponse.json({ error: "Invoice untuk periode ini sudah ada. Muat ulang daftar invoice." }, { status: 409 });
    console.error("Platform invoice draft creation failed", error instanceof Error ? error.message : "unknown error");
    return NextResponse.json({ error: "Draft invoice belum dapat dibuat." }, { status: 503 });
  } finally { client.release(); }
}
