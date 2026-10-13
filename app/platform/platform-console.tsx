"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type Plan = {
  id: string; code: string; name: string; description: string; activation_fee: string | number;
  monthly_fee: string | number; commission_rate_bps: number; commission_cap_amount: string | number | null;
  max_vehicles: number | null; max_users: number | null; monthly_conversation_limit: number | null;
  included_ai_tokens: string | number; is_active: boolean;
};
type Tenant = {
  id: string; name: string; slug: string; created_at: string; subscription_id: string | null;
  subscription_status: string | null; activation_status: string | null; plan_id: string | null;
  plan_name: string | null; open_platform_invoices: number;
};

const idr = (value: string | number | null | undefined) => Number(value || 0).toLocaleString("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 });
const statusLabel: Record<string, string> = {
  pending_activation: "Menunggu aktivasi", trialing: "Uji coba", active: "Aktif", past_due: "Menunggak",
  suspended: "Ditangguhkan", cancelled: "Dibatalkan", expired: "Kedaluwarsa",
};

export default function PlatformConsole({ fullName, email }: { fullName: string; email: string }) {
  const router = useRouter();
  const [plans, setPlans] = useState<Plan[]>([]);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [activationFee, setActivationFee] = useState("0");
  const [monthlyFee, setMonthlyFee] = useState("0");
  const [commissionPercent, setCommissionPercent] = useState("0");
  const [commissionCap, setCommissionCap] = useState("");
  const [maxVehicles, setMaxVehicles] = useState("");
  const [maxUsers, setMaxUsers] = useState("");
  const [conversationLimit, setConversationLimit] = useState("");
  const [aiTokens, setAiTokens] = useState("0");
  const [selectedTenant, setSelectedTenant] = useState("");
  const [selectedPlan, setSelectedPlan] = useState("");

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const [planResponse, tenantResponse] = await Promise.all([
        fetch("/api/platform/plans", { cache: "no-store" }),
        fetch("/api/platform/tenants", { cache: "no-store" }),
      ]);
      const [planResult, tenantResult] = await Promise.all([planResponse.json(), tenantResponse.json()]);
      if (!planResponse.ok) throw new Error(planResult.error || "Daftar paket gagal dimuat.");
      if (!tenantResponse.ok) throw new Error(tenantResult.error || "Daftar tenant gagal dimuat.");
      const nextPlans = (planResult.data || []) as Plan[];
      const nextTenants = (tenantResult.data || []) as Tenant[];
      setPlans(nextPlans); setTenants(nextTenants);
      setSelectedPlan((current) => current && nextPlans.some((p) => p.id === current) ? current : nextPlans.find((p) => p.is_active)?.id || "");
      setSelectedTenant((current) => current && nextTenants.some((t) => t.id === current) ? current : nextTenants.find((t) => !t.subscription_id)?.id || "");
    } catch (e) { setError(e instanceof Error ? e.message : "Data platform gagal dimuat."); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function createPlan(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/platform/plans", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code, name, description, activationFee: Number(activationFee), monthlyFee: Number(monthlyFee),
          commissionRateBps: Math.round(Number(commissionPercent) * 100),
          commissionCapAmount: commissionCap.trim() ? Number(commissionCap) : null,
          maxVehicles: maxVehicles.trim() ? Number(maxVehicles) : null,
          maxUsers: maxUsers.trim() ? Number(maxUsers) : null,
          monthlyConversationLimit: conversationLimit.trim() ? Number(conversationLimit) : null,
          includedAiTokens: Number(aiTokens),
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Paket gagal dibuat.");
      setCode(""); setName(""); setDescription(""); setActivationFee("0"); setMonthlyFee("0");
      setCommissionPercent("0"); setCommissionCap(""); setMaxVehicles(""); setMaxUsers(""); setConversationLimit(""); setAiTokens("0");
      setNotice("Paket dibuat. Harga paket tidak otomatis mengaktifkan tenant atau membuat tagihan.");
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Paket gagal dibuat."); }
    finally { setBusy(false); }
  }

  async function assignPlan(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !selectedTenant || !selectedPlan) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/platform/subscriptions", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organizationId: selectedTenant, planId: selectedPlan, billingCycle: "monthly" }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Paket tenant gagal ditetapkan.");
      setNotice(result.message || "Paket ditetapkan dalam status menunggu aktivasi.");
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Paket tenant gagal ditetapkan."); }
    finally { setBusy(false); }
  }

  async function logout() {
    setBusy(true);
    try {
      await fetch("/api/platform/auth/logout", { method: "POST" });
      router.replace("/platform/login"); router.refresh();
    } finally { setBusy(false); }
  }

  const unassigned = tenants.filter((tenant) => !["pending_activation", "trialing", "active", "past_due", "suspended"].includes(tenant.subscription_status || ""));
  const activePlans = plans.filter((plan) => plan.is_active);

  return (
    <main className="platform-console">
      <header className="topbar"><div><p className="eyebrow">AKVISIO AUTOHOST · PLATFORM</p><h1>Super Admin</h1><p>Masuk sebagai {fullName} · {email}</p></div><div className="top-actions"><a className="secondary" href="/platform/billing">Invoice & pembayaran</a><button className="secondary" onClick={() => void load()} disabled={loading}>Muat ulang</button><button className="logout" onClick={() => void logout()} disabled={busy}>Keluar</button></div></header>
      {error && <p className="alert error" role="alert">{error}</p>}
      {notice && <p className="alert success" role="status">{notice}</p>}
      <section className="stats">
        <article><small>Total tenant</small><strong>{tenants.length}</strong></article>
        <article><small>Paket tersedia</small><strong>{activePlans.length}</strong></article>
        <article><small>Menunggu paket</small><strong>{unassigned.length}</strong></article>
        <article><small>Invoice terbuka</small><strong>{tenants.reduce((sum, tenant) => sum + Number(tenant.open_platform_invoices || 0), 0)}</strong></article>
      </section>
      <section className="columns">
        <article className="panel">
          <div className="panel-heading"><div><p className="eyebrow">COMMERCIAL CATALOG</p><h2>Buat paket SaaS</h2></div></div>
          <form className="plan-form" onSubmit={(event) => void createPlan(event)}>
            <div className="two"><label>Kode paket<input value={code} onChange={(event) => setCode(event.target.value.toLowerCase())} required maxLength={48} pattern="[a-z0-9]+(?:-[a-z0-9]+)*" placeholder="starter-ai" /></label><label>Nama paket<input value={name} onChange={(event) => setName(event.target.value)} required maxLength={120} placeholder="Starter AI Host" /></label></div>
            <label>Deskripsi<textarea value={description} onChange={(event) => setDescription(event.target.value)} maxLength={1000} rows={2} /></label>
            <div className="two"><label>Biaya aktivasi (Rp)<input type="number" min="0" step="1000" value={activationFee} onChange={(event) => setActivationFee(event.target.value)} required /></label><label>Biaya bulanan (Rp)<input type="number" min="0" step="1000" value={monthlyFee} onChange={(event) => setMonthlyFee(event.target.value)} required /></label></div>
            <div className="two"><label>Komisi transaksi (%)<input type="number" min="0" max="100" step="0.01" value={commissionPercent} onChange={(event) => setCommissionPercent(event.target.value)} required /></label><label>Batas komisi/bulan (Rp, opsional)<input type="number" min="0" step="1000" value={commissionCap} onChange={(event) => setCommissionCap(event.target.value)} /></label></div>
            <div className="two"><label>Batas kendaraan<input type="number" min="1" value={maxVehicles} onChange={(event) => setMaxVehicles(event.target.value)} placeholder="Kosong = tanpa batas" /></label><label>Batas pengguna<input type="number" min="1" value={maxUsers} onChange={(event) => setMaxUsers(event.target.value)} placeholder="Kosong = tanpa batas" /></label></div>
            <div className="two"><label>Batas percakapan/bulan<input type="number" min="1" value={conversationLimit} onChange={(event) => setConversationLimit(event.target.value)} placeholder="Kosong = tanpa batas" /></label><label>Token AI termasuk/bulan<input type="number" min="0" value={aiTokens} onChange={(event) => setAiTokens(event.target.value)} required /></label></div>
            <button className="primary" type="submit" disabled={busy}>{busy ? "Menyimpan…" : "Simpan paket"}</button>
          </form>
        </article>
        <article className="panel">
          <div className="panel-heading"><div><p className="eyebrow">TENANT ONBOARDING</p><h2>Tetapkan paket ke tenant</h2></div></div>
          <form className="plan-form" onSubmit={(event) => void assignPlan(event)}>
            <label>Tenant belum memiliki subscription<select value={selectedTenant} onChange={(event) => setSelectedTenant(event.target.value)} required><option value="">Pilih tenant</option>{unassigned.map((tenant) => <option key={tenant.id} value={tenant.id}>{tenant.name} · {tenant.slug}</option>)}</select></label>
            <label>Paket aktif<select value={selectedPlan} onChange={(event) => setSelectedPlan(event.target.value)} required><option value="">Pilih paket</option>{activePlans.map((plan) => <option key={plan.id} value={plan.id}>{plan.name} · {idr(plan.monthly_fee)}/bulan</option>)}</select></label>
            <p className="notice">Penetapan paket membuat subscription berstatus menunggu aktivasi. Ini belum menerbitkan invoice, memverifikasi pembayaran, atau mengaktifkan layanan.</p>
            <button className="primary" type="submit" disabled={busy || !selectedTenant || !selectedPlan}>{busy ? "Memproses…" : "Tetapkan paket"}</button>
          </form>
          <div className="plan-list"><h3>Paket yang terdaftar ({plans.length})</h3>{plans.length ? plans.map((plan) => <div className="plan-row" key={plan.id}><div><strong>{plan.name}</strong><small>{plan.code} · {plan.commission_rate_bps / 100}% komisi · {plan.is_active ? "Aktif" : "Nonaktif"}</small></div><div className="plan-price"><strong>{idr(plan.monthly_fee)}</strong><small>per bulan</small></div></div>) : <p className="empty">{loading ? "Memuat paket…" : "Belum ada paket. Buat paket pertama setelah kebijakan harga disetujui."}</p>}</div>
        </article>
      </section>
      <section className="panel tenants-panel"><div className="panel-heading"><div><p className="eyebrow">TENANT DIRECTORY</p><h2>Daftar tenant ({tenants.length})</h2></div></div>
        {loading ? <p className="empty">Memuat tenant…</p> : tenants.length ? <div className="table-wrap"><table><thead><tr><th>Tenant</th><th>Paket</th><th>Status subscription</th><th>Status aktivasi</th><th>Invoice terbuka</th></tr></thead><tbody>{tenants.map((tenant) => <tr key={tenant.id}><td><strong>{tenant.name}</strong><small>{tenant.slug}</small></td><td>{tenant.plan_name || "Belum ditetapkan"}</td><td><span className="status">{tenant.subscription_status ? statusLabel[tenant.subscription_status] || tenant.subscription_status : "Belum ada"}</span></td><td>{tenant.activation_status || "—"}</td><td>{tenant.open_platform_invoices}</td></tr>)}</tbody></table></div> : <p className="empty">Belum ada tenant.</p>}
      </section>
      <p className="footer-note">Fondasi pengelolaan paket dan subscription. Penerbitan invoice, verifikasi pembayaran, komisi otomatis, penangguhan, dan pemulihan layanan belum diaktifkan.</p>
      <style jsx>{`
        .platform-console{min-height:100vh;padding:28px;display:grid;gap:18px;background:#f5f7f5;color:#1b2a20}.topbar{display:flex;justify-content:space-between;align-items:center;gap:16px}.topbar h1{font-size:28px;letter-spacing:-.8px;margin:4px 0}.topbar p:not(.eyebrow){font-size:11px;color:#68766d;margin:0}.eyebrow{font-size:9px;letter-spacing:1.5px;font-weight:800;color:#347b55;margin:0 0 7px}.top-actions{display:flex;gap:8px}.top-actions button,.plan-form button{border:0;border-radius:8px;padding:10px 13px;font-size:11px;font-weight:700;cursor:pointer}.secondary{background:#e6ede7;color:#274b35}.logout{background:#263b2d;color:#fff}.primary{background:#236a47;color:#fff}.top-actions button:disabled,.plan-form button:disabled{opacity:.5;cursor:wait}.stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}.stats article,.panel{background:#fff;border:1px solid #e0e7e1;border-radius:13px}.stats article{padding:16px;display:grid;gap:8px}.stats small{font-size:10px;color:#718076}.stats strong{font-size:24px}.columns{display:grid;grid-template-columns:1fr 1fr;gap:14px;align-items:start}.panel{padding:18px;min-width:0}.panel-heading{display:flex;justify-content:space-between;align-items:center;margin-bottom:15px}.panel-heading h2{font-size:16px;margin:0}.plan-form{display:grid;gap:12px}.plan-form label{display:grid;gap:5px;font-size:10px;font-weight:700}.plan-form input,.plan-form textarea,.plan-form select{width:100%;min-width:0;border:1px solid #d8e2da;border-radius:7px;padding:9px;background:#fff;color:#1b2a20;font:inherit;font-size:11px}.two{display:grid;grid-template-columns:1fr 1fr;gap:9px}.notice{margin:0;padding:10px;border-radius:8px;background:#f4f7f4;color:#66746a;font-size:10px;line-height:1.6}.plan-list{margin-top:22px;border-top:1px solid #e5eae5;padding-top:14px}.plan-list h3{font-size:12px;margin:0 0 9px}.plan-row{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:11px 0;border-bottom:1px solid #edf0ed}.plan-row div{display:grid;gap:4px}.plan-row strong{font-size:11px}.plan-row small{font-size:9px;color:#718076}.plan-price{text-align:right}.table-wrap{overflow-x:auto}.tenants-panel table{width:100%;border-collapse:collapse;text-align:left}.tenants-panel th{font-size:9px;color:#6d7a70;padding:10px;border-bottom:1px solid #e6ebe6}.tenants-panel td{font-size:10px;padding:12px 10px;border-bottom:1px solid #edf0ed;white-space:nowrap}.tenants-panel td:first-child{white-space:normal}.tenants-panel td:first-child strong,.tenants-panel td:first-child small{display:block}.tenants-panel td:first-child small{margin-top:3px;color:#718076;font-size:9px}.status{background:#edf3ee;border-radius:20px;padding:5px 8px;font-size:9px}.empty{font-size:11px;color:#718076}.footer-note{font-size:10px;line-height:1.6;color:#6d7a70;margin:0}.alert{font-size:11px;border-radius:8px;padding:11px;margin:0}.error{background:#fff0ef;color:#a42b25}.success{background:#e8f5ec;color:#246847}@media(max-width:950px){.columns{grid-template-columns:1fr}}@media(max-width:650px){.platform-console{padding:14px}.topbar{align-items:flex-start;flex-direction:column}.stats{grid-template-columns:repeat(2,minmax(0,1fr))}.two{grid-template-columns:1fr}.panel{padding:13px}}
      `}</style>
    </main>
  );
}
