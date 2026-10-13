import { NextRequest, NextResponse } from "next/server";
import type { PoolClient } from "pg";
import { getSession } from "@/lib/auth";
import { getPool } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const transitions: Record<string, string[]> = {
  pending: ["held", "confirmed", "cancelled", "rejected", "expired"],
  held: ["confirmed", "cancelled", "rejected", "expired"],
  confirmed: ["ongoing", "cancelled"],
  ongoing: ["completed"],
};

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Autentikasi diperlukan." }, { status: 401 });
  const { id } = await context.params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
    return NextResponse.json({ error: "ID pemesanan tidak valid." }, { status: 400 });
  }

  let body: { status?: string };
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: "Format permintaan tidak valid." }, { status: 400 }); }

  const nextStatus = body.status;
  if (!nextStatus || !["held", "confirmed", "ongoing", "completed", "cancelled", "rejected", "expired"].includes(nextStatus)) {
    return NextResponse.json({ error: "Status tujuan tidak valid." }, { status: 400 });
  }
  if (!["owner", "admin", "manager", "staff"].includes(session.role)) {
    return NextResponse.json({ error: "Peran Anda tidak diizinkan mengubah status pemesanan." }, { status: 403 });
  }
  if (session.role === "staff" && !["cancelled"].includes(nextStatus)) {
    return NextResponse.json({ error: "Staf hanya dapat membatalkan pemesanan yang belum diproses." }, { status: 403 });
  }

  let client: PoolClient | undefined;
  try {
    client = await getPool().connect();
    await client.query("BEGIN");
    const found = await client.query(
      "SELECT id, status FROM bookings WHERE id = $1 AND organization_id = $2 FOR UPDATE",
      [id, session.organizationId],
    );
    const booking = found.rows[0];
    if (!booking) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "Pemesanan tidak ditemukan." }, { status: 404 });
    }
    if (!transitions[booking.status]?.includes(nextStatus)) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: `Perubahan status dari ${booking.status} ke ${nextStatus} tidak diizinkan.` }, { status: 409 });
    }
    const updated = await client.query(
      "UPDATE bookings SET status = $1, updated_at = now() WHERE id = $2 AND organization_id = $3 RETURNING id, booking_code, status, updated_at",
      [nextStatus, id, session.organizationId],
    );
    await client.query(
      "INSERT INTO audit_logs (organization_id, actor_user_id, actor_type, action, entity_type, entity_id, metadata) VALUES ($1, $2, 'user', $3, 'booking', $4, $5::jsonb)",
      [session.organizationId, session.userId, `booking.status.${nextStatus}`, id, JSON.stringify({ previousStatus: booking.status, nextStatus })],
    );
    await client.query("COMMIT");
    return NextResponse.json({ data: updated.rows[0] });
  } catch (error) {
    if (client) await client.query("ROLLBACK").catch(() => undefined);
    console.error("Booking status update failed", error instanceof Error ? error.message : "unknown error");
    return NextResponse.json({ error: "Status pemesanan gagal diperbarui." }, { status: 503 });
  } finally {
    client?.release();
  }
}
