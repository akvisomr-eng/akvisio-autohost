import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getPool } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EDIT_ROLES = new Set(["owner", "admin", "manager", "staff"]);
const CATEGORIES = new Set(["faq", "pricing", "policy", "vehicle", "contact", "other"]);

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Autentikasi diperlukan." }, { status: 401 });
  try {
    const result = await getPool().query(
      `SELECT id, title, category, content, is_published, reviewed_at, created_at, updated_at
       FROM knowledge_documents WHERE organization_id = $1
       ORDER BY updated_at DESC LIMIT 200`,
      [session.organizationId],
    );
    return NextResponse.json({ data: result.rows });
  } catch (error) {
    console.error("Knowledge list failed", error instanceof Error ? error.message : "unknown error");
    return NextResponse.json({ error: "Knowledge base belum dapat dimuat." }, { status: 503 });
  }
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Autentikasi diperlukan." }, { status: 401 });
  if (!EDIT_ROLES.has(session.role)) return NextResponse.json({ error: "Peran akun tidak diizinkan mengubah knowledge base." }, { status: 403 });

  let body: { title?: unknown; category?: unknown; content?: unknown };
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: "Format permintaan tidak valid." }, { status: 400 }); }
  const title = typeof body.title === "string" ? body.title.trim() : "";
  const category = typeof body.category === "string" ? body.category : "faq";
  const content = typeof body.content === "string" ? body.content.trim() : "";
  if (!title || title.length > 160) return NextResponse.json({ error: "Judul wajib diisi dan maksimal 160 karakter." }, { status: 400 });
  if (!CATEGORIES.has(category)) return NextResponse.json({ error: "Kategori knowledge tidak valid." }, { status: 400 });
  if (!content || content.length > 12_000) return NextResponse.json({ error: "Konten wajib diisi dan maksimal 12.000 karakter." }, { status: 400 });

  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(
      `INSERT INTO knowledge_documents (organization_id, title, category, content, is_published)
       VALUES ($1, $2, $3, $4, false)
       RETURNING id, title, category, content, is_published, reviewed_at, created_at, updated_at`,
      [session.organizationId, title, category, content],
    );
    const doc = result.rows[0];
    await client.query(
      `INSERT INTO audit_logs (organization_id, actor_user_id, actor_type, action, entity_type, entity_id, details)
       VALUES ($1, $2, 'user', 'knowledge.created_draft', 'knowledge_document', $3, $4::jsonb)`,
      [session.organizationId, session.userId, doc.id, JSON.stringify({ category, title })],
    );
    await client.query("COMMIT");
    return NextResponse.json({ data: doc }, { status: 201 });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    console.error("Knowledge draft creation failed", error instanceof Error ? error.message : "unknown error");
    return NextResponse.json({ error: "Knowledge draft gagal disimpan." }, { status: 503 });
  } finally { client.release(); }
}
