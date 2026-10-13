"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type Tenant = { id: string; name: string; slug: string; subscription_id: string | null; subscription_status: string | null; activation_status: string | null; plan_name: string | null };
type Invoice = { id: string; organization_id: string; tenant_name: string; subscription_id: string; invoice_number: string; invoice_type: string; period_start: string | null; period_end: string | null; currency: string; subtotal_amount: string | number; tax_amount: string | number; total_amount: string | number; status: string; due_at: string | null; verified_amount: string | number; created_at: string };
type Payment = { id: string; tenant_name: string; invoice_number: string; platform_invoice_id: string; amount: string | number; provider: string; provider_reference: string | null; status: string; received_at: string; notes: string | null };

function monthRange() {
  const now = new Date(); const year = now.getFullYear(); const month = now.getMonth();
  const pad = (n: number) => String(n).padStart(2, "0");
  return { start: `${year}-${pad(month + 1)}-01`, end: `${year}-${pad(month + 1)}-${pad(new Date(year, month + 1, 0).getDate())}` };
}
function previousMonthRange() {
  const now = new Date(); const first = new Date(now.getFullYear(), now.getMonth() - 1, 1); const last = new Date(now.getFullYear(), now.getMonth(), 0);
  const fmt = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  return { start: fmt(first), end: fmt(last) };
}
function localDateTime(date: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
const idr = (value: string | number) => Number(value || 0).toLocaleString("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 });
const invoiceLabel: Record<string, string> = { activation: "Aktivasi", subscription: "Langganan", commission: "Komisi", adjustment: "Penyesuaian" };
const invoiceStatus: Record<string, string> = { draft: "Draft", issued: "Terbit", partially_paid: "Dibayar sebagian", paid: "Lunas", void: "Dibatalkan", overdue: "Terlambat" };
const paymentStatus: Record<string, string> = { pending: "Menunggu verifikasi", verified: "Terverifikasi", rejected: "Ditolak", refunded: "Dikembalikan" };

export default function PlatformBillingWorkspace() {
  const router = useRouter();
  const range = monthRange();
  const closedRange = previousMonthRange();
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [selectedTenant, setSelectedTenant] = useState("");
  const [invoiceType, setInvoiceType] = useState("activation");
  const [periodStart, setPeriodStart] = useState(range.start);
  const [periodEnd, setPeriodEnd] = useState(range.end);
  const [settlementStart, setSettlementStart] = useState(closedRange.start);
  const [settlementEnd, setSettlementEnd] = useState(closedRange.end);
  const [idempotencyKey, setIdempotencyKey] = useState("");
  const [selectedInvoice, setSelectedInvoice] = useState("");
  const [taxAmount, setTaxAmount] = useState("0");
  const [dueAt, setDueAt] = useState(localDateTime(new Date(Date.now() + 7 * 86400000)));
  const [paymentInvoice, setPaymentInvoice] = useState("");
  const [paymentAmount, setPaymentAmount] = useState("");
  const [provider, setProvider] = useState("manual");
  const [providerReference, setProviderReference] = useState("");
  const [paymentNotes, setPaymentNotes] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const [tenantResponse, invoiceResponse, paymentResponse] = await Promise.all([
        fetch("/api/platform/tenants", { cache: "no-store" }),
        fetch("/api/platform/invoices", { cache: "no-store" }),
        fetch("/api/platform/payments", { cache: "no-store" }),
      ]);
      const [tenantResult, invoiceResult, paymentResult] = await Promise.all([tenantResponse.json(), invoiceResponse.json(), paymentResponse.json()]);
      if ([tenantResponse, invoiceResponse, paymentResponse].some((response) => response.status === 401)) {
        router.replace("/platform/login"); return;
      }
      if (!tenantResponse.ok) throw new Error(tenantResult.error || "Daftar tenant gagal dimuat.");
      if (!invoiceResponse.ok) throw new Error(invoiceResult.error || "Daftar invoice gagal dimuat.");
      if (!paymentResponse.ok) throw new Error(paymentResult.error || "Daftar pembayaran gagal dimuat.");
      const nextTenants = (tenantResult.data || []) as Tenant[];
      const nextInvoices = (invoiceResult.data || []) as Invoice[];
      const nextPayments = (paymentResult.data || []) as Payment[];
      setTenants(nextTenants); setInvoices(nextInvoices); setPayments(nextPayments);
      setSelectedTenant((current) => current && nextTenants.some((t) => t.subscription_id === current) ? current : nextTenants.find((t) => t.subscription_id && ["pending_activation", "trialing", "active", "past_due"].includes(t.subscription_status || ""))?.subscription_id || "");
      setSelectedInvoice((current) => current && nextInvoices.some((i) => i.id === current && i.status === "draft") ? current : nextInvoices.find((i) => i.status === "draft")?.id || "");
      setPaymentInvoice((current) => current && nextInvoices.some((i) => i.id === current && ["issued", "partially_paid", "overdue"].includes(i.status)) ? current : nextInvoices.find((i) => ["issued", "partially_paid", "overdue"].includes(i.status))?.id || "");
    } catch (e) { setError(e instanceof Error ? e.message : "Data billing gagal dimuat."); }
    finally { setLoading(false); }
  }, [router]);

  useEffect(() => { void load(); }, [load]);

  async function settleCommissions() {
    if (busy) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/platform/commissions/settle", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ periodStart: settlementStart, periodEnd: settlementEnd }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Settlement komisi gagal.");
      const data = result.data || {};
      setNotice(`Settlement selesai: ${data.entriesCreated || 0} entri, komisi ${idr(data.commissionAmount || 0)}. Entri dapat ditagihkan melalui draft invoice komisi.`);
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Settlement komisi gagal."); }
    finally { setBusy(false); }
  }

  async function createInvoice(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const tenant = tenants.find((item) => item.subscription_id === selectedTenant);
    if (!tenant || !selectedTenant || busy) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const key = idempotencyKey.trim() || crypto.randomUUID();
      setIdempotencyKey(key);
      const body: Record<string, string> = { subscriptionId: selectedTenant, invoiceType, idempotencyKey: key };
      if (invoiceType !== "activation") { body.periodStart = periodStart; body.periodEnd = periodEnd; }
      const response = await fetch("/api/platform/invoices", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Draft invoice gagal dibuat.");
      setSelectedInvoice(result.data.id);
      setNotice(result.message || "Draft invoice dibuat.");
      setIdempotencyKey("");
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Draft invoice gagal dibuat."); }
    finally { setBusy(false); }
  }

  async function issueInvoice(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedInvoice || busy) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch(`/api/platform/invoices/${selectedInvoice}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "issue", taxAmount: Number(taxAmount), dueAt: new Date(dueAt).toISOString() }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Invoice gagal diterbitkan.");
      setNotice("Invoice diterbitkan. Nilai pajak yang dimasukkan harus sesuai perlakuan pajak yang berlaku.");
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Invoice gagal diterbitkan."); }
    finally { setBusy(false); }
  }

  async function voidInvoiceById(invoiceId: string) {
    if (!invoiceId || busy) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/platform/invoices/" + invoiceId, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "void" }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Invoice tidak dapat dibatalkan.");
      setNotice("Invoice dibatalkan dengan audit trail.");
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Invoice tidak dapat dibatalkan."); }
    finally { setBusy(false); }
  }

  async function recordPayment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!paymentInvoice || busy) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/platform/payments", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ invoiceId: paymentInvoice, amount: Number(paymentAmount), provider, providerReference: providerReference.trim() || null, idempotencyKey: crypto.randomUUID(), notes: paymentNotes }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Klaim pembayaran gagal dicatat.");
      setNotice(result.message || "Klaim pembayaran tercatat sebagai pending.");
      setPaymentAmount(""); setProviderReference(""); setPaymentNotes("");
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Klaim pembayaran gagal dicatat."); }
    finally { setBusy(false); }
  }

  async function paymentAction(id: string, action: "verify" | "reject" | "refund") {
    if (busy) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch(`/api/platform/payments/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Status pembayaran gagal diperbarui.");
      setNotice(action === "verify" ? "Pembayaran terverifikasi dan saldo invoice dihitung ulang." : action === "reject" ? "Klaim pembayaran ditolak." : "Pembayaran ditandai dikembalikan; saldo invoice dihitung ulang.");
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Status pembayaran gagal diperbarui."); }
    finally { setBusy(false); }
  }

  const draftInvoices = invoices.filter((invoice) => invoice.status === "draft");
  const openInvoices = invoices.filter((invoice) => ["issued", "partially_paid", "overdue"].includes(invoice.status));

  return (
    <main className="billing-page">
      <header className="billing-header"><div><p className="eyebrow">AKVISIO AUTOHOST · BILLING</p><h1>Invoice dan pembayaran platform</h1><p>Invoice rental tenant tetap terpisah dari tagihan langganan AKVISIO.</p></div><div className="header-actions"><a href="/platform">← Super Admin</a><button type="button" onClick={() => void load()} disabled={loading}>Muat ulang</button></div></header>
      {error && <p className="alert error" role="alert">{error}</p>}
      {notice && <p className="alert success" role="status">{notice}</p>}
      <section className="panel settlement-panel">
        <div><p className="eyebrow">MONTHLY COMMISSION</p><h2>Hitung komisi bulan yang sudah selesai</h2><p className="help">Hanya pembayaran rental/biaya tambahan berstatus verified yang dihitung. Deposit dan refund tidak menjadi dasar komisi.</p></div>
        <div className="settlement-controls"><label>Mulai<input type="date" value={settlementStart} onChange={(event) => setSettlementStart(event.target.value)} /></label><label>Akhir<input type="date" value={settlementEnd} onChange={(event) => setSettlementEnd(event.target.value)} /></label><button className="primary" type="button" onClick={() => void settleCommissions()} disabled={busy}>{busy ? "Menghitung…" : "Jalankan settlement"}</button></div>
      </section>
      <section className="billing-grid">
        <article className="panel"><p className="eyebrow">DRAFT GENERATOR</p><h2>Buat draft invoice</h2>
          <form className="billing-form" onSubmit={(event) => void createInvoice(event)}>
            <label>Tenant dan subscription<select value={selectedTenant} onChange={(event) => setSelectedTenant(event.target.value)} required><option value="">Pilih subscription</option>{tenants.filter((t) => t.subscription_id && ["pending_activation", "trialing", "active", "past_due"].includes(t.subscription_status || "")).map((tenant) => <option key={tenant.subscription_id} value={tenant.subscription_id!}>{tenant.name} · {tenant.plan_name} · {tenant.subscription_status}</option>)}</select></label>
            <label>Jenis invoice<select value={invoiceType} onChange={(event) => setInvoiceType(event.target.value)}><option value="activation">Biaya aktivasi</option><option value="subscription">Langganan bulanan</option><option value="commission">Komisi transaksi</option></select></label>
            {invoiceType !== "activation" && <div className="two"><label>Periode mulai<input type="date" value={periodStart} onChange={(event) => setPeriodStart(event.target.value)} required /></label><label>Periode akhir<input type="date" value={periodEnd} onChange={(event) => setPeriodEnd(event.target.value)} required /></label></div>}
            <label>Idempotency key (opsional)<input value={idempotencyKey} onChange={(event) => setIdempotencyKey(event.target.value)} minLength={8} maxLength={128} placeholder="Otomatis dibuat jika kosong" /></label>
            <button className="primary" type="submit" disabled={busy || !selectedTenant}>{busy ? "Memproses…" : "Buat draft"}</button>
          </form>
          <p className="help">Draft menghitung nilai dari snapshot subscription atau entri komisi pending. Draft belum dikirim kepada tenant.</p>
        </article>
        <article className="panel"><p className="eyebrow">ISSUE CONTROL</p><h2>Terbitkan atau batalkan invoice</h2>
          <form className="billing-form" onSubmit={(event) => void issueInvoice(event)}>
            <label>Draft invoice<select value={selectedInvoice} onChange={(event) => setSelectedInvoice(event.target.value)} required><option value="">Pilih draft</option>{draftInvoices.map((invoice) => <option key={invoice.id} value={invoice.id}>{invoice.invoice_number} · {invoice.tenant_name} · {idr(invoice.total_amount)}</option>)}</select></label>
            <label>Nilai pajak (Rp)<input type="number" min="0" step="1" value={taxAmount} onChange={(event) => setTaxAmount(event.target.value)} required /></label>
            <label>Jatuh tempo<input type="datetime-local" value={dueAt} onChange={(event) => setDueAt(event.target.value)} required /></label>
            <button className="primary" type="submit" disabled={busy || !selectedInvoice}>{busy ? "Memproses…" : "Terbitkan invoice"}</button>
          </form>
          <p className="help">Invoice dapat dibatalkan dari tabel jika belum memiliki klaim pembayaran pending atau pembayaran terverifikasi.</p>
          <p className="help">Masukkan pajak sesuai kebijakan perpajakan dan status usaha. Sistem tidak menebak tarif pajak.</p>
        </article>
        <article className="panel"><p className="eyebrow">PAYMENT CLAIM</p><h2>Catat klaim pembayaran</h2>
          <form className="billing-form" onSubmit={(event) => void recordPayment(event)}>
            <label>Invoice terbuka<select value={paymentInvoice} onChange={(event) => setPaymentInvoice(event.target.value)} required><option value="">Pilih invoice</option>{openInvoices.map((invoice) => <option key={invoice.id} value={invoice.id}>{invoice.invoice_number} · {invoice.tenant_name} · sisa {idr(Number(invoice.total_amount) - Number(invoice.verified_amount))}</option>)}</select></label>
            <label>Nominal yang diklaim (Rp)<input type="number" min="0.01" step="0.01" value={paymentAmount} onChange={(event) => setPaymentAmount(event.target.value)} required /></label>
            <label>Metode/provider<select value={provider} onChange={(event) => setProvider(event.target.value)}><option value="manual">Manual</option><option value="bank_transfer">Transfer bank</option><option value="payment_gateway">Payment gateway</option><option value="other">Lainnya</option></select></label>
            <label>Referensi transaksi (opsional)<input value={providerReference} onChange={(event) => setProviderReference(event.target.value)} maxLength={200} /></label>
            <label>Catatan internal (opsional)<textarea value={paymentNotes} onChange={(event) => setPaymentNotes(event.target.value)} rows={2} maxLength={1000} /></label>
            <button className="primary" type="submit" disabled={busy || !paymentInvoice}>{busy ? "Mencatat…" : "Catat sebagai pending"}</button>
          </form>
          <p className="warning">Jangan verifikasi hanya berdasarkan chat atau screenshot. Cocokkan dengan mutasi rekening atau catatan provider tepercaya.</p>
        </article>
      </section>
      <section className="panel"><p className="eyebrow">INVOICE REGISTER</p><h2>Daftar invoice ({invoices.length})</h2>
        {loading ? <p className="empty">Memuat invoice…</p> : invoices.length ? <div className="table-wrap"><table><thead><tr><th>Invoice</th><th>Tenant</th><th>Jenis</th><th>Total</th><th>Terverifikasi</th><th>Status</th><th>Jatuh tempo</th><th>Aksi</th></tr></thead><tbody>{invoices.map((invoice) => <tr key={invoice.id} onClick={() => invoice.status === "draft" && setSelectedInvoice(invoice.id)} className={selectedInvoice === invoice.id ? "selected" : ""}><td>{invoice.invoice_number}</td><td>{invoice.tenant_name}</td><td>{invoiceLabel[invoice.invoice_type] || invoice.invoice_type}</td><td>{idr(invoice.total_amount)}</td><td>{idr(invoice.verified_amount)}</td><td><span className="status">{invoiceStatus[invoice.status] || invoice.status}</span></td><td>{invoice.due_at ? new Date(invoice.due_at).toLocaleDateString("id-ID") : "—"}</td><td>{["draft", "issued", "overdue"].includes(invoice.status) && <button type="button" className="cancel-invoice" onClick={(event) => { event.stopPropagation(); void voidInvoiceById(invoice.id); }} disabled={busy}>Batalkan</button>}</td></tr>)}</tbody></table></div> : <p className="empty">Belum ada invoice platform.</p>}
      </section>
      <section className="panel"><p className="eyebrow">PAYMENT RECONCILIATION</p><h2>Klaim dan verifikasi pembayaran ({payments.length})</h2>
        {loading ? <p className="empty">Memuat pembayaran…</p> : payments.length ? <div className="table-wrap"><table><thead><tr><th>Waktu</th><th>Tenant / invoice</th><th>Metode / referensi</th><th>Nominal</th><th>Status</th><th>Aksi</th></tr></thead><tbody>{payments.map((payment) => <tr key={payment.id}><td>{new Date(payment.received_at).toLocaleString("id-ID")}</td><td>{payment.tenant_name}<small>{payment.invoice_number}</small></td><td>{payment.provider}<small>{payment.provider_reference || "Tanpa referensi"}</small></td><td>{idr(payment.amount)}</td><td><span className="status">{paymentStatus[payment.status] || payment.status}</span></td><td><div className="actions">{payment.status === "pending" && <><button type="button" onClick={() => void paymentAction(payment.id, "verify")} disabled={busy}>Verifikasi</button><button type="button" className="danger" onClick={() => void paymentAction(payment.id, "reject")} disabled={busy}>Tolak</button></>}{payment.status === "verified" && <button type="button" className="danger" onClick={() => void paymentAction(payment.id, "refund")} disabled={busy}>Tandai refund</button>}</div></td></tr>)}</tbody></table></div> : <p className="empty">Belum ada klaim pembayaran.</p>}
      </section>
      <style jsx>{`
        .billing-page{min-height:100vh;padding:26px;display:grid;gap:16px;background:#f5f7f5;color:#1b2a20}.billing-header{display:flex;justify-content:space-between;align-items:center;gap:16px}.billing-header h1{font-size:25px;letter-spacing:-.7px;margin:4px 0}.billing-header p:not(.eyebrow){font-size:11px;color:#68766d;margin:0}.eyebrow{font-size:9px;letter-spacing:1.4px;font-weight:800;color:#347b55;margin:0 0 7px}.header-actions{display:flex;align-items:center;gap:8px}.header-actions a,.header-actions button{border:0;border-radius:8px;padding:10px 12px;background:#e6ede7;color:#274b35;font-size:10px;font-weight:700;text-decoration:none;cursor:pointer}.settlement-panel{display:flex;justify-content:space-between;align-items:center;gap:18px}.settlement-panel h2{margin:0 0 4px}.settlement-controls{display:flex;align-items:end;gap:8px;flex-wrap:wrap}.settlement-controls label{display:grid;gap:4px;font-size:9px;font-weight:700}.settlement-controls input{border:1px solid #d8e2da;border-radius:7px;padding:8px;font:inherit;font-size:10px}.settlement-controls button{border:0;border-radius:8px;padding:10px 12px;font-size:10px;font-weight:700;cursor:pointer;white-space:nowrap}.billing-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;align-items:start}.panel{background:#fff;border:1px solid #e0e7e1;border-radius:13px;padding:17px;min-width:0}.panel h2{font-size:15px;margin:0 0 15px}.billing-form{display:grid;gap:11px}.billing-form label{display:grid;gap:5px;font-size:10px;font-weight:700}.billing-form input,.billing-form select,.billing-form textarea{width:100%;min-width:0;border:1px solid #d8e2da;border-radius:7px;padding:9px;background:#fff;color:#1b2a20;font:inherit;font-size:11px}.billing-form button,.secondary{border:0;border-radius:8px;padding:10px 12px;font-size:10px;font-weight:700;cursor:pointer}.primary{background:#236a47;color:#fff}.secondary{background:#e6ede7;color:#274b35;margin-top:10px}.billing-form button:disabled,.secondary:disabled{opacity:.5;cursor:wait}.two{display:grid;grid-template-columns:1fr 1fr;gap:8px}.help,.warning{font-size:9px;line-height:1.6;color:#6d7a70;margin:12px 0 0}.warning{padding:9px;background:#fff6e5;color:#805c1d;border-radius:8px}.table-wrap{overflow-x:auto}table{width:100%;border-collapse:collapse;text-align:left}th{font-size:9px;color:#6d7a70;padding:10px;border-bottom:1px solid #e6ebe6;white-space:nowrap}td{font-size:10px;padding:11px 10px;border-bottom:1px solid #edf0ed;white-space:nowrap}td small{display:block;color:#718076;font-size:9px;margin-top:3px}.selected{background:#eef6f0}.cancel-invoice{border:0;border-radius:6px;padding:6px 8px;background:#fff0ef;color:#a42b25;font-size:9px;font-weight:700;cursor:pointer}.status{display:inline-flex;background:#edf3ee;border-radius:20px;padding:5px 8px;font-size:9px}.actions{display:flex;gap:5px}.actions button{border:0;border-radius:6px;padding:6px 8px;background:#e2f2e7;color:#226344;font-size:9px;font-weight:700;cursor:pointer}.actions .danger{background:#fff0ef;color:#a42b25}.empty{font-size:11px;color:#718076}.alert{font-size:11px;border-radius:8px;padding:11px;margin:0}.error{background:#fff0ef;color:#a42b25}.success{background:#e8f5ec;color:#246847}@media(max-width:1150px){.billing-grid{grid-template-columns:1fr 1fr}.billing-grid article:last-child{grid-column:1/-1}}@media(max-width:750px){.billing-page{padding:13px}.billing-header{align-items:flex-start;flex-direction:column}.settlement-panel{align-items:flex-start;flex-direction:column}.settlement-controls{width:100%}.billing-grid{grid-template-columns:1fr}.billing-grid article:last-child{grid-column:auto}.two{grid-template-columns:1fr}}
      `}</style>
    </main>
  );
}
