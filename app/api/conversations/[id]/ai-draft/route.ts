import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getPool } from "@/lib/db";
import { buildAiHostMessages, estimateAiHostCost, getAiHostDraftBlockReason, isAiHostRateLimited, isSafeAiHostBaseUrl, readAiHostProviderResponse } from "@/lib/ai-host";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 20;

const STAFF_ROLES = new Set(["owner", "admin", "manager", "staff", "dispatcher"]);

export async function POST(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Autentikasi diperlukan." }, { status: 401 });
  if (!STAFF_ROLES.has(session.role)) {
    return NextResponse.json({ error: "Peran akun tidak diizinkan membuat draf AI." }, { status: 403 });
  }

  // Draft generation is intentionally manual and never sends a WhatsApp message.
  if (process.env.AI_HOST_ENABLED !== "true") {
    return NextResponse.json({ error: "AI Host dinonaktifkan. Aktifkan hanya setelah provider dan kebijakan uji disiapkan." }, { status: 503 });
  }
  const apiKey = process.env.AI_HOST_API_KEY;
  const baseUrl = process.env.AI_HOST_BASE_URL?.replace(/\/+$/, "");
  const model = process.env.AI_HOST_MODEL;
  if (!apiKey || !baseUrl || !model || !isSafeAiHostBaseUrl(baseUrl)) {
    return NextResponse.json({ error: "Konfigurasi provider AI Host belum lengkap atau tidak aman." }, { status: 503 });
  }

  const { id } = await context.params;
  const pool = getPool();
  let runId: string | undefined;
  try {
    const conversationResult = await pool.query<{
      id: string; organization_id: string; status: string; tenant_name: string; locale: string;
    }>(
      `SELECT c.id, c.organization_id, c.status, o.name AS tenant_name, o.default_locale AS locale
       FROM conversations c JOIN organizations o ON o.id = c.organization_id
       WHERE c.id = $1 AND c.organization_id = $2 LIMIT 1`,
      [id, session.organizationId],
    );
    const conversation = conversationResult.rows[0];
    if (!conversation) return NextResponse.json({ error: "Percakapan tidak ditemukan." }, { status: 404 });
    const draftBlockReason = getAiHostDraftBlockReason(conversation.status);
    if (draftBlockReason === "human_handoff") {
      return NextResponse.json({ error: "Percakapan sedang ditangani staf manusia. Draf AI diblokir sampai staf membuka kembali penanganan AI." }, { status: 409 });
    }
    if (draftBlockReason === "conversation_closed") {
      return NextResponse.json({ error: "Percakapan sudah ditutup. Buka kembali sebelum membuat draf." }, { status: 409 });
    }

    const [knowledgeResult, historyResult] = await Promise.all([
      pool.query(
        `SELECT title, category, content FROM knowledge_documents
         WHERE organization_id = $1 AND is_published = true
         ORDER BY updated_at DESC LIMIT 8`,
        [session.organizationId],
      ),
      pool.query(
        `SELECT direction, sender_type, body FROM messages
         WHERE organization_id = $1 AND conversation_id = $2
         ORDER BY created_at DESC, id DESC LIMIT 12`,
        [session.organizationId, id],
      ),
    ]);
    const history = historyResult.rows.reverse() as Array<{ direction: string; sender_type: string; body: string }>;
    if (!history.length || history[history.length - 1].direction !== "inbound") {
      return NextResponse.json({ error: "Tidak ada pesan pelanggan terbaru untuk dijawab." }, { status: 409 });
    }

    // Serialize quota reservation per tenant so concurrent requests cannot all pass
    // the same count check. The running ai_runs row is inserted before releasing the lock.
    const reservation = await pool.connect();
    try {
      await reservation.query("BEGIN");
      await reservation.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [session.organizationId]);
      const rate = await reservation.query(
        `SELECT COUNT(*)::int AS count FROM ai_runs
         WHERE organization_id = $1 AND created_at > now() - interval '10 minutes'`,
        [session.organizationId],
      );
      if (isAiHostRateLimited(Number(rate.rows[0]?.count ?? 0))) {
        await reservation.query("ROLLBACK");
        return NextResponse.json({ error: "Batas draf AI sementara tercapai. Coba lagi beberapa menit." }, { status: 429 });
      }
      const insertedRun = await reservation.query(
        `INSERT INTO ai_runs (organization_id, conversation_id, provider, model, intent, status, safety_flags)
         VALUES ($1, $2, 'openai-compatible', $3, 'staff_requested_draft', 'running', $4::jsonb)
         RETURNING id`,
        [session.organizationId, id, model, JSON.stringify(["manual_draft_only", "no_outbound", "tenant_scoped_knowledge"])],
      );
      runId = insertedRun.rows[0].id as string;
      await reservation.query("COMMIT");
    } catch (error) {
      await reservation.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      reservation.release();
    }

    const messages = buildAiHostMessages({
      tenantName: conversation.tenant_name,
      locale: conversation.locale,
      knowledge: knowledgeResult.rows as Array<{ title: string; category: string; content: string }>,
      history,
    });
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model, messages, temperature: 0.2, max_tokens: 600 }),
      signal: AbortSignal.timeout(15_000),
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`AI_PROVIDER_HTTP_${response.status}`);
    const parsed = await readAiHostProviderResponse(response);
    const estimatedCostUsd = estimateAiHostCost(parsed.inputTokens, parsed.outputTokens, process.env.AI_HOST_INPUT_USD_PER_1K_TOKENS, process.env.AI_HOST_OUTPUT_USD_PER_1K_TOKENS);

    // Re-check the handoff state after the provider call. A human may have taken
    // ownership while generation was in flight; do not surface a stale AI draft.
    const completion = await pool.connect();
    try {
      await completion.query("BEGIN");
      const currentConversation = await completion.query<{ status: string }>(
        "SELECT status FROM conversations WHERE id = $1 AND organization_id = $2 FOR UPDATE",
        [id, session.organizationId],
      );
      const currentStatus = currentConversation.rows[0]?.status;
      if (!currentStatus) {
        await completion.query("ROLLBACK");
        return NextResponse.json({ error: "Percakapan tidak ditemukan." }, { status: 404 });
      }
      const currentBlockReason = getAiHostDraftBlockReason(currentStatus);
      if (currentBlockReason) {
        await completion.query(
          "UPDATE ai_runs SET status = 'blocked', safety_flags = safety_flags || $2::jsonb WHERE id = $1 AND organization_id = $3",
          [runId, JSON.stringify(["handoff_state_changed_during_generation", currentBlockReason]), session.organizationId],
        );
        await completion.query(
          `INSERT INTO audit_logs (organization_id, actor_user_id, actor_type, action, entity_type, entity_id, details)
           VALUES ($1, $2, 'user', 'ai_host.draft.blocked_after_generation', 'conversation', $3, $4::jsonb)`,
          [session.organizationId, session.userId, id, JSON.stringify({ aiRunId: runId, reason: currentBlockReason })],
        );
        await completion.query("COMMIT");
        return NextResponse.json({
          error: currentBlockReason === "human_handoff"
            ? "Staf telah mengambil alih percakapan saat draf dibuat. Draf AI dibatalkan."
            : "Percakapan telah ditutup saat draf dibuat. Draf AI dibatalkan.",
        }, { status: 409 });
      }
      await completion.query(
        `UPDATE ai_runs SET status = 'completed', input_tokens = $2, output_tokens = $3, estimated_cost = $4
         WHERE id = $1 AND organization_id = $5`,
        [runId, parsed.inputTokens ?? null, parsed.outputTokens ?? null, estimatedCostUsd ?? null, session.organizationId],
      );
      await completion.query(
        `INSERT INTO audit_logs (organization_id, actor_user_id, actor_type, action, entity_type, entity_id, details)
         VALUES ($1, $2, 'user', 'ai_host.draft.created', 'conversation', $3, $4::jsonb)`,
        [session.organizationId, session.userId, id, JSON.stringify({ aiRunId: runId, provider: "openai-compatible", model, estimatedCostUsd: estimatedCostUsd ?? null })],
      );
      await completion.query("COMMIT");
    } catch (error) {
      await completion.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      completion.release();
    }
    return NextResponse.json({ draft: parsed.content, aiRunId: runId, sent: false });
  } catch (error) {
    if (runId) {
      await pool.query(
        "UPDATE ai_runs SET status = 'failed', safety_flags = safety_flags || $2::jsonb WHERE id = $1 AND organization_id = $3",
        [runId, JSON.stringify(["provider_error"]), session.organizationId],
      ).catch(() => undefined);
    }
    console.error("AI Host draft generation failed", error instanceof Error ? error.message : "unknown error");
    return NextResponse.json({ error: "Draf AI belum dapat dibuat. Periksa konfigurasi provider dan log operasional." }, { status: 503 });
  }
}
