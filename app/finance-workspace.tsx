"use client";

import InvoiceWorkspace from "@/app/invoice-workspace";

import { FormEvent, useCallback, useEffect, useState } from "react";

type Booking = { id: string; booking_code: string; customer_name: string | null; registration_number: string; make: string; model: string; status: string };
type Vehicle = { id: string; registration_number: string; make: string; model: string };
type Payment = { id: string; booking_id: string | null; invoice_id: string | null; amount: string | number; payment_type: string; status: string; provider: string; provider_reference: string | null; created_at: string; booking_code: string | null; customer_name: string | null };
type InvoiceOption = { id: string; invoice_number: string; amount: string | number; status: string; booking_code: string | null; customer_name: string | null };
type Expense = { id: string; vehicle_id: string | null; booking_id: string | null; category: string; description: string; amount: string | number; spent_at: string; registration_number: string | null; booking_code: string | null };
type FinanceData = { summary: { net_received: string | number; pending_payments: string | number; verified_count: number; expenses_total: string | number }; payments: Payment[]; expenses: Expense[] };

const money = (value: string | number) => Number(value || 0).toLocaleString("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 });
const dateLabel = (value: string) => new Date(value).toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" });
const paymentTypeLabel: Record<string, string> = { rental: "Sewa", deposit: "Deposit", refund: "Pengembalian", extra_charge: "Biaya tambahan" };
const statusLabel: Record<string, string> = { pending: "Menunggu verifikasi", verified: "Terverifikasi", rejected: "Ditolak" };

export default function FinanceWorkspace() {
  const [data, setData] = useState<FinanceData | null>(null);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [invoices, setInvoices] = useState<InvoiceOption[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [kind, setKind] = useState("payment");
  const [bookingId, setBookingId] = useState("");
  const [invoiceId, setInvoiceId] = useState("");
  const [paymentType, setPaymentType] = useState("rental");
  const [provider, setProvider] = useState("manual");
  const [providerReference, setProviderReference] = useState("");
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState("Operasional");
  const [description, setDescription] = useState("");
  const [vehicleId, setVehicleId] = useState("");
  const [spentAt, setSpentAt] = useState(new Date().toLocaleDateString("en-CA"));

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [financeRes, bookingsRes, vehiclesRes, invoicesRes] = await Promise.all([
        fetch("/api/finance", { cache: "no-store" }),
        fetch("/api/bookings", { cache: "no-store" }),
        fetch("/api/vehicles", { cache: "no-store" }),
        fetch("/api/finance/invoices", { cache: "no-store" }),
      ]);
      const financeJson = await financeRes.json();
      const bookingsJson = await bookingsRes.json();
      const vehiclesJson = await vehiclesRes.json();
      const invoicesJson = await invoicesRes.json();
      if (!financeRes.ok) throw new Error(financeJson.error || "Data keuangan gagal dimuat.");
      if (!bookingsRes.ok) throw new Error(bookingsJson.error || "Data pemesanan gagal dimuat.");
      if (!vehiclesRes.ok) throw new Error(vehiclesJson.error || "Data armada gagal dimuat.");
      if (!invoicesRes.ok) throw new Error(invoicesJson.error || "Daftar invoice gagal dimuat.");
      setData(financeJson);
      setBookings(bookingsJson.data || []);
      setVehicles(vehiclesJson.data || []);
      setInvoices((invoicesJson.data || []).filter((invoice: InvoiceOption) => !["void", "paid"].includes(invoice.status)));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Terjadi kesalahan saat memuat keuangan.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  async function submitEntry(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true); setError(""); setMessage("");
    try {
      const payload = kind === "payment"
        ? { kind, bookingId: bookingId || undefined, invoiceId: invoiceId || undefined, paymentType, provider, providerReference, amount }
        : { kind, amount, category, description, vehicleId: vehicleId || undefined, spentAt };
      const response = await fetch("/api/finance", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Transaksi gagal disimpan.");
      setMessage(result.message || "Transaksi berhasil dicatat.");
      setAmount(""); setProviderReference(""); setDescription("");
      setInvoiceId(""); setBookingId("");
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Transaksi gagal disimpan.");
    } finally { setBusy(false); }
  }

  async function decidePayment(id: string, status: "verified" | "rejected") {
    setBusy(true); setError(""); setMessage("");
    try {
      const response = await fetch(`/api/finance/payments/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Verifikasi gagal.");
      setMessage(result.message || "Status pembayaran diperbarui.");
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Verifikasi gagal.");
    } finally { setBusy(false); }
  }

  const pending = data?.payments.filter((p) => p.status === "pending") || [];

  return (
    <div className="finance-workspace">
      <section className="finance-intro">
        <div><p className="eyebrow">FINANCE & RECONCILIATION</p><h2>Buku kas dan verifikasi pembayaran</h2><p>Pembayaran baru selalu berstatus menunggu. Penerimaan baru dihitung setelah diverifikasi petugas yang berwenang.</p></div>
        <button className="secondary-button" type="button" onClick={() => void refresh()} disabled={loading}>↻ Muat ulang</button>
      </section>
      {error && <p className="alert error" role="alert">{error}</p>}
      {message && <p className="alert success" role="status">{message}</p>}
      <section className="finance-stat-grid">
        <article className="stat-card"><p>Penerimaan bersih terverifikasi</p><strong>{money(data?.summary.net_received || 0)}</strong><small>Tidak termasuk pembayaran yang menunggu</small></article>
        <article className="stat-card"><p>Menunggu verifikasi</p><strong>{money(data?.summary.pending_payments || 0)}</strong><small>{pending.length} transaksi menunggu tindakan</small></article>
        <article className="stat-card"><p>Total pengeluaran</p><strong>{money(data?.summary.expenses_total || 0)}</strong><small>Menurut tanggal pengeluaran</small></article>
        <article className="stat-card"><p>Transaksi terverifikasi</p><strong>{data?.summary.verified_count || 0}</strong><small>Catatan pembayaran</small></article>
      </section>
      <section className="content-grid finance-entry-grid">
        <article className="panel">
          <div className="panel-heading"><div><p className="eyebrow">PENCATATAN</p><h2>Catat transaksi</h2></div></div>
          <form className="data-form" onSubmit={submitEntry}>
            <label>Jenis transaksi<select value={kind} onChange={(e) => setKind(e.target.value)}><option value="payment">Pembayaran pelanggan</option><option value="expense">Pengeluaran usaha</option></select></label>
            {kind === "payment" ? <>
              <label>Invoice terkait (opsional)<select value={invoiceId} onChange={(e) => { setInvoiceId(e.target.value); if (e.target.value) setBookingId(""); }}><option value="">Tidak ditautkan ke invoice</option>{invoices.map((invoice) => <option key={invoice.id} value={invoice.id}>{invoice.invoice_number} · {invoice.customer_name || invoice.booking_code || "Pelanggan"} · {money(invoice.amount)} · {invoice.status === "partially_paid" ? "Sebagian dibayar" : "Belum lunas"}</option>)}</select></label>
              <label>Pemesanan terkait {invoiceId ? "(diisi otomatis dari invoice)" : "(pilih pemesanan atau invoice)"}<select value={bookingId} onChange={(e) => setBookingId(e.target.value)} required={!invoiceId}><option value="">Pilih pemesanan</option>{bookings.map((b) => <option key={b.id} value={b.id}>{b.booking_code} · {b.customer_name || "Pelanggan"} · {b.registration_number}</option>)}</select></label>
              <label>Jenis pembayaran<select value={paymentType} onChange={(e) => setPaymentType(e.target.value)}><option value="rental">Pembayaran sewa</option><option value="deposit">Deposit</option><option value="extra_charge">Biaya tambahan</option><option value="refund">Pengembalian dana (khusus keuangan)</option></select></label>
              {invoiceId && <small className="privacy-note">Pembayaran akan ditautkan ke invoice. Status tagihan baru berubah setelah transaksi diverifikasi.</small>}
              <label>Metode / provider<input value={provider} onChange={(e) => setProvider(e.target.value)} required maxLength={80} placeholder="manual, transfer bank..." /></label>
              <label>Referensi transaksi (opsional)<input value={providerReference} onChange={(e) => setProviderReference(e.target.value)} maxLength={180} placeholder="Nomor referensi bank" /></label>
            </> : <>
              <label>Kategori pengeluaran<input value={category} onChange={(e) => setCategory(e.target.value)} required maxLength={80} /></label>
              <label>Keterangan<input value={description} onChange={(e) => setDescription(e.target.value)} required maxLength={500} placeholder="Contoh: servis rutin kendaraan" /></label>
              <label>Kendaraan terkait (opsional)<select value={vehicleId} onChange={(e) => setVehicleId(e.target.value)}><option value="">Tidak terkait kendaraan tertentu</option>{vehicles.map((v) => <option key={v.id} value={v.id}>{v.registration_number} · {v.make} {v.model}</option>)}</select></label>
              <label>Tanggal pengeluaran<input type="date" value={spentAt} onChange={(e) => setSpentAt(e.target.value)} required /></label>
            </>}
            <label>Nominal (Rp)<input type="number" min="1" max="1000000000000" step="1" value={amount} onChange={(e) => setAmount(e.target.value)} required /></label>
            <button className="primary-button" type="submit" disabled={busy || loading}>{busy ? "Menyimpan..." : "Simpan transaksi"}</button>
            {kind === "payment" && <small className="privacy-note">Pencatatan tidak otomatis menandai pembayaran lunas. Bukti pembayaran harus diperiksa oleh bagian keuangan atau manajemen.</small>}
          </form>
        </article>
        <article className="panel">
          <div className="panel-heading"><div><p className="eyebrow">PERLU TINDAKAN</p><h2>Antrean verifikasi ({pending.length})</h2></div></div>
          {loading ? <p className="empty-state">Memuat data keuangan…</p> : pending.length ? <div className="finance-list">{pending.map((p) => <div className="finance-list-item" key={p.id}><div className="finance-item-main"><strong>{p.booking_code || "Pembayaran"}</strong><span>{p.customer_name || "Pelanggan"} · {paymentTypeLabel[p.payment_type] || p.payment_type}</span><b>{money(p.amount)}</b><small>{p.provider}{p.provider_reference ? ` · Ref: ${p.provider_reference}` : ""} · {dateLabel(p.created_at)}</small></div><div className="finance-actions"><button type="button" className="primary-button" disabled={busy} onClick={() => void decidePayment(p.id, "verified")}>Verifikasi</button><button type="button" className="secondary-button" disabled={busy} onClick={() => void decidePayment(p.id, "rejected")}>Tolak</button></div></div>)}</div> : <p className="empty-state">Tidak ada pembayaran yang menunggu verifikasi.</p>}
        </article>
      </section>
      <InvoiceWorkspace />
      <section className="content-grid">
        <article className="panel"><div className="panel-heading"><div><p className="eyebrow">ARUS MASUK</p><h2>Pembayaran terbaru</h2></div></div>{loading ? <p className="empty-state">Memuat…</p> : data?.payments.length ? <div className="table-wrap"><table><thead><tr><th>Tanggal</th><th>Pemesanan</th><th>Nominal</th><th>Status</th></tr></thead><tbody>{data.payments.slice(0, 12).map((p) => <tr key={p.id}><td>{dateLabel(p.created_at)}</td><td>{p.booking_code || "—"}<small className="cell-note">{paymentTypeLabel[p.payment_type] || p.payment_type}</small></td><td>{money(p.amount)}</td><td><span className={`finance-status ${p.status}`}>{statusLabel[p.status] || p.status}</span></td></tr>)}</tbody></table></div> : <p className="empty-state">Belum ada pembayaran dicatat.</p>}</article>
        <article className="panel"><div className="panel-heading"><div><p className="eyebrow">ARUS KELUAR</p><h2>Pengeluaran terbaru</h2></div></div>{loading ? <p className="empty-state">Memuat…</p> : data?.expenses.length ? <div className="table-wrap"><table><thead><tr><th>Tanggal</th><th>Keterangan</th><th>Nominal</th></tr></thead><tbody>{data.expenses.slice(0, 12).map((e) => <tr key={e.id}><td>{dateLabel(e.spent_at)}</td><td>{e.category}<small className="cell-note">{e.description}{e.registration_number ? ` · ${e.registration_number}` : ""}</small></td><td>{money(e.amount)}</td></tr>)}</tbody></table></div> : <p className="empty-state">Belum ada pengeluaran dicatat.</p>}</article>
      </section>
      <style jsx>{`
        .finance-workspace{display:grid;gap:16px}.finance-intro{display:flex;justify-content:space-between;align-items:center;gap:16px;background:#f1f7f3;border:1px solid #dfece3;border-radius:15px;padding:22px}.finance-intro h2{font-size:22px;letter-spacing:-.6px;margin:0 0 8px}.finance-intro p:not(.eyebrow){margin:0;color:var(--muted);font-size:12px;line-height:1.7;max-width:720px}.finance-stat-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:13px}.finance-entry-grid{margin:0}.finance-list{display:grid;gap:0}.finance-list-item{display:flex;justify-content:space-between;gap:12px;padding:14px 0;border-bottom:1px solid var(--line)}.finance-item-main{display:grid;gap:5px;min-width:0}.finance-item-main strong{font-size:12px}.finance-item-main span,.finance-item-main small{font-size:10px;color:var(--muted);line-height:1.5}.finance-item-main b{font-size:15px}.finance-actions{display:flex;flex-direction:column;gap:7px;min-width:96px}.finance-actions button{padding:9px;font-size:10px}.finance-status{font-size:10px;border-radius:30px;padding:5px 7px;background:#f2f3f2;color:#59635c;white-space:nowrap}.finance-status.verified{background:#e7f4ed;color:#176b4d}.finance-status.pending{background:#fff4dc;color:#895d0b}.finance-status.rejected{background:#fff0ee;color:#9d3025}.finance-workspace button:disabled{opacity:.55;cursor:wait}@media(max-width:1100px){.finance-stat-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:700px){.finance-intro{align-items:flex-start;flex-direction:column;padding:17px}.finance-intro h2{font-size:19px}.finance-list-item{flex-direction:column}.finance-actions{flex-direction:row}.finance-actions button{flex:1}}
      `}</style>
    </div>
  );
}
