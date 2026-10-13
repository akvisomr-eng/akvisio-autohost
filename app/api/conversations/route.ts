import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getPool } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Autentikasi diperlukan." }, { status: 401 });
  const conversationId = request.nextUrl.searchParams.get("conversationId");
  try {
    const pool = getPool();
    if (conversationId) {
      const conversation = await pool.query(
        `SELECT c.id, c.status, c.channel, c.last_message_at, c.created_at,
                cu.id AS customer_id, cu.full_name AS customer_name, cu.whatsapp_number
         FROM conversations c JOIN customers cu
           ON cu.id = c.customer_id AND cu.organization_id = c.organization_id
         WHERE c.id = $1 AND c.organization_id = $2 LIMIT 1`,
        [conversationId, session.organizationId],
      );
      if (!conversation.rows[0]) return NextResponse.json({ error: "Percakapan tidak ditemukan." }, { status: 404 });
      const messages = await pool.query(
        `SELECT id, provider_message_id, direction, sender_type, body, delivery_status, metadata, created_at
         FROM messages WHERE conversation_id = $1 AND organization_id = $2
         ORDER BY created_at ASC LIMIT 200`,
        [conversationId, session.organizationId],
      );
      return NextResponse.json({ conversation: conversation.rows[0], messages: messages.rows });
    }
    const result = await pool.query(
      `SELECT c.id, c.status, c.channel, c.last_message_at, c.created_at,
              cu.full_name AS customer_name, cu.whatsapp_number,
              lm.body AS last_message_body, lm.direction AS last_message_direction,
              COALESCE(unread.count, 0)::int AS inbound_count
       FROM conversations c
       JOIN customers cu ON cu.id = c.customer_id AND cu.organization_id = c.organization_id
       LEFT JOIN LATERAL (
         SELECT m.body, m.direction FROM messages m
         WHERE m.conversation_id = c.id AND m.organization_id = c.organization_id
         ORDER BY m.created_at DESC LIMIT 1
       ) lm ON true
       LEFT JOIN LATERAL (
         SELECT COUNT(*) AS count FROM messages m
         WHERE m.conversation_id = c.id AND m.organization_id = c.organization_id AND m.direction = 'inbound'
       ) unread ON true
       WHERE c.organization_id = $1
       ORDER BY COALESCE(c.last_message_at, c.created_at) DESC
       LIMIT 100`,
      [session.organizationId],
    );
    return NextResponse.json({ data: result.rows });
  } catch (error) {
    console.error("Conversation inbox query failed", error instanceof Error ? error.message : "unknown error");
    return NextResponse.json({ error: "Inbox belum dapat dimuat." }, { status: 503 });
  }
}
