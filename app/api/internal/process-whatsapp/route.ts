import { createHash, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import type { PoolClient } from "pg";
import { getPool } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const MAX_BATCH = 20;

function safeEqual(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function authorize(request: NextRequest) {
  const secret = process.env.WHATSAPP_PROCESSOR_SECRET;
  if (!secret) return false;
  const supplied = request.headers.get("authorization") || "";
  return safeEqual(supplied, `Bearer ${secret}`);
}

type MetaMessage = {
  id?: string;
  from?: string;
  timestamp?: string;
  type?: string;
  text?: { body?: string };
  button?: { text?: string };
  interactive?: { button_reply?: { title?: string }; list_reply?: { title?: string } };
  image?: { caption?: string };
  video?: { caption?: string };
  document?: { filename?: string; caption?: string };
  location?: { latitude?: number; longitude?: number; name?: string; address?: string };
  contacts?: unknown[];
  context?: { id?: string };
};
type MetaStatus = { id?: string; status?: string; timestamp?: string; recipient_id?: string; errors?: unknown[] };
type MetaValue = {
  metadata?: { phone_number_id?: string; display_phone_number?: string };
  contacts?: Array<{ wa_id?: string; profile?: { name?: string } }>;
  messages?: MetaMessage[];
  statuses?: MetaStatus[];
};
type MetaPayload = { object?: string; entry?: Array<{ changes?: Array<{ field?: string; value?: MetaValue }> }> };

function messageBody(message: MetaMessage): string {
  const type = message.type || "unknown";
  if (type === "text") return message.text?.body?.trim() || "[Pesan teks kosong]";
  if (type === "interactive") return message.interactive?.button_reply?.title || message.interactive?.list_reply?.title || "[Balasan interaktif]";
  if (type === "button") return message.button?.text || "[Balasan tombol]";
  if (type === "image") return message.image?.caption ? `[Gambar] ${message.image.caption}` : "[Pesan gambar]";
  if (type === "video") return message.video?.caption ? `[Video] ${message.video.caption}` : "[Pesan video]";
  if (type === "document") return message.document?.caption || (message.document?.filename ? `[Dokumen] ${message.document.filename}` : "[Pesan dokumen]");
  if (type === "audio" || type === "voice") return "[Pesan audio]";
  if (type === "sticker") return "[Stiker]";
  if (type === "location") return message.location?.name || message.location?.address || "[Lokasi dibagikan]";
  if (type === "contacts") return "[Kontak dibagikan]";
  return `[Pesan ${type}]`;
}

function messageTime(timestamp?: string) {
  if (timestamp && /^\d{9,12}$/.test(timestamp)) {
    const value = new Date(Number(timestamp) * 1000);
    if (!Number.isNaN(value.getTime())) return value;
  }
  return new Date();
}

async function processPayload(client: PoolClient, payload: MetaPayload) {
  if (payload.object !== "whatsapp_business_account" || !Array.isArray(payload.entry)) {
    throw new Error("Payload bukan event WhatsApp Business Account yang valid.");
  }

  let handledMessages = 0;
  let handledStatuses = 0;
  for (const entry of payload.entry) {
    for (const change of entry.changes || []) {
      if (change.field !== "messages") continue;
      const value = change.value || {};
      const phoneNumberId = value.metadata?.phone_number_id;
      if (!phoneNumberId) throw new Error("phone_number_id tidak tersedia pada event.");
      const orgResult = await client.query(
        "SELECT id FROM organizations WHERE whatsapp_phone_number_id = $1 LIMIT 1",
        [phoneNumberId],
      );
      const organizationId = orgResult.rows[0]?.id as string | undefined;
      if (!organizationId) throw new Error(`phone_number_id belum dipetakan ke organisasi: ${phoneNumberId}`);

      for (const status of value.statuses || []) {
        if (!status.id || !status.status) continue;
        const statusMap: Record<string, string> = { sent: "sent", delivered: "delivered", read: "read", failed: "failed" };
        const deliveryStatus = statusMap[status.status];
        if (!deliveryStatus) continue;
        await client.query(
          "UPDATE messages SET delivery_status = $1, metadata = metadata || $2::jsonb WHERE organization_id = $3 AND provider_message_id = $4",
          [deliveryStatus, JSON.stringify({ latest_status_timestamp: status.timestamp || null, provider_errors: status.errors || [] }), organizationId, status.id],
        );
        handledStatuses++;
      }

      for (const message of value.messages || []) {
        if (!message.id || !message.from) continue;
        const phoneDigits = message.from.replace(/\D/g, "");
        if (phoneDigits.length < 7 || phoneDigits.length > 18) {
          throw new Error("Nomor pengirim WhatsApp tidak valid.");
        }
        const whatsappNumber = `+${phoneDigits}`;
        const profileName = value.contacts?.find((contact) => contact.wa_id === message.from)?.profile?.name?.trim() || null;
        const customerResult = await client.query(
          `INSERT INTO customers (organization_id, whatsapp_number, full_name)
           VALUES ($1, $2, $3)
           ON CONFLICT (organization_id, whatsapp_number)
           DO UPDATE SET full_name = COALESCE(customers.full_name, EXCLUDED.full_name), updated_at = now()
           RETURNING id`,
          [organizationId, whatsappNumber, profileName],
        );
        const customerId = customerResult.rows[0].id as string;

        // Serialize conversation selection for this tenant/customer pair.
        const lockKey = createHash("sha256").update(`${organizationId}:${customerId}`).digest().readBigInt64BE(0).toString();
        await client.query("SELECT pg_advisory_xact_lock($1::bigint)", [lockKey]);
        const existingConversation = await client.query(
          `SELECT id FROM conversations
           WHERE organization_id = $1 AND customer_id = $2 AND channel = 'whatsapp' AND status IN ('open','pending_human')
           ORDER BY updated_at DESC LIMIT 1 FOR UPDATE`,
          [organizationId, customerId],
        );
        let conversationId = existingConversation.rows[0]?.id as string | undefined;
        if (!conversationId) {
          const created = await client.query(
            `INSERT INTO conversations (organization_id, customer_id, channel, status, last_message_at)
             VALUES ($1, $2, 'whatsapp', 'open', $3) RETURNING id`,
            [organizationId, customerId, messageTime(message.timestamp)],
          );
          conversationId = created.rows[0].id as string;
        }

        const body = messageBody(message).slice(0, 10000);
        const inserted = await client.query(
          `INSERT INTO messages (organization_id, conversation_id, provider_message_id, direction, sender_type, body, delivery_status, metadata, created_at)
           VALUES ($1, $2, $3, 'inbound', 'customer', $4, 'received', $5::jsonb, $6)
           ON CONFLICT (organization_id, provider_message_id) DO NOTHING
           RETURNING id`,
          [organizationId, conversationId, message.id, body, JSON.stringify({ provider: "meta_whatsapp", message_type: message.type || "unknown", provider_timestamp: message.timestamp || null, context_message_id: message.context?.id || null }), messageTime(message.timestamp)],
        );
        if (inserted.rowCount) {
          await client.query(
            "UPDATE conversations SET last_message_at = GREATEST(COALESCE(last_message_at, $1), $1), updated_at = now() WHERE id = $2 AND organization_id = $3",
            [messageTime(message.timestamp), conversationId, organizationId],
          );
          handledMessages++;
        }
      }
    }
  }
  return { handledMessages, handledStatuses };
}

export async function POST(request: NextRequest) {
  if (!authorize(request)) {
    return NextResponse.json({ error: "Akses pemroses webhook ditolak." }, { status: process.env.WHATSAPP_PROCESSOR_SECRET ? 401 : 503 });
  }
  let requestedBatch = MAX_BATCH;
  let retryFailed = false;
  try {
    const body = await request.json().catch(() => ({}));
    if (body && typeof body === "object" && "retryFailed" in body) retryFailed = (body as { retryFailed: unknown }).retryFailed === true;
    if (body && typeof body === "object" && "limit" in body) {
      const limit = Number((body as { limit: unknown }).limit);
      if (!Number.isInteger(limit) || limit < 1 || limit > MAX_BATCH) {
        return NextResponse.json({ error: `limit harus bilangan bulat 1–${MAX_BATCH}.` }, { status: 400 });
      }
      requestedBatch = limit;
    }
  } catch {
    return NextResponse.json({ error: "Format permintaan tidak valid." }, { status: 400 });
  }

  const client = await getPool().connect();
  let processed = 0;
  let failed = 0;
  let messages = 0;
  let statuses = 0;
  try {
    await client.query("BEGIN");
    const pending = await client.query(
      `SELECT id, payload FROM webhook_events
       WHERE provider = 'meta_whatsapp'
         AND (processing_status = 'pending' OR ($2::boolean AND processing_status = 'failed' AND attempts < 10))
       ORDER BY received_at ASC LIMIT $1 FOR UPDATE SKIP LOCKED`,
      [requestedBatch, retryFailed],
    );
    for (const event of pending.rows as Array<{ id: string; payload: MetaPayload }>) {
      const savepoint = `event_${processed + failed}`;
      await client.query(`SAVEPOINT ${savepoint}`);
      try {
        await client.query("UPDATE webhook_events SET processing_status = 'processing', attempts = attempts + 1 WHERE id = $1", [event.id]);
        const result = await processPayload(client, event.payload);
        await client.query(
          "UPDATE webhook_events SET processing_status = 'processed', processed_at = now(), last_error = NULL WHERE id = $1",
          [event.id],
        );
        await client.query(`RELEASE SAVEPOINT ${savepoint}`);
        processed++;
        messages += result.handledMessages;
        statuses += result.handledStatuses;
      } catch (error) {
        await client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
        const reason = (error instanceof Error ? error.message : "Kesalahan pemrosesan").slice(0, 500);
        await client.query(
          "UPDATE webhook_events SET processing_status = 'failed', attempts = attempts + 1, last_error = $2 WHERE id = $1",
          [event.id, reason],
        );
        await client.query(`RELEASE SAVEPOINT ${savepoint}`);
        failed++;
      }
    }
    await client.query("COMMIT");
    return NextResponse.json({ accepted: true, claimed: pending.rowCount || 0, processed, failed, inbound_messages_saved: messages, delivery_status_updates: statuses });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    console.error("WhatsApp event processor failed", error instanceof Error ? error.message : "unknown error");
    return NextResponse.json({ error: "Pemrosesan webhook gagal; event akan tetap dapat diproses ulang." }, { status: 503 });
  } finally {
    client.release();
  }
}
