"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";

type Booking = {
  id: string;
  booking_code: string;
  customer_name: string | null;
  estimated_total?: string | number;
  status: string;
};
type Invoice = {
  id: string;
  invoice_number: string;
  booking_id: string | null;
  amount: string | number;
  received: string | number;
  status: string;
  due_at: string | null;
  issued_at: string | null;
  created_at: string;
  booking_code: string | null;
  customer_name: string | null;
};

const money = (value: string | number) =>
  Number(value || 0).toLocaleString("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 });
const dateLabel = (value: string | null) => value
  ? new Date(value).toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Jakarta" })
  : "—";
const statusLabel: Record<string, string> = {
  draft: "Draft", issued: "Terbit", partially_paid: "Dibayar sebagian",
  paid: "Lunas", void: "Dibatalkan", overdue: "Jatuh tempo",
};

export default function InvoiceWorkspace() {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [bookingId, setBookingId] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [invoiceResponse, bookingResponse] = await Promise.all([
        fetch("/api/finance/invoices", { cache: "no-store" }),
        fetch("/api/bookings", { cache: "no-store" }),
      ]);
      const invoiceJson = await invoiceResponse.json();
      const bookingJson = await bookingResponse.json();
      if (!invoiceResponse.ok) throw new Error(invoiceJson.error || "Daftar invoice gagal dimuat.");
      if (!bookingResponse.ok) throw new Error(bookingJson.error || "Daftar pemesanan gagal dimuat.");
      setInvoices(invoiceJson.data || []);
      setBookings((bookingJson.data || []).filter((booking: Booking) =>
        !["cancelled", "rejected", "expired"].includes(booking.status),
      ));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Data invoice belum dapat dimuat.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  async function issueInvoice(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/finance/invoices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bookingId, dueAt: dueAt || undefined }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Invoice gagal diterbitkan.");
      setMessage(`Invoice ${result.data.invoice_number} berhasil diterbitkan.`);
      setBookingId("");
      setDueAt("");
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Invoice gagal diterbitkan.");
    } finally {
      setBusy(false);
    }
  }

  const activeBookingIds = new Set(invoices.filter((invoice) => invoice.status !== "void").map((invoice) => invoice.booking_id));
  const eligibleBookings = bookings.filter((booking) => !activeBookingIds.has(booking.id));

  return (
    <section className="panel invoice-workspace">
      <div className="panel-heading">
        <div><p className="eyebrow">TAGIHAN PELANGGAN</p><h2>Invoice dan piutang</h2></div>
        <button className="secondary-button" type="button" onClick={() => void refresh()} disabled={loading}>↻ Muat ulang</button>
      </div>
      <p className="invoice-help">Invoice diterbitkan berdasarkan total pemesanan. Penerimaan hanya bertambah setelah pembayaran diverifikasi bagian keuangan.</p>
      {error && <p className="alert error" role="alert">{error}</p>}
      {message && <p className="alert success" role="status">{message}</p>}
      <form className="invoice-form" onSubmit={issueInvoice}>
        <label>Pemesanan
          <select value={bookingId} onChange={(event) => setBookingId(event.target.value)} required>
            <option value="">Pilih pemesanan untuk ditagih</option>
            {eligibleBookings.map((booking) => (
              <option key={booking.id} value={booking.id}>
                {booking.booking_code} · {booking.customer_name || "Pelanggan"}
              </option>
            ))}
          </select>
        </label>
        <label>Jatuh tempo (opsional)<input type="date" value={dueAt} onChange={(event) => setDueAt(event.target.value)} /></label>
        <button className="primary-button" type="submit" disabled={busy || loading || !eligibleBookings.length}>
          {busy ? "Menerbitkan…" : "Terbitkan invoice"}
        </button>
      </form>
      {!loading && !eligibleBookings.length && (
        <p className="invoice-help">Tidak ada pemesanan yang tersedia untuk invoice baru. Periksa apakah pemesanan sudah memiliki invoice aktif.</p>
      )}
      <div className="table-wrap">
        {loading ? <p className="empty-state">Memuat invoice…</p> : invoices.length ? (
          <table>
            <thead><tr><th>Nomor / tanggal</th><th>Pelanggan / pemesanan</th><th>Tagihan</th><th>Diterima</th><th>Status</th><th>Jatuh tempo</th></tr></thead>
            <tbody>{invoices.map((invoice) => (
              <tr key={invoice.id}>
                <td>{invoice.invoice_number}<small className="cell-note">{dateLabel(invoice.issued_at || invoice.created_at)}</small></td>
                <td>{invoice.customer_name || "—"}<small className="cell-note">{invoice.booking_code || "Tanpa pemesanan"}</small></td>
                <td>{money(invoice.amount)}</td>
                <td>{money(invoice.received)}</td>
                <td><span className={`invoice-status ${invoice.status}`}>{statusLabel[invoice.status] || invoice.status}</span></td>
                <td>{dateLabel(invoice.due_at)}</td>
              </tr>
            ))}</tbody>
          </table>
        ) : <p className="empty-state">Belum ada invoice. Pilih pemesanan di atas untuk menerbitkan tagihan pertama.</p>}
      </div>
      <style jsx>{`
        .invoice-workspace{margin-bottom:20px}.invoice-help{color:var(--muted);font-size:12px;line-height:1.7;margin:0 0 14px}
        .invoice-form{display:grid;grid-template-columns:minmax(220px,2fr) minmax(160px,1fr) auto;gap:12px;align-items:end;margin-bottom:18px}
        .invoice-form label{display:grid;gap:7px;font-size:12px;font-weight:700;color:#344239}
        .invoice-form input,.invoice-form select{width:100%;min-width:0;padding:11px 12px;border:1px solid #dce4de;border-radius:10px;background:#fff;color:var(--ink)}
        .invoice-status{font-size:10px;border-radius:30px;padding:5px 7px;background:#f2f3f2;color:#59635c;white-space:nowrap}
        .invoice-status.paid{background:#e7f4ed;color:#176b4d}.invoice-status.partially_paid{background:#fff4dc;color:#895d0b}.invoice-status.issued{background:#eaf0ff;color:#3157a4}
        @media(max-width:800px){.invoice-form{grid-template-columns:1fr}.invoice-form button{width:100%}}
      `}</style>
    </section>
  );
}
