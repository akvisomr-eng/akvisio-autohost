# Pemesanan dan Jadwal Rental

## Fungsi yang tersedia

- Daftar pemesanan terisolasi per organisasi.
- Pembuatan booking menggunakan pelanggan dan kendaraan milik organisasi yang sama.
- Tarif harian diambil dari database server; klien tidak dapat menentukan harga.
- Durasi sewa dibulatkan ke hari penuh dengan minimum satu hari.
- Kunci idempotensi untuk mencegah duplikasi ketika permintaan diulang.
- Kendala exclusion PostgreSQL menolak jadwal kendaraan yang bertumpang tindih.
- Transisi status terbatas dan dicatat ke audit log.
- Pembatalan melepaskan kendaraan dari kendala bentrok selama status bukan lagi pending/held/confirmed/ongoing.

## Status dan transisi

- `pending` → `held`, `confirmed`, `cancelled`, `rejected`, `expired`
- `held` → `confirmed`, `cancelled`, `rejected`, `expired`
- `confirmed` → `ongoing`, `cancelled`
- `ongoing` → `completed`

Akun staf hanya dapat membatalkan pemesanan. Pemilik/admin/manajer dapat menjalankan transisi lain yang tercantum. Transisi status final tidak dibuka kembali melalui API ini.

## Tarif dan pembayaran

Total yang ditampilkan merupakan estimasi biaya sewa berdasarkan tarif harian × jumlah hari yang dibulatkan ke atas. Deposit dicatat terpisah. Membuat atau mengonfirmasi booking tidak mengubah status pembayaran menjadi lunas. Verifikasi pembayaran merupakan pekerjaan modul keuangan berikutnya.

## Database

Migrasi `004_booking_tenant_integrity.sql` menambahkan foreign key komposit sehingga booking tidak dapat mereferensikan pelanggan atau kendaraan dari organisasi lain, bahkan jika suatu jalur API kelak salah menerapkan filter tenant. Migrasi telah diterapkan ke branch Neon development `br-gentle-mouse-b43pko6a`.

## Belum termasuk

- Sinkronisasi Google/Outlook Calendar.
- Pembaruan status otomatis dari pembayaran.
- Penandatanganan kontrak dan serah-terima kendaraan.
- Integrasi WhatsApp Cloud API.
- Pengujian dengan data operasional riil dan deployment publik.
