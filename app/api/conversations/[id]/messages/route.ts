import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import type { PoolClient } from "pg";
import { getSession } from "@/lib/auth";
import { getPool } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const staffRoles = new Set(["owner", "admin", "manager", "staff", "dispatcher"]);
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const customerServiceWindowMs = 24 * 60 * 60 * 1000;

type MetaSendResponse = { messages?: Array<{ id?: string }>; error?: { message?: string; code?: number; type?: string } };

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Autentikasi diperlukan." }, { status: 401 });
  if (!staffRoles.has(session.role)) {
    return NextResponse.json({ error: "Akun ini tidak memiliki izin untuk mengirim balasan WhatsApp." }, { status: 403 });
  }

  const { id: conversationId } = await context.params;
  if (!uuidPattern.test(conversationId)) return NextResponse.json({ error: "ID percakapan tidak valid." }, { status: 400 });

  let body: { text?: unknown; requestId?: unknown };
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: "Format permintaan tidak valid." }, { status: 400 }); }

  const text = typeof body.text === "string" ? body.text.trim() : "";
  const requestId = typeof body.requestId === "string" ? body.requestId : "";
  if (!text || text.length > 4000) {
    return NextResponse.json({ error: "Isi balasan wajib diisi dan maksimal 4.000 karakter." }, { status: 400 });
  }
  if (!uuidPattern.test(requestId)) {
    return NextResponse.json({ error: "ID permintaan tidak valid. Muat ulang halaman lalu coba lagi." }, { status: 400 });
  }

  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
  const graphVersion = process.env.WHATSAPP_GRAPH_API_VERSION || "";
  if (!accessToken || !/^v\d+\.\d+$/.test(graphVersion)) {
    return NextResponse.json({ error: "Pengiriman WhatsApp belum dikonfigurasi. Token dan versi Graph API harus disetel di server." }, { status: 503 });
  }

  const pool = getPool();
  let client: PoolClient | undefined;
  let outboundId = "";
  let phoneNumberId = "";
  let recipient = "";
  try {
    client = await pool.connect();
    await client.query("BEGIN");
    const result = await client.query(
      `SELECT c.id, c.status, c.channel, cu.whatsapp_number,
              o.whatsapp_phone_number_id,
              (SELECT MAX(m.created_at) FROM messages m
               WHERE m.organization_id = c.organization_id
                 AND m.conversation_id = c.id AND m.direction = 'inbound') AS latest_inbound_at
       FROM conversations c
       JOIN customers cu ON cu.id = c.customer_id AND cu.organization_id = c.organization_id
       JOIN organizations o ON o.id = c.organization_id
       WHERE c.id = $1 AND c.organization_id = $2
       FOR UPDATE OF c`,
      [conversationId, session.organizationId],
    );
    const conversation = result.rows[0];
    if (!conversation) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "Percakapan tidak ditemukan." }, { status: 404 });
    }
    if (conversation.channel !== "whatsapp") {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "Balasan ini hanya mendukung percakapan WhatsApp." }, { status: 409 });
    }
    if (!["open", "pending_human"].includes(conversation.status)) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "Buka kembali percakapan sebelum mengirim balasan." }, { status: 409 });
    }
    phoneNumberId = String(conversation.whatsapp_phone_number_id || "");
    if (!phoneNumberId) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "Nomor WhatsApp Meta belum dipetakan ke organisasi ini." }, { status: 503 });
    }
    const latestInboundAt = conversation.latest_inbound_at ? new Date(conversation.latest_inbound_at).getTime() : NaN;
    const messageAge = Date.now() - latestInboundAt;
    if (!Number.isFinite(latestInboundAt) || messageAge < -60_000 || messageAge > customerServiceWindowMs) {
      await client.query("ROLLBACK");
      return NextResponse.json({
        error: "Jendela layanan 24 jam telah berakhir atau pesan masuk belum tersedia. Balasan bebas tidak dikirim; gunakan template WhatsApp yang disetujui setelah fitur template tersedia.",
        code: "WHATSAPP_24H_WINDOW_CLOSED",
      }, { status: 409 });
    }

    const existing = await client.query(
      "SELECT id, delivery_status, provider_message_id FROM messages WHERE organization_id = $1 AND client_request_id = $2 LIMIT 1",
      [session.organizationId, requestId],
    );
    if (existing.rows[0]) {
      await client.query("COMMIT");
      const prior = existing.rows[0];
      return NextResponse.json({
        data: prior,
        message: prior.delivery_status === "sent" || prior.delivery_status === "delivered" || prior.delivery_status === "read"
          ? "Balasan ini sudah dikirim; permintaan duplikat tidak dikirim ulang."
          : "Permintaan ini sudah tercatat. Periksa status pesan sebelum mencoba lagi.",
        duplicate: true,
      }, { status: prior.delivery_status === "failed" ? 502 : 200 });
    }

    recipient = String(conversation.whatsapp_number || "").replace(/\D/g, "");
    if (recipient.length < 7 || recipient.length > 18) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "Nomor WhatsApp pelanggan tidak valid." }, { status: 409 });
    }
    const inserted = await client.query(
      `INSERT INTO messages
         (organization_id, conversation_id, client_request_id, direction, sender_type, body, delivery_status, metadata)
       VALUES ($1, $2, $3, 'outbound', 'staff', $4, 'queued', $5::jsonb)
       ON CONFLICT (organization_id, client_request_id) WHERE client_request_id IS NOT NULL DO NOTHING
       RETURNING id`,
      [session.organizationId, conversationId, requestId, text, JSON.stringify({ provider: "meta_whatsapp", requested_by: session.userId })],
    );
    if (!inserted.rows[0]) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "Permintaan balasan yang sama sedang diproses. Muat ulang percakapan sebelum mencoba lagi." }, { status: 409 });
    }
    outboundId = String(inserted.rows[0].id);
    await client.query(
      "UPDATE conversations SET last_message_at = now(), updated_at = now() WHERE id = $1 AND organization_id = $2",
      [conversationId, session.organizationId],
    );
    await client.query(
      "INSERT INTO audit_logs (organization_id, actor_user_id, actor_type, action, entity_type, entity_id, details) VALUES ($1, $2, 'user', 'whatsapp.staff_reply.queued', 'message', $3, $4::jsonb)",
      [session.organizationId, session.userId, outboundId, JSON.stringify({ conversationId, characterCount: text.length, requestId })],
    );
    await client.query("COMMIT");
  } catch (error) {
    if (client) await client.query("ROLLBACK").catch(() => undefined);
    console.error("WhatsApp reply preparation failed", error instanceof Error ? error.message : "unknown error");
    return NextResponse.json({ error: "Balasan belum dapat disiapkan." }, { status: 503 });
  } finally {
    client?.release();
  }

  let providerMessageId = "";
  try {
    const response = await fetch(`https://graph.facebook.com/${graphVersion}/${phoneNumberId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: recipient,
        type: "text",
        text: { preview_url: false, body: text },
      }),
      signal: AbortSignal.timeout(15_000),
      cache: "no-store",
    });
    const payload = await response.json().catch(() => ({})) as MetaSendResponse;
    providerMessageId = payload.messages?.[0]?.id || "";
    if (!response.ok || !providerMessageId) {
      const ambiguous = response.status >= 500 || response.status === 429 || response.ok;
      const status = ambiguous ? "queued" : "failed";
      await pool.query(
        "UPDATE messages SET delivery_status = $1, metadata = metadata || $2::jsonb WHERE id = $3 AND organization_id = $4",
        [status, JSON.stringify({ provider_error_code: payload.error?.code || null, send_outcome_unknown: ambiguous }), outboundId, session.organizationId],
      );
      if (ambiguous) {
        return NextResponse.json({
          data: { id: outboundId, delivery_status: "queued" },
          message: "Meta belum memberi hasil pengiriman yang pasti. Pesan tidak dikirim ulang otomatis untuk mencegah duplikasi; periksa status sebelum mengambil tindakan.",
          outcomeUnknown: true,
        }, { status: 202 });
      }
      await pool.query(
        "INSERT INTO audit_logs (organization_id, actor_user_id, actor_type, action, entity_type, entity_id, details) VALUES ($1, $2, 'user', 'whatsapp.staff_reply.failed', 'message', $3, $4::jsonb)",
        [session.organizationId, session.userId, outboundId, JSON.stringify({ providerStatus: response.status, providerErrorCode: payload.error?.code || null })],
      );
      return NextResponse.json({ error: "Meta menolak balasan. Periksa konfigurasi WhatsApp dan status pesan." }, { status: 502 });
    }
  } catch {
    await pool.query(
      "UPDATE messages SET delivery_status = 'queued', metadata = metadata || $1::jsonb WHERE id = $2 AND organization_id = $3",
      [JSON.stringify({ send_outcome_unknown: true }), outboundId, session.organizationId],
    ).catch(() => undefined);
    return NextResponse.json({
      data: { id: outboundId, delivery_status: "queued" },
      message: "Koneksi ke Meta terputus sebelum hasil pengiriman diketahui. Pesan tidak dikirim ulang otomatis untuk mencegah duplikasi; periksa status sebelum mengambil tindakan.",
      outcomeUnknown: true,
    }, { status: 202 });
  }

  try {
    await pool.query(
      "UPDATE messages SET provider_message_id = $1, delivery_status = 'sent', metadata = metadata || $2::jsonb WHERE id = $3 AND organization_id = $4",
      [providerMessageId, JSON.stringify({ provider: "meta_whatsapp", sent_at: new Date().toISOString() }), outboundId, session.organizationId],
    );
    await pool.query(
      "INSERT INTO audit_logs (organization_id, actor_user_id, actor_type, action, entity_type, entity_id, details) VALUES ($1, $2, 'user', 'whatsapp.staff_reply.sent', 'message', $3, $4::jsonb)",
      [session.organizationId, session.userId, outboundId, JSON.stringify({ providerMessageId })],
    );
  } catch (error) {
    // The provider accepted the message. Keep the durable queued record and never auto-send it again.
    console.error("WhatsApp reply persistence after provider acceptance failed", error instanceof Error ? error.message : "unknown error");
    return NextResponse.json({
      data: { id: outboundId, delivery_status: "queued" },
      message: "Meta menerima permintaan, tetapi status akhir belum tersimpan di CRM. Jangan kirim ulang; periksa riwayat/status provider.",
      outcomeUnknown: true,
    }, { status: 202 });
  }

  return NextResponse.json({
    data: { id: outboundId, provider_message_id: providerMessageId, delivery_status: "sent" },
    message: "Balasan dikirim ke Meta. Status delivered/read akan diperbarui dari webhook.",
  }, { status: 200 });
}
