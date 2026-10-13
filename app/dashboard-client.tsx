"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import BookingWorkspace from "@/app/booking-workspace";
import FinanceWorkspace from "@/app/finance-workspace";

type User = { id: string; email: string; fullName: string; role: string };
type Customer = { id: string; full_name: string | null; whatsapp_number: string; email: string | null; preferred_locale: string; notes: string | null; created_at: string };
type Vehicle = { id: string; registration_number: string; make: string; model: string; model_year: number | null; transmission: string | null; seats: number | null; service_mode: string; status: string; daily_rate: string | number; odometer_km: number; notes: string | null };

async function responseError(response: Response) {
  const body = await response.json().catch(() => ({})) as { error?: string };
  return body.error || "Permintaan tidak berhasil. Silakan coba kembali.";
}

export default function DashboardClient() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"overview" | "customers" | "vehicles" | "bookings" | "finance">("overview");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [customerName, setCustomerName] = useState("");
  const [customerWhatsapp, setCustomerWhatsapp] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [vehiclePlate, setVehiclePlate] = useState("");
  const [vehicleMake, setVehicleMake] = useState("");
  const [vehicleModel, setVehicleModel] = useState("");
  const [vehicleYear, setVehicleYear] = useState("");
  const [vehicleRate, setVehicleRate] = useState("0");
  const [vehicleMode, setVehicleMode] = useState("both");

  const loadData = useCallback(async () => {
    const [customerResponse, vehicleResponse] = await Promise.all([
      fetch("/api/customers", { cache: "no-store" }),
      fetch("/api/vehicles", { cache: "no-store" }),
    ]);
    if (customerResponse.ok) {
      const result = await customerResponse.json() as { data: Customer[] };
      setCustomers(result.data);
    }
    if (vehicleResponse.ok) {
      const result = await vehicleResponse.json() as { data: Vehicle[] };
      setVehicles(result.data);
    }
  }, []);

  const checkSession = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/auth/session", { cache: "no-store" });
      if (response.ok) {
        const result = await response.json() as { user: User };
        setUser(result.user);
        await loadData();
      } else {
        setUser(null);
      }
    } catch {
      setError("Aplikasi belum dapat dihubungi. Periksa koneksi dan konfigurasi server.");
    } finally {
      setLoading(false);
    }
  }, [loadData]);

  useEffect(() => { void checkSession(); }, [checkSession]);

  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setMessage("");
    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    if (!response.ok) {
      setError(await responseError(response));
      return;
    }
    setPassword("");
    await checkSession();
    setMessage("Berhasil masuk ke dashboard.");
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    setUser(null);
    setCustomers([]);
    setVehicles([]);
    setMessage("Anda telah keluar.");
  }

  async function addCustomer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setMessage("");
    const response = await fetch("/api/customers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fullName: customerName, whatsappNumber: customerWhatsapp, email: customerEmail }),
    });
    if (!response.ok) { setError(await responseError(response)); return; }
    setCustomerName(""); setCustomerWhatsapp(""); setCustomerEmail("");
    await loadData();
    setMessage("Data pelanggan berhasil disimpan.");
  }

  async function addVehicle(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setMessage("");
    const response = await fetch("/api/vehicles", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        registrationNumber: vehiclePlate, make: vehicleMake, model: vehicleModel,
        modelYear: vehicleYear || undefined, dailyRate: vehicleRate, serviceMode: vehicleMode,
      }),
    });
    if (!response.ok) { setError(await responseError(response)); return; }
    setVehiclePlate(""); setVehicleMake(""); setVehicleModel(""); setVehicleYear(""); setVehicleRate("0");
    await loadData();
    setMessage("Data kendaraan berhasil disimpan.");
  }

  if (loading) return <main className="loading-screen"><div className="loading-mark">SR</div><p>Memeriksa sesi dan koneksi aplikasi…</p></main>;

  if (!user) return (
    <main className="login-shell">
      <section className="login-intro">
        <div className="brand-mark">SR</div>
        <p className="eyebrow light">SANS RENT CARS · OPERATIONS</p>
        <h1>Kelola rental dengan lebih teratur.</h1>
        <p>CRM pelanggan dan fondasi manajemen armada dalam satu tempat.</p>
        <div className="login-points"><span>01 / Data pelanggan terpusat</span><span>02 / Data armada terorganisir</span><span>03 / Akses admin terlindungi</span></div>
      </section>
      <section className="login-panel">
        <form className="login-card" onSubmit={login}>
          <p className="eyebrow">AREA ADMINISTRATOR</p>
          <h2>Masuk ke dashboard</h2>
          <p className="form-hint">Gunakan akun admin yang telah dibuat melalui proses bootstrap.</p>
          <label>Email<input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required maxLength={254} /></label>
          <label>Kata sandi<input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required maxLength={256} /></label>
          {error && <p className="alert error">{error}</p>}
          {message && <p className="alert success">{message}</p>}
          <button className="primary-button" type="submit">Masuk dengan aman</button>
          <small className="privacy-note">Pembuatan admin dilakukan satu kali melalui endpoint bootstrap yang dikunci dengan secret server.</small>
        </form>
      </section>
      <style>{styles}</style>
    </main>
  );

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand-row"><div className="brand-mark">SR</div><div><strong>Sans Rent Cars</strong><small>RENTAL OPERATIONS</small></div></div>
        <nav aria-label="Navigasi utama">
          <button className={tab === "overview" ? "nav-item active" : "nav-item"} onClick={() => setTab("overview")}>◫ <span>Ringkasan</span></button>
          <button className={tab === "customers" ? "nav-item active" : "nav-item"} onClick={() => setTab("customers")}>♙ <span>Pelanggan</span></button>
          <button className={tab === "vehicles" ? "nav-item active" : "nav-item"} onClick={() => setTab("vehicles")}>▣ <span>Armada</span></button>
          <button className={tab === "bookings" ? "nav-item active" : "nav-item"} onClick={() => setTab("bookings")}>▦ <span>Pemesanan</span></button>
          <button className={tab === "finance" ? "nav-item active" : "nav-item"} onClick={() => setTab("finance")}>Rp <span>Keuangan</span></button>
        </nav>
        <div className="sidebar-foot"><span className="status-dot" /> Sesi admin aktif<small>Database dibaca melalui API server</small></div>
      </aside>
      <section className="main-content">
        <header className="topbar">
          <div><p className="eyebrow">RENTAL MANAGEMENT PLATFORM</p><h1>{tab === "overview" ? "Pusat Operasional" : tab === "customers" ? "Data Pelanggan" : tab === "vehicles" ? "Manajemen Armada" : tab === "bookings" ? "Pemesanan dan Jadwal" : "Keuangan dan Rekonsiliasi"}</h1><p className="subtitle">Kelola data Sans Rent Cars dengan akses terautentikasi.</p></div>
          <div className="user-actions"><div className="user-chip"><span className="profile-avatar">{user.fullName.slice(0, 1).toUpperCase()}</span><span><strong>{user.fullName}</strong><small>{user.role} · {user.email}</small></span></div><button className="secondary-button" onClick={logout}>Keluar</button></div>
        </header>
        {(error || message) && <p className={error ? "alert error" : "alert success"}>{error || message}</p>}
        {tab === "overview" && <>
          <section className="welcome"><div><p className="eyebrow light">SELAMAT DATANG</p><h2>Operasional lebih teratur.<br />Layanan lebih responsif.</h2><p>Fondasi admin sudah terhubung ke database. Tambahkan data kendaraan dan pelanggan untuk memulai pengisian data operasional.</p></div><div className="welcome-icon" aria-hidden="true">🚘</div></section>
          <section className="stat-grid"><article className="stat-card"><p>Total armada</p><strong>{vehicles.length}</strong><small>kendaraan terdaftar</small></article><article className="stat-card"><p>Total pelanggan</p><strong>{customers.length}</strong><small>pelanggan terdaftar</small></article><article className="stat-card"><p>WhatsApp</p><strong className="small-status">Belum aktif</strong><small>menunggu konfigurasi Meta API</small></article><article className="stat-card"><p>AI Host</p><strong className="small-status">Belum aktif</strong><small>menunggu provider dan kebijakan AI</small></article></section>
          <section className="content-grid"><article className="panel"><div className="panel-heading"><div><p className="eyebrow">CRM</p><h2>Pelanggan terbaru</h2></div><button className="text-button" onClick={() => setTab("customers")}>Lihat semua →</button></div>{customers.length ? <div className="table-wrap"><table><thead><tr><th>Nama</th><th>WhatsApp</th></tr></thead><tbody>{customers.slice(0, 5).map((c) => <tr key={c.id}><td>{c.full_name || "Belum diisi"}</td><td>{c.whatsapp_number}</td></tr>)}</tbody></table></div> : <p className="empty-state">Belum ada pelanggan. Buka menu Pelanggan untuk menambahkan data pertama.</p>}</article><article className="panel"><div className="panel-heading"><div><p className="eyebrow">FLEET</p><h2>Armada terbaru</h2></div><button className="text-button" onClick={() => setTab("vehicles")}>Lihat semua →</button></div>{vehicles.length ? <div className="table-wrap"><table><thead><tr><th>Kendaraan</th><th>Nomor polisi</th></tr></thead><tbody>{vehicles.slice(0, 5).map((v) => <tr key={v.id}><td>{v.make} {v.model}</td><td>{v.registration_number}</td></tr>)}</tbody></table></div> : <p className="empty-state">Belum ada kendaraan. Buka menu Armada untuk menambahkan data pertama.</p>}</article></section>
        </>}
        {tab === "customers" && <section className="content-grid"><article className="panel"><div className="panel-heading"><div><p className="eyebrow">CRM</p><h2>Tambah pelanggan</h2></div></div><form className="data-form" onSubmit={addCustomer}><label>Nama pelanggan<input value={customerName} onChange={(e) => setCustomerName(e.target.value)} maxLength={160} placeholder="Nama lengkap" /></label><label>Nomor WhatsApp<input value={customerWhatsapp} onChange={(e) => setCustomerWhatsapp(e.target.value)} required maxLength={20} placeholder="+6281234567890" /></label><label>Email (opsional)<input type="email" value={customerEmail} onChange={(e) => setCustomerEmail(e.target.value)} maxLength={254} placeholder="pelanggan@email.com" /></label><button className="primary-button" type="submit">Simpan pelanggan</button></form></article><article className="panel"><div className="panel-heading"><div><p className="eyebrow">DATABASE</p><h2>Daftar pelanggan ({customers.length})</h2></div></div>{customers.length ? <div className="table-wrap"><table><thead><tr><th>Nama</th><th>WhatsApp</th><th>Email</th></tr></thead><tbody>{customers.map((c) => <tr key={c.id}><td>{c.full_name || "—"}</td><td>{c.whatsapp_number}</td><td>{c.email || "—"}</td></tr>)}</tbody></table></div> : <p className="empty-state">Data pelanggan akan tampil di sini setelah disimpan.</p>}</article></section>}
        {tab === "vehicles" && <section className="content-grid"><article className="panel"><div className="panel-heading"><div><p className="eyebrow">FLEET</p><h2>Tambah kendaraan</h2></div></div><form className="data-form" onSubmit={addVehicle}><label>Nomor polisi<input value={vehiclePlate} onChange={(e) => setVehiclePlate(e.target.value)} required maxLength={20} placeholder="S 1234 AB" /></label><div className="field-row"><label>Merek<input value={vehicleMake} onChange={(e) => setVehicleMake(e.target.value)} required maxLength={80} placeholder="Toyota" /></label><label>Model<input value={vehicleModel} onChange={(e) => setVehicleModel(e.target.value)} required maxLength={80} placeholder="Avanza" /></label></div><div className="field-row"><label>Tahun<input type="number" min="1950" max={new Date().getFullYear() + 2} value={vehicleYear} onChange={(e) => setVehicleYear(e.target.value)} placeholder="2024" /></label><label>Tarif harian (Rp)<input type="number" min="0" step="1000" value={vehicleRate} onChange={(e) => setVehicleRate(e.target.value)} required /></label></div><label>Jenis layanan<select value={vehicleMode} onChange={(e) => setVehicleMode(e.target.value)}><option value="both">Lepas kunci dan dengan sopir</option><option value="self_drive">Lepas kunci</option><option value="chauffeur">Dengan sopir</option></select></label><button className="primary-button" type="submit">Simpan kendaraan</button></form></article><article className="panel"><div className="panel-heading"><div><p className="eyebrow">DATABASE</p><h2>Daftar armada ({vehicles.length})</h2></div></div>{vehicles.length ? <div className="table-wrap"><table><thead><tr><th>Kendaraan</th><th>Nomor polisi</th><th>Tarif/hari</th><th>Status</th></tr></thead><tbody>{vehicles.map((v) => <tr key={v.id}><td>{v.make} {v.model}{v.model_year ? <small className="cell-note">{v.model_year}</small> : null}</td><td>{v.registration_number}</td><td>{Number(v.daily_rate).toLocaleString("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 })}</td><td><span className="status-pill">{v.status === "available" ? "Tersedia" : v.status === "maintenance" ? "Perawatan" : "Nonaktif"}</span></td></tr>)}</tbody></table></div> : <p className="empty-state">Data kendaraan akan tampil di sini setelah disimpan.</p>}</article></section>}
        {tab === "bookings" && <BookingWorkspace />}
        {tab === "finance" && <FinanceWorkspace />}
        <footer>Sans Rent Cars CRM · CRM, armada, dan pemesanan · WhatsApp dan AI belum diaktifkan</footer>
      </section>
      <style>{styles}</style>
    </main>
  );
}

const styles = `
  .loading-screen{min-height:100vh;display:grid;place-content:center;justify-items:center;color:var(--muted);gap:14px}.loading-mark,.brand-mark{width:46px;height:46px;display:grid;place-items:center;border-radius:14px;background:#d6f0e1;color:#14563d;font-weight:800;letter-spacing:-1px}
  .login-shell{min-height:100vh;display:grid;grid-template-columns:1fr 1fr;background:#fff}.login-intro{background:linear-gradient(145deg,#132b22,#176b4d);color:#fff;padding:clamp(30px,6vw,88px);display:flex;flex-direction:column;align-items:flex-start;justify-content:center}.login-intro .brand-mark{margin-bottom:46px}.eyebrow{font-size:10px;letter-spacing:1.7px;font-weight:800;color:#62806f;margin:0 0 8px}.eyebrow.light{color:#bce4cd}.login-intro h1{font-size:clamp(34px,4vw,54px);line-height:1.08;letter-spacing:-2px;margin:12px 0 18px;max-width:560px}.login-intro>p:not(.eyebrow){color:#dceee4;line-height:1.8;max-width:440px}.login-points{display:grid;gap:14px;margin-top:48px;color:#c8e4d4;font-size:12px;letter-spacing:.4px}.login-panel{display:grid;place-items:center;padding:30px}.login-card{width:min(100%,390px);display:grid;gap:17px}.login-card h2{font-size:28px;letter-spacing:-.8px;margin:0}.form-hint,.privacy-note{color:var(--muted);font-size:12px;line-height:1.7;margin:0}.login-card label,.data-form label{display:grid;gap:7px;font-size:12px;font-weight:700;color:#344239}.login-card input,.data-form input,.data-form select{width:100%;min-width:0;padding:12px 13px;border:1px solid #dce4de;border-radius:10px;background:#fff;color:var(--ink);outline:none}.login-card input:focus,.data-form input:focus,.data-form select:focus{border-color:#3e8b67;box-shadow:0 0 0 3px #e7f4ed}
  .primary-button,.secondary-button{border:0;border-radius:10px;padding:12px 15px;font-size:12px;font-weight:800;cursor:pointer}.primary-button{background:#176b4d;color:#fff}.primary-button:hover{background:#12573e}.secondary-button{background:#edf3ef;color:#304b3b}.alert{border-radius:10px;padding:11px 13px;font-size:12px;line-height:1.6;margin:0}.alert.error{background:#fff0ee;color:#9d3025}.alert.success{background:#e7f4ed;color:#176b4d}
  .app-shell{min-height:100vh;display:grid;grid-template-columns:240px minmax(0,1fr)}.sidebar{background:#132b22;color:#f4faf6;padding:26px 16px;display:flex;flex-direction:column;gap:30px}.brand-row{display:flex;align-items:center;gap:11px}.brand-row strong,.brand-row small{display:block}.brand-row strong{font-size:14px}.brand-row small{font-size:9px;letter-spacing:1.3px;color:#a9c7b8;margin-top:4px}.sidebar nav{display:grid;gap:7px}.nav-item{width:100%;border:0;background:transparent;text-align:left;padding:12px 13px;border-radius:10px;display:flex;gap:12px;align-items:center;color:#c6d9cf;font-size:13px;cursor:pointer}.nav-item.active{background:#275540;color:#fff}.sidebar-foot{margin-top:auto;font-size:12px;line-height:1.7;color:#d1e2d8}.sidebar-foot small{display:block;color:#a9c7b8;margin-top:4px}.status-dot{display:inline-block;width:8px;height:8px;border-radius:50%;background:#76d7a3;margin-right:7px}
  .main-content{padding:32px clamp(18px,3vw,46px);max-width:1600px;width:100%;margin:0 auto}.topbar{display:flex;justify-content:space-between;align-items:center;gap:20px;margin-bottom:26px}h1{font-size:clamp(26px,3vw,34px);letter-spacing:-1.2px;margin:5px 0 8px}.subtitle{margin:0;color:var(--muted);font-size:13px}.user-actions{display:flex;align-items:center;gap:12px}.user-chip{display:flex;align-items:center;gap:9px;border:1px solid var(--line);background:#fff;padding:8px 11px;border-radius:13px;white-space:nowrap}.user-chip strong,.user-chip small{display:block;font-size:11px}.user-chip small{color:var(--muted);margin-top:4px}.profile-avatar{display:grid;place-items:center;width:32px;height:32px;background:var(--green-soft);color:var(--green);border-radius:10px;font-weight:800}
  .welcome{background:linear-gradient(115deg,#176b4d,#244b39);color:#fff;padding:clamp(22px,3vw,34px);border-radius:20px;display:flex;align-items:center;justify-content:space-between;gap:20px;overflow:hidden}.welcome h2{font-size:clamp(24px,3vw,32px);letter-spacing:-1px;line-height:1.15;margin:0 0 12px}.welcome p:not(.eyebrow){max-width:600px;color:#dceee4;line-height:1.7;font-size:13px;margin:0}.welcome-icon{font-size:68px;opacity:.9}.stat-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:13px;margin:18px 0 24px}.stat-card,.panel{background:var(--panel);border:1px solid var(--line);border-radius:15px}.stat-card{padding:18px}.stat-card p{font-size:11px;color:var(--muted);margin:0 0 12px}.stat-card strong{font-size:26px;display:block;letter-spacing:-.8px}.stat-card small{display:block;font-size:10px;color:var(--muted);margin-top:7px}.stat-card .small-status{font-size:16px;letter-spacing:0}.content-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:15px;margin-bottom:20px}.panel{padding:20px;min-width:0}.panel-heading{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:16px}.panel-heading h2{margin:0;font-size:17px;letter-spacing:-.3px}.text-button{border:0;background:transparent;color:#176b4d;font-size:11px;font-weight:800;cursor:pointer}.empty-state{padding:18px 0;color:var(--muted);font-size:12px;line-height:1.7}.table-wrap{width:100%;overflow:auto}table{border-collapse:collapse;width:100%;font-size:11px;text-align:left}th{color:var(--muted);font-weight:700;background:#f7f9f7}th,td{padding:11px 10px;border-bottom:1px solid var(--line);white-space:nowrap}td{font-weight:500}.cell-note{display:block;color:var(--muted);font-size:10px;margin-top:4px}.status-pill{background:#e7f4ed;color:#176b4d;border-radius:30px;padding:5px 8px;font-size:10px}.data-form{display:grid;gap:14px}.field-row{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}footer{color:#87928b;font-size:10px;padding:24px 0 4px}
  @media(max-width:1100px){.app-shell{grid-template-columns:1fr}.sidebar{padding:15px 20px;display:flex;flex-direction:row;align-items:center;justify-content:space-between;gap:15px}.sidebar nav{display:flex;gap:4px}.sidebar-foot{display:none}.nav-item{width:auto}.brand-row small{display:none}.stat-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.content-grid{grid-template-columns:1fr}}
  @media(max-width:700px){.login-shell{grid-template-columns:1fr}.login-intro{padding:28px;min-height:300px}.login-intro .brand-mark{margin-bottom:24px}.login-points{display:none}.login-panel{padding:28px 22px}.sidebar{align-items:flex-start;flex-direction:column}.sidebar nav{width:100%;overflow:auto}.nav-item{white-space:nowrap}.main-content{padding:22px 14px}.topbar{align-items:flex-start;flex-direction:column}.user-actions{width:100%;justify-content:space-between}.welcome-icon{display:none}.stat-grid{gap:9px}.stat-card{padding:14px}.stat-card strong{font-size:22px}.field-row{grid-template-columns:1fr}}
`;
