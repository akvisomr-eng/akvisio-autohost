import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getPool } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 1_000_000;

async function readLimitedBody(request: NextRequest): Promise<string> {
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const part = await reader.read();
    if (part.done) break;
    total += part.value.byteLength;
    if (total > MAX_BODY_BYTES) {
      await reader.cancel().catch(() => undefined);
      throw new Error("WEBHOOK_BODY_TOO_LARGE");
    }
    chunks.push(part.value);
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString("utf8");
}

function safeEqual(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function GET(request: NextRequest) {
  const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN;
  if (!verifyToken) {
    return NextResponse.json({ error: "Webhook WhatsApp belum dikonfigurasi." }, { status: 503 });
  }
  const params = request.nextUrl.searchParams;
  const mode = params.get("hub.mode") || "";
  const token = params.get("hub.verify_token") || "";
  const challenge = params.get("hub.challenge") || "";
  if (mode !== "subscribe" || !challenge || !safeEqual(token, verifyToken)) {
    return NextResponse.json({ error: "Verifikasi webhook ditolak." }, { status: 403 });
  }
  return new Response(challenge, { status: 200, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
}

export async function POST(request: NextRequest) {
  const appSecret = process.env.WHATSAPP_APP_SECRET;
  if (!appSecret) {
    return NextResponse.json({ error: "Webhook WhatsApp belum dikonfigurasi." }, { status: 503 });
  }

  const declaredLength = Number(request.headers.get("content-length") || 0);
  if (declaredLength > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "Payload webhook terlalu besar." }, { status: 413 });
  }

  let rawBody: string;
  try {
    rawBody = await readLimitedBody(request);
  } catch {
    return NextResponse.json({ error: "Payload webhook terlalu besar atau tidak dapat dibaca." }, { status: 413 });
  }
  const suppliedSignature = request.headers.get("x-hub-signature-256") || "";
  const expectedSignature = `sha256=${createHmac("sha256", appSecret).update(rawBody, "utf8").digest("hex")}`;
  if (!/^sha256=[a-f0-9]{64}$/i.test(suppliedSignature) || !safeEqual(suppliedSignature.toLowerCase(), expectedSignature)) {
    return NextResponse.json({ error: "Tanda tangan webhook tidak valid." }, { status: 401 });
  }

  let payload: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(rawBody);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("invalid object");
    payload = parsed as Record<string, unknown>;
    if (payload.object !== "whatsapp_business_account" || !Array.isArray(payload.entry)) throw new Error("invalid WhatsApp payload");
  } catch {
    return NextResponse.json({ error: "Payload webhook WhatsApp tidak valid." }, { status: 400 });
  }

  const providerEventId = createHash("sha256").update(rawBody, "utf8").digest("hex");
  const entry = payload.entry as Array<Record<string, unknown>>;
  const fields = entry.flatMap((item) => Array.isArray(item.changes)
    ? (item.changes as Array<Record<string, unknown>>).map((change) => typeof change.field === "string" ? change.field : "unknown")
    : []);
  const eventType = fields.length ? `whatsapp:${[...new Set(fields)].sort().join(",").slice(0, 180)}` : "whatsapp:unknown";

  try {
    const result = await getPool().query(
      `INSERT INTO webhook_events (provider, provider_event_id, event_type, payload, processing_status)
       VALUES ('meta_whatsapp', $1, $2, $3::jsonb, 'pending')
       ON CONFLICT (provider, provider_event_id) DO NOTHING
       RETURNING id`,
      [providerEventId, eventType, JSON.stringify(payload)],
    );
    return NextResponse.json(
      { accepted: true, duplicate: result.rowCount === 0 },
      { status: 200, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("WhatsApp webhook persistence failed", error instanceof Error ? error.message : "unknown error");
    // A non-2xx response tells Meta it may retry delivery.
    return NextResponse.json({ error: "Webhook belum dapat disimpan; pengiriman dapat dicoba ulang." }, { status: 503 });
  }
}
