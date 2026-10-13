"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

export default function PlatformLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/platform/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
        cache: "no-store",
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Login Super Admin gagal.");
      router.replace("/platform");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Login Super Admin gagal.");
    } finally { setBusy(false); }
  }

  return (
    <main className="platform-login">
      <section className="login-card">
        <p className="eyebrow">AKVISIO · PLATFORM OPERATIONS</p>
        <h1>Super Admin</h1>
        <p className="intro">Masuk ke ruang pengelolaan platform. Akun ini terpisah dari akun tenant dan tidak memberikan akses otomatis ke sistem tenant lain.</p>
        {error && <p className="error" role="alert">{error}</p>}
        <form onSubmit={(event) => void submit(event)}>
          <label>Email administrator<input type="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} required maxLength={254} /></label>
          <label>Kata sandi<input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required maxLength={256} /></label>
          <button type="submit" disabled={busy}>{busy ? "Memverifikasi…" : "Masuk ke platform"}</button>
        </form>
        <p className="security-note">Login memerlukan migrasi platform billing dan secret server yang sudah dikonfigurasi. Pembuatan administrator pertama dilakukan melalui proses bootstrap satu kali yang dilindungi secret terpisah.</p>
      </section>
      <style jsx>{`
        .platform-login{min-height:100vh;display:grid;place-items:center;padding:24px;background:radial-gradient(circle at 20% 0%,#e8f2eb 0,transparent 42%),#f7f8f6;color:#17241c}.login-card{width:min(100%,440px);padding:30px;background:#fff;border:1px solid #dce5de;border-radius:18px;box-shadow:0 20px 70px #1d382012}.eyebrow{font-size:10px;letter-spacing:1.5px;font-weight:800;color:#2d7651}.login-card h1{font-size:29px;letter-spacing:-.8px;margin:8px 0}.intro{font-size:12px;line-height:1.7;color:#617067;margin:0 0 22px}.login-card form{display:grid;gap:14px}.login-card label{display:grid;gap:6px;font-size:11px;font-weight:700}.login-card input{padding:12px;border:1px solid #d8e1da;border-radius:9px;font:inherit;font-size:13px;background:#fff;color:#17241c}.login-card button{border:0;border-radius:9px;padding:12px;background:#246847;color:white;font-weight:700;cursor:pointer}.login-card button:disabled{opacity:.6;cursor:wait}.error{background:#fff0ef;color:#a42b25;padding:10px;border-radius:8px;font-size:12px}.security-note{margin:18px 0 0;font-size:10px;line-height:1.6;color:#6a786f}
      `}</style>
    </main>
  );
}
