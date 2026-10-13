import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getPlatformSession } from "@/lib/platform-auth";
import { getPool } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  invoiceId: z.string().uuid(),
  amount: z.number().finite().positive().max(999999999999.99),
  provider: z.enum(["manual", "bank_transfer", "payment_gateway", "other"]).default("manual"),
  providerReference: z.string().trim().max(200).nullable().default(null),
  idempotencyKey: z.string().trim().min(8).max(128).regex(/^[a-zA-Z0-9_-]+$/),
  notes: z.string().trim().max(1000).default(""),
});

export async function GET() {
  const session = await getPlatformSession();
  if (!session) return NextResponse.json({ error: "Autentikasi Super Admin diperlukan." }, { status: 401 });
  try {
    const result = await getPool().query(
      `SELECT p.id, p.organization_id, o.name AS tenant_name, p.platform_invoice_id,
              i.invoice_number, i.total_amount AS invoice_total, p.provider, p.provider_reference,
              p.amount, p.status, p.received_at, p.verified_at, p.notes, p.created_at
       FROM platform_payments p
       JOIN organizations o ON o.id = p.organization_id
       JOIN platform_invoices i ON i.id = p.platform_invoice_id AND i.organization_id = p.organization_id
       ORDER BY p.received_at DESC LIMIT 500`,
    );
    return NextResponse.json({ data: result.rows });
  } catch (error) {
    console.error("Platform payments list failed", error instanceof Error ? error.message : "unknown error");
    return NextResponse.json({ error: "Pembayaran platform belum dapat dimuat." }, { status: 503 });
  }
}

export async function POST(request: NextRequest) {
  const session = await getPlatformSession();
  if (!session) return NextResponse.json({ error: "Autentikasi Super Admin diperlukan." }, { status: 401 });
  let raw: unknown;
  try { raw = await request.json(); }
  catch { return NextResponse.json({ error: "Format permintaan tidak valid." }, { status: 400 }); }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: "Data pembayaran tidak valid.", details: parsed.error.flatten().fieldErrors }, { status: 400 });
  const input = parsed.data;
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const invoiceResult = await client.query("SELECT * FROM platform_invoices WHERE id=$1 FOR UPDATE", [input.invoiceId]);
    const invoice = invoiceResult.rows[0];
    if (!invoice) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "Invoice tidak ditemukan." }, { status: 404 });
    }
    const existing = await client.query(
      "SELECT * FROM platform_payments WHERE organization_id=$1 AND idempotency_key=$2 LIMIT 1",
      [invoice.organization_id, input.idempotencyKey],
    );
    if (existing.rows[0]) {
      const old = existing.rows[0];
      const same = old.platform_invoice_id === input.invoiceId && Number(old.amount) === input.amount && old.provider === input.provider;
      await client.query("COMMIT");
      if (!same) return NextResponse.json({ error: "Idempotency key sudah digunakan untuk pembayaran lain." }, { status: 409 });
      return NextResponse.json({ data: old, reused: true });
    }
    if (!["issued", "partially_paid", "overdue"].includes(invoice.status)) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "Klaim pembayaran hanya dapat dicatat untuk invoice yang sudah diterbitkan dan belum lunas." }, { status: 409 });
    }
    const outstanding = await client.query(
      "SELECT COALESCE(SUM(amount),0)::numeric(14,2) AS total FROM platform_payments WHERE organization_id=$1 AND platform_invoice_id=$2 AND status IN ('pending','verified')",
      [invoice.organization_id, invoice.id],
    );
    const available = Math.round((Number(invoice.total_amount) - Number(outstanding.rows[0]?.total || 0)) * 100) / 100;
    if (input.amount > available) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "Nominal klaim melebihi sisa invoice setelah klaim pending dan pembayaran terverifikasi." }, { status: 409 });
    }
    const inserted = await client.query(
      `INSERT INTO platform_payments
       (organization_id, platform_invoice_id, provider, provider_reference, amount, status, idempotency_key, notes)
       VALUES ($1,$2,$3,$4,$5,'pending',$6,$7)
       RETURNING id, organization_id, platform_invoice_id, provider, provider_reference, amount, status, received_at, idempotency_key`,
      [invoice.organization_id, invoice.id, input.provider, input.providerReference, input.amount, input.idempotencyKey, input.notes],
    );
    const payment = inserted.rows[0];
    await client.query(
      `INSERT INTO platform_audit_logs (platform_admin_id, actor_type, action, entity_type, entity_id, details)
       VALUES ($1, 'platform_admin', 'platform_payment.claim_recorded', 'platform_payment', $2, $3::jsonb)`,
      [session.platformAdminId, payment.id, JSON.stringify({ invoiceId: invoice.id, amount: input.amount, provider: input.provider, status: "pending" })],
    );
    await client.query("COMMIT");
    return NextResponse.json({ data: payment, message: "Klaim pembayaran tercatat sebagai pending dan belum dianggap lunas." }, { status: 201 });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    const code = (error as { code?: string })?.code;
    if (code === "23505") return NextResponse.json({ error: "Referensi provider atau idempotency key sudah digunakan." }, { status: 409 });
    console.error("Platform payment claim failed", error instanceof Error ? error.message : "unknown error");
    return NextResponse.json({ error: "Klaim pembayaran belum dapat dicatat." }, { status: 503 });
  } finally { client.release(); }
}
