"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";

type KnowledgeDoc = {
  id: string; title: string; category: string; content: string; is_published: boolean;
  reviewed_at: string | null; created_at: string; updated_at: string;
};

const categories = [
  ["faq", "FAQ umum"], ["pricing", "Harga dan biaya"], ["policy", "Kebijakan layanan"],
  ["vehicle", "Informasi kendaraan"], ["contact", "Kontak dan jam layanan"], ["other", "Lainnya"],
];
const categoryLabel = Object.fromEntries(categories) as Record<string, string>;

export default function KnowledgeWorkspace() {
  const [items, setItems] = useState<KnowledgeDoc[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("faq");
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async (preferredId?: string) => {
    setLoading(true); setError("");
    try {
      const response = await fetch("/api/knowledge", { cache: "no-store" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Knowledge base gagal dimuat.");
      const data = (result.data || []) as KnowledgeDoc[];
      setItems(data);
      const selected = data.find((item) => item.id === (preferredId || selectedId));
      if (selected) {
        setSelectedId(selected.id); setTitle(selected.title); setCategory(selected.category); setContent(selected.content);
      } else if (!selectedId && data[0]) {
        setSelectedId(data[0].id); setTitle(data[0].title); setCategory(data[0].category); setContent(data[0].content);
      } else if (preferredId === "") {
        setSelectedId(""); setTitle(""); setCategory("faq"); setContent("");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Knowledge base gagal dimuat.");
    } finally { setLoading(false); }
  }, [selectedId]);

  useEffect(() => { void load(); }, [load]);

  function selectItem(item: KnowledgeDoc) {
    setSelectedId(item.id); setTitle(item.title); setCategory(item.category); setContent(item.content);
    setError(""); setNotice("");
  }

  function newDraft() {
    setSelectedId(""); setTitle(""); setCategory("faq"); setContent(""); setError(""); setNotice("Mode dokumen baru. Dokumen akan disimpan sebagai draft.");
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const editing = Boolean(selectedId);
      const response = await fetch(editing ? `/api/knowledge/${selectedId}` : "/api/knowledge", {
        method: editing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, category, content }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Draft knowledge gagal disimpan.");
      const doc = result.data as KnowledgeDoc;
      setNotice(result.note || (editing ? "Perubahan tersimpan. Jika konten berubah, dokumen kembali menjadi draft untuk ditinjau." : "Draft tersimpan. Minta owner/admin/manager meninjau sebelum dipakai AI Host."));
      await load(doc.id);
    } catch (e) { setError(e instanceof Error ? e.message : "Draft knowledge gagal disimpan."); }
    finally { setBusy(false); }
  }

  async function setPublished(publish: boolean) {
    if (!selectedId || busy) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch(`/api/knowledge/${selectedId}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isPublished: publish }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Status publikasi gagal diperbarui.");
      setNotice(publish ? "Dokumen diterbitkan. AI Host dapat menggunakannya sebagai sumber yang disetujui." : "Dokumen ditarik dari knowledge aktif AI Host.");
      await load(selectedId);
    } catch (e) { setError(e instanceof Error ? e.message : "Status publikasi gagal diperbarui."); }
    finally { setBusy(false); }
  }

  return (
    <section className="knowledge-workspace">
      <header className="knowledge-heading">
        <div><p className="eyebrow">AI HOST · KNOWLEDGE BASE</p><h2>Pengetahuan layanan</h2><p>Susun FAQ, harga, kebijakan, kendaraan, dan kontak. Hanya dokumen yang diterbitkan oleh owner/admin/manager yang boleh digunakan AI Host.</p></div>
        <button type="button" className="secondary-button" onClick={newDraft}>＋ Dokumen baru</button>
      </header>
      {error && <p className="alert error" role="alert">{error}</p>}
      {notice && <p className="alert success" role="status">{notice}</p>}
      <div className="knowledge-layout">
        <aside className="panel knowledge-list">
          <div className="knowledge-list-heading"><strong>Dokumen</strong><span>{items.length}</span></div>
          {loading && !items.length ? <p className="empty-state">Memuat dokumen…</p> : items.length ? items.map((item) => (
            <button type="button" key={item.id} className={selectedId === item.id ? "knowledge-row selected" : "knowledge-row"} onClick={() => selectItem(item)}>
              <span className="knowledge-row-top"><strong>{item.title}</strong><span className={item.is_published ? "knowledge-status published" : "knowledge-status"}>{item.is_published ? "Terbit" : "Draft"}</span></span>
              <small>{categoryLabel[item.category] || item.category}</small>
              <span className="knowledge-preview">{item.content}</span>
            </button>
          )) : <p className="empty-state">Belum ada dokumen. Mulai dengan FAQ tentang layanan dan ketentuan usaha.</p>}
        </aside>
        <article className="panel knowledge-editor">
          <div className="knowledge-editor-heading"><div><p className="eyebrow">{selectedId ? "EDITOR DOKUMEN" : "DOKUMEN BARU"}</p><h3>{selectedId ? "Ubah pengetahuan" : "Buat draft pengetahuan"}</h3></div>{selectedId && <span className={items.find((item) => item.id === selectedId)?.is_published ? "knowledge-status published" : "knowledge-status"}>{items.find((item) => item.id === selectedId)?.is_published ? "Terbit" : "Draft"}</span>}</div>
          <form className="knowledge-form" onSubmit={(event) => void save(event)}>
            <label>Judul dokumen<input value={title} onChange={(event) => setTitle(event.target.value)} required maxLength={160} placeholder="Contoh: Ketentuan sewa kendaraan" /></label>
            <label>Kategori<select value={category} onChange={(event) => setCategory(event.target.value)}>{categories.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
            <label>Isi pengetahuan<textarea value={content} onChange={(event) => setContent(event.target.value)} required maxLength={12000} rows={12} placeholder="Tuliskan fakta yang sudah diverifikasi. Hindari janji ketersediaan kendaraan atau status pembayaran yang tidak bisa dipastikan." /></label>
            <div className="knowledge-form-footer"><small>{content.length.toLocaleString("id-ID")}/12.000 karakter · Perubahan konten menarik persetujuan publikasi sebelumnya.</small><button className="primary-button" type="submit" disabled={busy}>{busy ? "Menyimpan…" : selectedId ? "Simpan perubahan" : "Simpan sebagai draft"}</button></div>
          </form>
          {selectedId && <div className="knowledge-publish-actions">
            {items.find((item) => item.id === selectedId)?.is_published
              ? <button type="button" className="secondary-button" onClick={() => void setPublished(false)} disabled={busy}>Tarik publikasi</button>
              : <button type="button" className="primary-button" onClick={() => void setPublished(true)} disabled={busy}>Terbitkan untuk AI Host</button>}
            <small>Publikasi hanya diizinkan untuk owner, admin, atau manager. Dokumen yang diedit harus ditinjau dan diterbitkan ulang.</small>
          </div>}
        </article>
      </div>
      <style jsx>{`
        .knowledge-workspace{display:grid;gap:15px}.knowledge-heading{display:flex;justify-content:space-between;align-items:center;gap:16px;background:#f1f7f3;border:1px solid #dfece3;border-radius:15px;padding:22px}.knowledge-heading h2{margin:0 0 7px;font-size:22px;letter-spacing:-.5px}.knowledge-heading p:not(.eyebrow){margin:0;color:var(--muted);font-size:12px;line-height:1.6;max-width:700px}.knowledge-layout{display:grid;grid-template-columns:minmax(250px,.8fr) minmax(0,1.5fr);gap:14px;align-items:start}.knowledge-list{padding:0;overflow:hidden}.knowledge-list-heading{display:flex;justify-content:space-between;padding:16px;border-bottom:1px solid var(--line);font-size:12px}.knowledge-list-heading span{background:#f0f4f1;border-radius:30px;padding:4px 8px}.knowledge-row{display:grid;gap:6px;width:100%;text-align:left;padding:13px;border:0;border-bottom:1px solid var(--line);background:transparent;color:var(--foreground);cursor:pointer}.knowledge-row.selected{background:#eef6f0;box-shadow:inset 3px 0 #27724f}.knowledge-row-top{display:flex;justify-content:space-between;align-items:flex-start;gap:8px}.knowledge-row-top strong{font-size:11px;line-height:1.5}.knowledge-row small{font-size:9px;color:var(--muted)}.knowledge-preview{font-size:10px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.knowledge-status{display:inline-flex;align-self:flex-start;font-size:9px;border-radius:30px;padding:5px 8px;background:#fff2d8;color:#895d0b;white-space:nowrap}.knowledge-status.published{background:#e7f4ed;color:#176b4d}.knowledge-editor{padding:18px;min-width:0}.knowledge-editor-heading{display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:16px}.knowledge-editor-heading h3{margin:0;font-size:15px}.knowledge-form{display:grid;gap:13px}.knowledge-form label{display:grid;gap:6px;font-size:11px;font-weight:650}.knowledge-form input,.knowledge-form select,.knowledge-form textarea{width:100%;border:1px solid var(--line);border-radius:8px;padding:10px;background:#fff;color:var(--foreground);font:inherit;font-size:12px}.knowledge-form textarea{resize:vertical;line-height:1.6}.knowledge-form-footer{display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap}.knowledge-form-footer small,.knowledge-publish-actions small{font-size:9px;line-height:1.6;color:var(--muted)}.knowledge-publish-actions{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-top:14px;padding-top:14px;border-top:1px solid var(--line)}.knowledge-workspace button:disabled{opacity:.55;cursor:wait}@media(max-width:850px){.knowledge-layout{grid-template-columns:1fr}.knowledge-list{max-height:330px;overflow-y:auto}}@media(max-width:600px){.knowledge-heading{align-items:flex-start;flex-direction:column;padding:17px}.knowledge-heading h2{font-size:19px}.knowledge-editor{padding:13px}.knowledge-form-footer{align-items:flex-start;flex-direction:column}}
      `}</style>
    </section>
  );
}
