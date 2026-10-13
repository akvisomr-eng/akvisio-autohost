"use client";

import { useCallback, useEffect, useState } from "react";

type Conversation = {
  id: string; status: string; channel: string; last_message_at: string | null; created_at: string;
  customer_name: string | null; whatsapp_number: string; last_message_body: string | null;
  last_message_direction: string | null; inbound_count: number;
};
type Message = { id: string; direction: string; sender_type: string; body: string; delivery_status: string; created_at: string; metadata: Record<string, unknown> };
type Thread = { conversation: { id: string; status: string; channel: string; customer_id: string; customer_name: string | null; whatsapp_number: string; last_message_at: string | null; created_at: string }; messages: Message[] };

const statusLabel: Record<string, string> = { open: "Terbuka", pending_human: "Perlu staf", resolved: "Selesai", archived: "Diarsipkan" };
const statusTone: Record<string, string> = { open: "open", pending_human: "handoff", resolved: "resolved", archived: "archived" };
const formatTime = (value: string | null) => value ? new Date(value).toLocaleString("id-ID", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "Belum ada pesan";

export default function InboxWorkspace() {
  const [items, setItems] = useState<Conversation[]>([]);
  const [thread, setThread] = useState<Thread | null>(null);
  const [selectedId, setSelectedId] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [replyText, setReplyText] = useState("");
  const [replyRequestId, setReplyRequestId] = useState("");
  const [drafting, setDrafting] = useState(false);

  const loadThread = useCallback(async (id: string) => {
    const response = await fetch(`/api/conversations?conversationId=${encodeURIComponent(id)}`, { cache: "no-store" });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Percakapan gagal dimuat.");
    setThread(result as Thread);
  }, []);

  const loadList = useCallback(async (preferredId?: string) => {
    setLoading(true); setError("");
    try {
      const response = await fetch("/api/conversations", { cache: "no-store" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Inbox gagal dimuat.");
      const data = (result.data || []) as Conversation[];
      setItems(data);
      const nextId = preferredId || selectedId || data[0]?.id || "";
      if (nextId && data.some((item) => item.id === nextId)) {
        setSelectedId(nextId);
        await loadThread(nextId);
      } else {
        setSelectedId("");
        setThread(null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Inbox gagal dimuat.");
    } finally { setLoading(false); }
  }, [selectedId, loadThread]);



  useEffect(() => { void loadList(); }, [loadList]);

  async function selectConversation(id: string) {
    setSelectedId(id); setError(""); setMessage("");
    try { await loadThread(id); }
    catch (e) { setError(e instanceof Error ? e.message : "Percakapan gagal dimuat."); }
  }

  async function setStatus(status: string) {
    if (!selectedId) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const response = await fetch(`/api/conversations/${selectedId}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Status percakapan gagal diperbarui.");
      setMessage(status === "pending_human" ? "Percakapan ditandai untuk ditangani staf." : "Status percakapan diperbarui.");
      await loadList(selectedId);
    } catch (e) { setError(e instanceof Error ? e.message : "Status percakapan gagal diperbarui."); }
    finally { setBusy(false); }
  }

  async function generateAiDraft() {
    if (!selectedId || drafting || busy) return;
    setDrafting(true); setError(""); setMessage("");
    try {
      const response = await fetch(`/api/conversations/${selectedId}/ai-draft`, { method: "POST", cache: "no-store" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Draf AI belum dapat dibuat.");
      setReplyText(String(result.draft || ""));
      setReplyRequestId("");
      setMessage("Draf AI dibuat dan belum dikirim. Periksa fakta serta bahasanya sebelum mengirim.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Draf AI belum dapat dibuat.");
    } finally { setDrafting(false); }
  }

  async function sendReply(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedId || !replyText.trim() || busy) return;
    const requestId = replyRequestId || crypto.randomUUID();
    setReplyRequestId(requestId);
    setBusy(true); setError(""); setMessage("");
    try {
      const response = await fetch(`/api/conversations/${selectedId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: replyText.trim(), requestId }),
      });
      const result = await response.json();
      if (!response.ok) {
        setReplyRequestId("");
        throw new Error(result.error || "Balasan WhatsApp gagal dikirim.");
      }
      setMessage(result.message || "Permintaan balasan diproses.");
      setReplyText("");
      setReplyRequestId("");
      await loadList(selectedId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Balasan WhatsApp gagal dikirim.");
      // Keep the same request ID after a network error so a retry cannot create a duplicate send.
    } finally { setBusy(false); }
  }

  return (
    <section className="inbox-workspace">
      <header className="inbox-heading">
        <div><p className="eyebrow">CUSTOMER CARE</p><h2>Inbox percakapan</h2><p>Pesan masuk tersimpan di CRM. Balasan WhatsApp dan AI otomatis belum diaktifkan.</p></div>
        <button className="secondary-button" type="button" onClick={() => void loadList(selectedId)} disabled={loading}>↻ Muat ulang</button>
      </header>
      {error && <p className="alert error" role="alert">{error}</p>}
      {message && <p className="alert success" role="status">{message}</p>}
      <div className="inbox-layout">
        <aside className="inbox-list panel">
          <div className="inbox-list-heading"><strong>Semua percakapan</strong><span>{items.length}</span></div>
          {loading && !items.length ? <p className="empty-state">Memuat inbox…</p> : items.length ? items.map((item) => (
            <button type="button" key={item.id} className={`conversation-row ${selectedId === item.id ? "selected" : ""}`} onClick={() => void selectConversation(item.id)}>
              <span className="conversation-avatar">{(item.customer_name || item.whatsapp_number).slice(-1).toUpperCase()}</span>
              <span className="conversation-copy"><span className="conversation-top"><strong>{item.customer_name || item.whatsapp_number}</strong><small>{formatTime(item.last_message_at)}</small></span><span className="conversation-number">{item.whatsapp_number}</span><span className="conversation-preview">{item.last_message_body || "Belum ada pesan"}</span><span className={`conversation-status ${statusTone[item.status] || ""}`}>{statusLabel[item.status] || item.status}</span></span>
            </button>
          )) : <p className="empty-state">Belum ada percakapan. Setelah webhook dan pemroses diaktifkan, pesan pelanggan akan tampil di sini.</p>}
        </aside>
        <article className="inbox-thread panel">
          {thread ? <>
            <div className="thread-header"><div><p className="eyebrow">WHATSAPP</p><h3>{thread.conversation.customer_name || thread.conversation.whatsapp_number}</h3><p>{thread.conversation.whatsapp_number}</p></div><span className={`conversation-status ${statusTone[thread.conversation.status] || ""}`}>{statusLabel[thread.conversation.status] || thread.conversation.status}</span></div>
            <div className="thread-actions">
              {thread.conversation.status !== "pending_human" && thread.conversation.status !== "resolved" && <button className="primary-button" type="button" disabled={busy} onClick={() => void setStatus("pending_human")}>Alihkan ke staf</button>}
              {thread.conversation.status === "pending_human" && <button className="secondary-button" type="button" disabled={busy} onClick={() => void setStatus("open")}>Kembalikan ke antrean</button>}
              {thread.conversation.status !== "resolved" && <button className="secondary-button" type="button" disabled={busy} onClick={() => void setStatus("resolved")}>Tandai selesai</button>}
              {thread.conversation.status === "resolved" && <button className="secondary-button" type="button" disabled={busy} onClick={() => void setStatus("open")}>Buka kembali</button>}
            </div>
            <div className="message-history">
              {thread.messages.length ? thread.messages.map((item) => <div key={item.id} className={`message-line ${item.direction === "outbound" ? "outbound" : "inbound"}`}><div className="message-bubble"><span className="message-sender">{item.sender_type === "customer" ? "Pelanggan" : item.sender_type === "staff" ? "Staf" : item.sender_type === "ai" ? "AI Host" : "Sistem"}</span><p>{item.body}</p><small>{formatTime(item.created_at)}{item.direction === "outbound" ? ` · ${item.delivery_status}` : ""}</small></div></div>) : <p className="empty-state">Percakapan belum memiliki pesan.</p>}
            </div>
            <form className="reply-composer" onSubmit={(event) => void sendReply(event)}>
              <label htmlFor="whatsapp-reply">Balas melalui WhatsApp</label>
              <div className="draft-row"><button className="secondary-button" type="button" onClick={() => void generateAiDraft()} disabled={busy || drafting || ["resolved", "archived"].includes(thread.conversation.status)}>{drafting ? "Membuat draf…" : "Buat draf dengan AI Host"}</button><small>Draf hanya dibuat atas permintaan staf; tidak dikirim otomatis.</small></div>
              <textarea id="whatsapp-reply" value={replyText} onChange={(event) => setReplyText(event.target.value)} maxLength={4000} rows={3} placeholder="Tulis balasan untuk pelanggan…" disabled={busy || ["resolved", "archived"].includes(thread.conversation.status)} />
              <div className="reply-footer"><small>{replyText.length}/4000 karakter · Balasan teks bebas hanya tersedia dalam jendela layanan 24 jam.</small><button className="primary-button" type="submit" disabled={busy || !replyText.trim() || ["resolved", "archived"].includes(thread.conversation.status)}>{busy ? "Mengirim…" : "Kirim balasan"}</button></div>
              <p className="reply-note">Pesan dikirim melalui Meta WhatsApp Cloud API. Jika hasil provider tidak pasti, CRM tidak akan mengirim ulang otomatis.</p>
            </form>
          </> : <div className="thread-empty"><span aria-hidden="true">◌</span><h3>Pilih percakapan</h3><p>Pilih percakapan dari daftar untuk melihat riwayat dan mengelola alih tangan ke staf.</p></div>}
        </article>
      </div>
      <style jsx>{`
        .inbox-workspace{display:grid;gap:15px}.inbox-heading{display:flex;justify-content:space-between;align-items:center;gap:16px;background:#f1f7f3;border:1px solid #dfece3;border-radius:15px;padding:22px}.inbox-heading h2{margin:0 0 7px;font-size:22px;letter-spacing:-.5px}.inbox-heading p:not(.eyebrow){margin:0;color:var(--muted);font-size:12px;line-height:1.6}.inbox-layout{display:grid;grid-template-columns:minmax(270px,.82fr) minmax(0,1.5fr);gap:14px;min-height:570px}.inbox-list{padding:0;overflow:hidden}.inbox-list-heading{display:flex;justify-content:space-between;align-items:center;padding:16px;border-bottom:1px solid var(--line);font-size:12px}.inbox-list-heading span{background:#f0f4f1;border-radius:30px;padding:4px 8px}.conversation-row{display:flex;gap:10px;width:100%;text-align:left;padding:13px;border:0;border-bottom:1px solid var(--line);background:transparent;cursor:pointer;color:var(--foreground)}.conversation-row.selected{background:#eef6f0;box-shadow:inset 3px 0 #27724f}.conversation-avatar{display:grid;place-items:center;flex:0 0 36px;width:36px;height:36px;border-radius:50%;background:#dcebe0;color:#245a40;font-weight:700}.conversation-copy{display:grid;gap:5px;min-width:0;flex:1}.conversation-top{display:flex;justify-content:space-between;gap:8px;align-items:center}.conversation-top strong{font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.conversation-top small,.conversation-number{font-size:9px;color:var(--muted)}.conversation-preview{font-size:10px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100%}.conversation-status{display:inline-flex;align-self:flex-start;font-size:9px;border-radius:30px;padding:5px 8px;background:#eff1ef;color:#59635c;white-space:nowrap}.conversation-status.handoff{background:#fff2d8;color:#895d0b}.conversation-status.resolved{background:#e7f4ed;color:#176b4d}.conversation-status.archived{background:#f0f0f0;color:#777}.inbox-thread{padding:0;display:flex;flex-direction:column;min-width:0;overflow:hidden}.thread-header{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:18px;border-bottom:1px solid var(--line)}.thread-header h3{margin:0 0 4px;font-size:15px}.thread-header p:not(.eyebrow){margin:0;font-size:10px;color:var(--muted)}.thread-actions{display:flex;gap:8px;flex-wrap:wrap;padding:12px 18px;border-bottom:1px solid var(--line)}.thread-actions button{font-size:10px;padding:9px 12px}.message-history{display:flex;flex:1;flex-direction:column;gap:10px;padding:18px;overflow-y:auto;min-height:280px;max-height:500px;background:#f7f8f6}.message-line{display:flex}.message-line.outbound{justify-content:flex-end}.message-bubble{max-width:85%;border:1px solid #e2e6e1;border-radius:12px;padding:10px 12px;background:#fff}.outbound .message-bubble{background:#e8f5ec;border-color:#d2e8d8}.message-sender{font-size:9px;font-weight:700;color:#52645a}.message-bubble p{font-size:12px;line-height:1.6;margin:5px 0;white-space:pre-wrap;overflow-wrap:anywhere}.message-bubble small{font-size:9px;color:var(--muted)}.draft-row{display:flex;align-items:center;gap:10px;flex-wrap:wrap}.draft-row button{font-size:10px;padding:8px 11px}.draft-row small{font-size:9px;line-height:1.5;color:var(--muted)}.reply-composer{display:grid;gap:9px;margin:14px;padding:13px;background:#f7f8f6;border:1px solid #d9dfd9;border-radius:10px}.reply-composer label{font-size:11px;font-weight:700}.reply-composer textarea{width:100%;resize:vertical;min-height:80px;padding:10px;border:1px solid var(--line);border-radius:8px;background:#fff;color:var(--foreground);font:inherit;font-size:12px;line-height:1.5}.reply-footer{display:flex;justify-content:space-between;align-items:center;gap:10px}.reply-footer small,.reply-note{font-size:9px;line-height:1.5;color:var(--muted)}.reply-footer button{font-size:10px;padding:9px 12px;white-space:nowrap}.reply-note{margin:0}.thread-empty{display:grid;place-content:center;text-align:center;flex:1;padding:35px}.thread-empty>span{font-size:34px;color:#729681}.thread-empty h3{margin:10px 0 4px;font-size:15px}.thread-empty p{font-size:11px;line-height:1.6;color:var(--muted);max-width:260px}.inbox-workspace button:disabled{opacity:.55;cursor:wait}@media(max-width:850px){.inbox-layout{grid-template-columns:1fr}.inbox-list{max-height:340px;overflow-y:auto}.inbox-thread{min-height:500px}}@media(max-width:600px){.inbox-heading{align-items:flex-start;flex-direction:column;padding:17px}.inbox-heading h2{font-size:19px}.thread-header{align-items:flex-start}.thread-actions{padding:10px;gap:6px}.thread-actions button{flex:1}}
      `}</style>
    </section>
  );
}
