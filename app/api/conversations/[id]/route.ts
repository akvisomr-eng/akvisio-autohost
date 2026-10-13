import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getPool } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const allowedStatuses = new Set(["open", "pending_human", "resolved", "archived"]);
const transitions: Record<string, string[]> = {
  open: ["pending_human", "resolved", "archived"],
  pending_human: ["open", "resolved", "archived"],
  resolved: ["open", "archived"],
  archived: ["open"],
};

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Autentikasi diperlukan." }, { status: 401 });
  if (session.role === "viewer") return NextResponse.json({ error: "Akun hanya-baca tidak dapat mengubah status percakapan." }, { status: 403 });

  const { id } = await context.params;
  let body: { status?: string };
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: "Format permintaan tidak valid." }, { status: 400 }); }
  const nextStatus = body.status || "";
  if (!allowedStatuses.has(nextStatus)) return NextResponse.json({ error: "Status percakapan tidak valid." }, { status: 400 });

  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const current = await client.query(
      "SELECT id, status FROM conversations WHERE id = $1 AND organization_id = $2 FOR UPDATE",
      [id, session.organizationId],
    );
    if (!current.rows[0]) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "Percakapan tidak ditemukan." }, { status: 404 });
    }
    const previousStatus = current.rows[0].status as string;
    if (previousStatus !== nextStatus && !transitions[previousStatus]?.includes(nextStatus)) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: `Perubahan status dari ${previousStatus} ke ${nextStatus} tidak diizinkan.` }, { status: 409 });
    }
    const updated = await client.query(
      "UPDATE conversations SET status = $1, updated_at = now() WHERE id = $2 AND organization_id = $3 RETURNING id, status, updated_at",
      [nextStatus, id, session.organizationId],
    );
    await client.query(
      "INSERT INTO audit_logs (organization_id, actor_user_id, actor_type, action, entity_type, entity_id, details) VALUES ($1, $2, 'user', $3, 'conversation', $4, $5::jsonb)",
      [session.organizationId, session.userId, `conversation.status.${nextStatus}`, id, JSON.stringify({ previousStatus, nextStatus })],
    );
    await client.query("COMMIT");
    return NextResponse.json({ data: updated.rows[0] });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    console.error("Conversation status update failed", error instanceof Error ? error.message : "unknown error");
    return NextResponse.json({ error: "Status percakapan gagal diperbarui." }, { status: 503 });
  } finally {
    client.release();
  }
}
