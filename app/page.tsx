const stats = [
  { label: "Total armada", value: "—", note: "Tambahkan data kendaraan" },
  { label: "Booking aktif", value: "—", note: "Reservasi belum terhubung" },
  { label: "Percakapan WhatsApp", value: "—", note: "Menunggu konfigurasi Meta API" },
  { label: "Perlu tindakan", value: "—", note: "Data operasional belum tersedia" },
];

const modules = [
  { title: "AI Host WhatsApp", status: "Belum dikonfigurasi", detail: "Webhook resmi, jawaban berbasis kebijakan, dan alih ke staf." },
  { title: "Armada & ketersediaan", status: "Fondasi disiapkan", detail: "Data kendaraan, tarif, jadwal servis, dan pencegahan double booking." },
  { title: "Reservasi & serah terima", status: "Fondasi disiapkan", detail: "Siklus booking, checklist kondisi, kilometer, dan pengembalian." },
  { title: "Keuangan", status: "Fondasi disiapkan", detail: "Invoice, deposit, pembayaran terverifikasi, pengeluaran, dan audit." },
];

export default function HomePage() {
  return (
    <main className="shell">
      <aside className="sidebar">
        <div className="brand-mark">SR</div>
        <div className="brand-copy"><strong>Sans Rent Cars</strong><span>RENTAL OPERATIONS</span></div>
        <nav aria-label="Navigasi utama">
          <a className="nav-item active" href="#overview">◫ <span>Ringkasan</span></a>
          <a className="nav-item" href="#modules">▦ <span>Modul sistem</span></a>
          <a className="nav-item" href="#setup">⚙ <span>Konfigurasi</span></a>
        </nav>
        <div className="sidebar-foot"><span className="status-dot" /> Mode fondasi<br /><small>Belum terhubung ke layanan live</small></div>
      </aside>
      <section className="content">
        <header className="topbar">
          <div><p className="eyebrow">RENTAL MANAGEMENT PLATFORM</p><h1 id="overview">Pusat Operasional</h1><p className="subtitle">Pantau armada, pelanggan, reservasi, dan AI Host dalam satu tempat.</p></div>
          <div className="profile-chip"><span className="profile-avatar">S</span><span><strong>Sans Rent Cars</strong><small>Administrator</small></span></div>
        </header>
        <section className="welcome">
          <div><p className="eyebrow light">SELAMAT DATANG</p><h2>Operasional lebih teratur.<br />Layanan lebih responsif.</h2><p>Fondasi CRM sedang disiapkan. Hubungkan database dan layanan resmi sebelum mengaktifkan data operasional.</p></div>
          <div className="welcome-icon" aria-hidden="true">🚘</div>
        </section>
        <section className="stat-grid" aria-label="Ringkasan statistik">
          {stats.map((item) => <article className="stat-card" key={item.label}><p>{item.label}</p><strong>{item.value}</strong><small>{item.note}</small></article>)}
        </section>
        <section id="modules" className="section-block">
          <div className="section-heading"><div><p className="eyebrow">PLATFORM</p><h2>Modul inti</h2></div><span className="pill">4 area fondasi</span></div>
          <div className="module-grid">{modules.map((item) => <article className="module-card" key={item.title}><div className="module-top"><span className="module-symbol">◇</span><span className="pill muted">{item.status}</span></div><h3>{item.title}</h3><p>{item.detail}</p></article>)}</div>
        </section>
        <section id="setup" className="setup-card"><div><p className="eyebrow">LANGKAH SELANJUTNYA</p><h2>Siapkan integrasi secara aman</h2><p>Masukkan kredensial melalui environment variables di lingkungan deployment. Jangan simpan token WhatsApp atau password database di repositori.</p></div><div className="setup-list"><span><b>01</b> Neon PostgreSQL</span><span><b>02</b> Autentikasi admin</span><span><b>03</b> WhatsApp Cloud API</span><span><b>04</b> AI Host dan kebijakan bisnis</span></div></section>
        <footer>Sans Rent Cars CRM · Tahap fondasi · Data operasional belum dihubungkan</footer>
      </section>
      <style>{`
        .shell{min-height:100vh;display:grid;grid-template-columns:250px minmax(0,1fr)}
        .sidebar{background:#132b22;color:#f4faf6;padding:28px 18px;display:flex;flex-direction:column;gap:30px}
        .brand-mark{width:44px;height:44px;display:grid;place-items:center;border-radius:14px;background:#d6f0e1;color:#14563d;font-weight:800;letter-spacing:-1px}
        .brand-copy{display:flex;flex-direction:column;gap:4px;margin-top:-24px;margin-left:54px}.brand-copy strong{font-size:15px}.brand-copy span{font-size:9px;letter-spacing:1.4px;color:#a9c7b8}
        nav{display:grid;gap:7px}.nav-item{padding:12px 13px;border-radius:10px;display:flex;gap:12px;color:#c6d9cf;font-size:14px}.nav-item.active{background:#275540;color:#fff}.sidebar-foot{margin-top:auto;font-size:12px;line-height:1.7;color:#d1e2d8}.sidebar-foot small{color:#a9c7b8}.status-dot{display:inline-block;width:8px;height:8px;border-radius:50%;background:#e6bc66;margin-right:7px}
        .content{padding:32px clamp(20px,4vw,56px);max-width:1500px;width:100%;margin:0 auto}.topbar{display:flex;justify-content:space-between;align-items:center;gap:20px;margin-bottom:28px}h1{font-size:clamp(27px,3vw,36px);letter-spacing:-1.2px;margin:5px 0 8px}.eyebrow{font-size:10px;letter-spacing:1.7px;font-weight:800;color:#62806f;margin:0 0 8px}.subtitle{margin:0;color:var(--muted);font-size:14px}.profile-chip{display:flex;align-items:center;gap:10px;border:1px solid var(--line);background:#fff;padding:8px 12px;border-radius:13px;white-space:nowrap}.profile-chip strong,.profile-chip small{display:block;font-size:12px}.profile-chip small{color:var(--muted);margin-top:4px}.profile-avatar{display:grid;place-items:center;width:34px;height:34px;background:var(--green-soft);color:var(--green);border-radius:10px;font-weight:800}
        .welcome{background:linear-gradient(115deg,#176b4d,#244b39);color:#fff;padding:clamp(24px,4vw,38px);border-radius:22px;display:flex;align-items:center;justify-content:space-between;gap:20px;overflow:hidden}.eyebrow.light{color:#bce4cd}.welcome h2{font-size:clamp(24px,3vw,34px);letter-spacing:-1px;line-height:1.15;margin:0 0 12px}.welcome p:not(.eyebrow){max-width:580px;color:#dceee4;line-height:1.7;font-size:14px;margin:0}.welcome-icon{font-size:76px;filter:grayscale(.2);opacity:.9}
        .stat-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px;margin:20px 0 38px}.stat-card,.module-card,.setup-card{background:var(--panel);border:1px solid var(--line);border-radius:16px}.stat-card{padding:19px}.stat-card p{font-size:12px;color:var(--muted);margin:0 0 14px}.stat-card strong{font-size:28px;display:block;letter-spacing:-.8px}.stat-card small{display:block;font-size:11px;color:var(--muted);margin-top:8px}
        .section-block{margin:0 0 34px}.section-heading{display:flex;align-items:end;justify-content:space-between;margin-bottom:16px}.section-heading h2,.setup-card h2{margin:0;font-size:22px;letter-spacing:-.5px}.pill{font-size:10px;padding:7px 10px;background:#e7f4ed;color:#176b4d;border-radius:99px;font-weight:700}.pill.muted{background:#f0f3f1;color:#67756c;font-weight:600}.module-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}.module-card{padding:20px}.module-top{display:flex;justify-content:space-between;align-items:center;gap:8px}.module-symbol{width:38px;height:38px;display:grid;place-items:center;border-radius:12px;background:#eef6f0;color:#176b4d;font-size:24px}.module-card h3{font-size:16px;margin:17px 0 8px}.module-card p,.setup-card p{font-size:13px;line-height:1.7;color:var(--muted);margin:0}
        .setup-card{padding:24px;display:grid;grid-template-columns:1.2fr 1fr;gap:26px}.setup-card h2{margin-bottom:10px}.setup-list{display:grid;gap:10px;align-content:center}.setup-list span{padding:11px 12px;border-radius:10px;background:#f6f8f6;font-size:12px}.setup-list b{color:#176b4d;margin-right:10px}footer{color:#87928b;font-size:11px;padding:24px 0 4px}
        @media(max-width:1000px){.shell{grid-template-columns:1fr}.sidebar{padding:16px 20px;display:grid;grid-template-columns:auto 1fr;gap:10px;align-items:center}.brand-copy{margin:0}.sidebar nav,.sidebar-foot{display:none}.stat-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
        @media(max-width:600px){.content{padding:22px 15px}.topbar{align-items:flex-start;flex-direction:column}.profile-chip{display:none}.welcome-icon{display:none}.module-grid,.setup-card{grid-template-columns:1fr}.module-top{align-items:flex-start;flex-direction:column}.stat-card{padding:15px}.stat-card strong{font-size:24px}}
      `}</style>
    </main>
  );
}
