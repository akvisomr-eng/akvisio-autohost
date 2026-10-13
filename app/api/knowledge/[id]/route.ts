import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getPool } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EDIT_ROLES = new Set(["owner", "admin", "manager", "staff"]);
const PUBLISH_ROLES = new Set(["owner", "admin", "manager"]);
const CATEGORIES = new Set(["faq", "pricing", "policy", "vehicle", "contact", "other"]);

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Autentikasi diperlukan." }, { status: 401 });
  if (!EDIT_ROLES.has(session.role)) return NextResponse.json({ error: "Peran akun tidak diizinkan mengubah knowledge base." }, { status: 403 });

  const { id } = await context.params;
  let body: { title?: unknown; category?: unknown; content?: unknown; isPublished?: unknown };
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: "Format permintaan tidak valid." }, { status: 400 }); }
  if (body.isPublished === true && !PUBLISH_ROLES.has(session.role)) {
    return NextResponse.json({ error: "Hanya owner, admin, atau manager yang dapat menerbitkan knowledge." }, { status: 403 });
  }

  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const currentResult = await client.query(
      "SELECT id, title, category, content, is_published FROM knowledge_documents WHERE id = $1 AND organization_id = $2 FOR UPDATE",
      [id, session.organizationId],
    );
    const current = currentResult.rows[0] as { id: string; title: string; category: string; content: string; is_published: boolean } | undefined;
    if (!current) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "Dokumen knowledge tidak ditemukan." }, { status: 404 });
    }

    const title = body.title === undefined ? current.title : typeof body.title === "string" ? body.title.trim() : "";
    const category = body.category === undefined ? current.category : typeof body.category === "string" ? body.category : "";
    const content = body.content === undefined ? current.content : typeof body.content === "string" ? body.content.trim() : "";
    if (!title || title.length > 160 || !content || content.length > 12_000 || !CATEGORIES.has(category)) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "Judul, kategori, atau konten tidak valid. Konten maksimal 12.000 karakter." }, { status: 400 });
    }

    const contentChanged = title !== current.title || category !== current.category || content !== current.content;
    const publishing = body.isPublished === true;
    const unpublishing = body.isPublished === false;
    // Any content edit withdraws the old approval. It must be reviewed and published again.
    const isPublished = contentChanged ? false : publishing ? true : unpublishing ? false : current.is_published;
    const reviewedBy = isPublished && (publishing || !contentChanged) ? session.userId : null;
    const reviewedAt = isPublished && (publishing || !contentChanged) ? new Date().toISOString() : null;

    const updated = await client.query(
      `UPDATE knowledge_documents
       SET title = $1, category = $2, content = $3, is_published = $4,
           reviewed_by = $5, reviewed_at = $6, updated_at = now()
       WHERE id = $7 AND organization_id = $8
       RETURNING id, title, category, content, is_published, reviewed_at, created_at, updated_at`,
      [title, category, content, isPublished, reviewedBy, reviewedAt, id, session.organizationId],
    );
    const action = isPublished ? "knowledge.published" : contentChanged ? "knowledge.edited_unpublished" : "knowledge.unpublished";
    await client.query(
      `INSERT INTO audit_logs (organization_id, actor_user_id, actor_type, action, entity_type, entity_id, details)
       VALUES ($1, $2, 'user', $3, 'knowledge_document', $4, $5::jsonb)`,
      [session.organizationId, session.userId, action, id, JSON.stringify({ contentChanged, isPublished })],
    );
    await client.query("COMMIT");
    return NextResponse.json({ data: updated.rows[0], note: contentChanged ? "Konten berubah; dokumen otomatis kembali menjadi draft dan perlu ditinjau ulang." : undefined });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    console.error("Knowledge document update failed", error instanceof Error ? error.message : "unknown error");
    return NextResponse.json({ error: "Knowledge gagal diperbarui." }, { status: 503 });
  } finally { client.release(); }
}
