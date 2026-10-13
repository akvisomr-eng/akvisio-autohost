"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";

type Customer = { id: string; full_name: string | null; whatsapp_number: string };
type Vehicle = { id: string; registration_number: string; make: string; model: string; service_mode: string; status: string; daily_rate: string | number };
type Booking = {
  id: string; booking_code: string; customer_id: string; vehicle_id: string; service_mode: string;
  pickup_at: string; return_at: string; pickup_location: string | null; return_location: string | null;
  status: string; daily_rate: string | number; estimated_total: string | number; deposit_amount: string | number;
  payment_status: string; customer_name: string | null; whatsapp_number: string | null;
  registration_number: string; make: string; model: string;
};

async function errorText(response: Response) {
  const body = await response.json().catch(() => ({})) as { error?: string };
  return body.error || "Permintaan tidak berhasil. Coba kembali.";
}
function localDateTime(date: Date) {
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}
function idr(value: string | number) {
  return Number(value).toLocaleString("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 });
}
function dateLabel(value: string) {
  return new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}
function statusLabel(status: string) {
  const labels: Record<string, string> = { pending: "Menunggu", held: "Ditahan", confirmed: "Dikonfirmasi", ongoing: "Berjalan", completed: "Selesai", cancelled: "Dibatalkan", rejected: "Ditolak", expired: "Kedaluwarsa" };
  return labels[status] || status;
}

export default function BookingWorkspace() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [customerId, setCustomerId] = useState("");
  const [vehicleId, setVehicleId] = useState("");
  const [serviceMode, setServiceMode] = useState("self_drive");
  const [pickupAt, setPickupAt] = useState(() => localDateTime(new Date(Date.now() + 60 * 60 * 1000)));
  const [returnAt, setReturnAt] = useState(() => localDateTime(new Date(Date.now() + 25 * 60 * 60 * 1000)));
  const [pickupLocation, setPickupLocation] = useState("");
  const [returnLocation, setReturnLocation] = useState("");
  const [depositAmount, setDepositAmount] = useState("0");
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [customerRes, vehicleRes, bookingRes] = await Promise.all([
        fetch("/api/customers", { cache: "no-store" }),
        fetch("/api/vehicles", { cache: "no-store" }),
        fetch("/api/bookings", { cache: "no-store" }),
      ]);
      if (!customerRes.ok || !vehicleRes.ok || !bookingRes.ok) {
        throw new Error(!customerRes.ok ? await errorText(customerRes) : !vehicleRes.ok ? await errorText(vehicleRes) : await errorText(bookingRes));
      }
      const customerData = await customerRes.json() as { data: Customer[] };
      const vehicleData = await vehicleRes.json() as { data: Vehicle[] };
      const bookingData = await bookingRes.json() as { data: Booking[] };
      setCustomers(customerData.data);
      setVehicles(vehicleData.data);
      setBookings(bookingData.data);
      if (!customerId && customerData.data[0]) setCustomerId(customerData.data[0].id);
      const available = vehicleData.data.filter((v) => v.status === "available");
      if (!vehicleId && available[0]) {
        setVehicleId(available[0].id);
        setServiceMode(available[0].service_mode === "chauffeur" ? "chauffeur" : "self_drive");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Data pemesanan tidak dapat dimuat.");
    } finally {
      setLoading(false);
    }
  }, [customerId, vehicleId]);

  useEffect(() => { void load(); }, [load]);

  const selectedVehicle = vehicles.find((v) => v.id === vehicleId);
  const rentalDays = Math.max(1, Math.ceil((new Date(returnAt).getTime() - new Date(pickupAt).getTime()) / 86400000));
  const estimatedTotal = selectedVehicle ? Math.max(0, Number(selectedVehicle.daily_rate) * rentalDays) : 0;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(""); setMessage(""); setSaving(true);
    try {
      const response = await fetch("/api/bookings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerId, vehicleId, serviceMode,
          pickupAt: new Date(pickupAt).toISOString(),
          returnAt: new Date(returnAt).toISOString(),
          pickupLocation, returnLocation, depositAmount, notes,
          idempotencyKey: crypto.randomUUID(),
        }),
      });
      if (!response.ok) throw new Error(await errorText(response));
      const result = await response.json() as { data: { booking_code: string } };
      setMessage("Pemesanan " + result.data.booking_code + " berhasil dicatat. Status awal: menunggu.");
      setPickupLocation(""); setReturnLocation(""); setNotes(""); setDepositAmount("0");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Pemesanan gagal disimpan.");
    } finally {
      setSaving(false);
    }
  }

  return <div className="booking-workspace">
    <div className="booking-intro"><div><p className="eyebrow">BOOKING OPERATIONS</p><h2>Pemesanan dan jadwal rental</h2><p>Tarif dihitung oleh server berdasarkan tarif armada dan durasi sewa. Jadwal kendaraan yang bertabrakan akan ditolak oleh database.</p></div><button className="secondary-button" type="button" onClick={() => void load()}>↻ Muat ulang</button></div>
    {(error || message) && <p className={error ? "alert error" : "alert success"}>{error || message}</p>}
    <div className="booking-layout">
      <section className="panel booking-form-panel">
        <div className="panel-heading"><div><p className="eyebrow">PEMESANAN BARU</p><h2>Data sewa</h2></div><span className="booking-step">01</span></div>
        {customers.length === 0 || vehicles.filter((v) => v.status === "available").length === 0 ? <div className="empty-state">{customers.length === 0 ? "Tambahkan data pelanggan terlebih dahulu." : "Belum ada kendaraan berstatus tersedia. Tambahkan atau perbarui data armada terlebih dahulu."}</div> : <form className="data-form" onSubmit={submit}>
          <label>Pelanggan<select required value={customerId} onChange={(e) => setCustomerId(e.target.value)}><option value="">Pilih pelanggan</option>{customers.map((c) => <option key={c.id} value={c.id}>{c.full_name || c.whatsapp_number} · {c.whatsapp_number}</option>)}</select></label>
          <label>Kendaraan<select required value={vehicleId} onChange={(e) => { setVehicleId(e.target.value); const v = vehicles.find((x) => x.id === e.target.value); if (v?.service_mode === "chauffeur") setServiceMode("chauffeur"); else setServiceMode("self_drive"); }}><option value="">Pilih kendaraan</option>{vehicles.filter((v) => v.status === "available").map((v) => <option key={v.id} value={v.id}>{v.registration_number} — {v.make} {v.model} · {idr(v.daily_rate)}/hari</option>)}</select></label>
          <label>Jenis layanan<select value={serviceMode} onChange={(e) => setServiceMode(e.target.value)}><option value="self_drive" disabled={selectedVehicle?.service_mode === "chauffeur"}>Lepas kunci</option><option value="chauffeur" disabled={selectedVehicle?.service_mode === "self_drive"}>Dengan sopir</option></select></label>
          <div className="field-row"><label>Waktu pengambilan<input type="datetime-local" value={pickupAt} onChange={(e) => setPickupAt(e.target.value)} required /></label><label>Waktu pengembalian<input type="datetime-local" value={returnAt} onChange={(e) => setReturnAt(e.target.value)} min={pickupAt} required /></label></div>
          <div className="field-row"><label>Lokasi pengambilan<input value={pickupLocation} onChange={(e) => setPickupLocation(e.target.value)} maxLength={250} placeholder="Bandara / alamat" /></label><label>Lokasi pengembalian<input value={returnLocation} onChange={(e) => setReturnLocation(e.target.value)} maxLength={250} placeholder="Lokasi pengembalian" /></label></div>
          <label>Deposit yang disepakati (Rp)<input type="number" min="0" max="1000000000" step="1000" value={depositAmount} onChange={(e) => setDepositAmount(e.target.value)} required /></label>
          <label>Catatan internal (opsional)<textarea value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={2000} rows={3} placeholder="Kebutuhan pelanggan, instruksi serah-terima…" /></label>
          <div className="booking-estimate"><div><span>Estimasi durasi</span><strong>{rentalDays} hari</strong></div><div><span>Estimasi biaya sewa</span><strong>{idr(estimatedTotal)}</strong></div><small>Estimasi, bukan bukti pembayaran. Deposit dan status pembayaran dicatat terpisah.</small></div>
          <button className="primary-button" type="submit" disabled={saving || !customerId || !vehicleId || new Date(returnAt) <= new Date(pickupAt)}>{saving ? "Menyimpan…" : "Buat pemesanan"}</button>
        </form>}
      </section>
      <section className="panel booking-list-panel"><div className="panel-heading"><div><p className="eyebrow">RENTAL SCHEDULE</p><h2>Pemesanan terbaru <span className="count-bubble">{bookings.length}</span></h2></div></div>
        {loading ? <p className="empty-state">Memuat data pemesanan…</p> : bookings.length === 0 ? <p className="empty-state">Belum ada pemesanan. Data baru akan tampil setelah tersimpan.</p> : <div className="booking-list">{bookings.map((b) => <article className="booking-card" key={b.id}><div className="booking-card-top"><strong>{b.booking_code}</strong><span className={"status-pill status-" + b.status}>{statusLabel(b.status)}</span></div><h3>{b.make} {b.model} <small>· {b.registration_number}</small></h3><p className="booking-customer">{b.customer_name || b.whatsapp_number || "Pelanggan"} {b.whatsapp_number ? "· " + b.whatsapp_number : ""}</p><div className="booking-dates"><div><small>PENGAMBILAN</small><strong>{dateLabel(b.pickup_at)}</strong><span>{b.pickup_location || "Lokasi belum ditentukan"}</span></div><div><small>PENGEMBALIAN</small><strong>{dateLabel(b.return_at)}</strong><span>{b.return_location || "Lokasi belum ditentukan"}</span></div></div><div className="booking-card-bottom"><span>{b.service_mode === "chauffeur" ? "Dengan sopir" : "Lepas kunci"} · Pembayaran {b.payment_status === "unpaid" ? "belum dibayar" : b.payment_status}</span><strong>{idr(b.estimated_total)}</strong></div></article>)}</div>}
      </section>
    </div>
    <style>{bookingStyles}</style>
  </div>;
}

const bookingStyles = `
.booking-workspace{display:grid;gap:18px}.booking-intro{display:flex;justify-content:space-between;align-items:flex-start;gap:16px}.booking-intro h2{font-size:22px;margin:0 0 8px;letter-spacing:-.6px}.booking-intro p:not(.eyebrow){font-size:12px;line-height:1.7;color:var(--muted);max-width:760px;margin:0}.booking-layout{display:grid;grid-template-columns:minmax(320px,.88fr) minmax(0,1.12fr);gap:16px;align-items:start}.booking-form-panel,.booking-list-panel{min-width:0}.booking-step,.count-bubble{display:inline-grid;place-items:center;border-radius:8px;background:#e7f4ed;color:#176b4d;font-size:11px;font-weight:800;min-width:27px;height:27px;padding:0 7px}.booking-form-panel .panel-heading,.booking-list-panel .panel-heading{align-items:center}.booking-form-panel .data-form select,.booking-form-panel .data-form textarea{width:100%;min-width:0;padding:12px 13px;border:1px solid #dce4de;border-radius:10px;background:#fff;color:var(--ink);outline:none}.booking-estimate{background:#f3f8f4;border:1px solid #dfece3;border-radius:12px;padding:14px;display:grid;grid-template-columns:1fr 1fr;gap:12px}.booking-estimate div span,.booking-estimate div strong{display:block}.booking-estimate div span{font-size:10px;color:var(--muted);margin-bottom:6px}.booking-estimate div strong{font-size:15px}.booking-estimate small{grid-column:1/-1;font-size:10px;color:var(--muted);line-height:1.6}.booking-list{display:grid;gap:12px}.booking-card{border:1px solid var(--line);border-radius:13px;padding:15px;min-width:0}.booking-card-top,.booking-card-bottom{display:flex;justify-content:space-between;align-items:center;gap:12px}.booking-card-top>strong{font-size:11px;letter-spacing:.5px}.booking-card h3{font-size:16px;margin:13px 0 5px}.booking-card h3 small{font-size:11px;color:var(--muted);font-weight:500}.booking-customer{font-size:11px;color:var(--muted);margin:0 0 14px}.booking-dates{display:grid;grid-template-columns:1fr 1fr;gap:12px;padding:13px 0;border-top:1px solid var(--line);border-bottom:1px solid var(--line)}.booking-dates div>*{display:block}.booking-dates small{font-size:9px;letter-spacing:1px;color:var(--muted);margin-bottom:6px}.booking-dates strong{font-size:11px;line-height:1.5}.booking-dates span{font-size:10px;color:var(--muted);margin-top:5px;line-height:1.5}.booking-card-bottom{padding-top:12px}.booking-card-bottom span{font-size:10px;color:var(--muted);line-height:1.5}.booking-card-bottom strong{font-size:13px;white-space:nowrap}.status-pending,.status-held{background:#fff3d8;color:#8a5a00}.status-confirmed{background:#e7f4ed;color:#176b4d}.status-ongoing{background:#e8f1ff;color:#235b9c}.status-completed{background:#edf0ee;color:#4b5c51}.status-cancelled,.status-rejected,.status-expired{background:#fff0ee;color:#9d3025}
@media(max-width:1150px){.booking-layout{grid-template-columns:1fr}}@media(max-width:620px){.booking-intro{flex-direction:column}.booking-dates{grid-template-columns:1fr}.booking-card-bottom{align-items:flex-start;flex-direction:column}.booking-estimate{grid-template-columns:1fr 1fr}}
`;
