# Autentikasi Admin dan Setup Awal

## Environment variables

Konfigurasikan variabel berikut di lingkungan server, bukan di GitHub:

- `DATABASE_URL`: koneksi PostgreSQL Neon ke branch yang dituju.
- `SESSION_SECRET`: nilai acak rahasia minimal 32 karakter; gunakan nilai unik per lingkungan.
- `BOOTSTRAP_SECRET`: nilai acak rahasia minimal 24 karakter untuk pembuatan admin pertama kali.

Jangan gunakan contoh atau nilai yang sama antar lingkungan. Jangan membagikan nilai rahasia melalui chat, screenshot, issue, atau commit.

## Menjalankan migrasi

Terapkan migrasi secara berurutan pada branch development:

1. `database/migrations/001_initial_schema.sql`
2. `database/migrations/002_booking_safety_ai_foundations.sql`
3. `database/migrations/003_admin_auth.sql`

Verifikasi bahwa kolom `users.password_hash` dan `users.last_login_at` tersedia sebelum menguji login. Jangan menerapkan migrasi ke production sebelum CI, pengujian, dan rencana promosi ditinjau.

## Membuat administrator pertama

Setelah aplikasi terhubung ke database development dan kedua secret dikonfigurasi, kirim satu permintaan HTTPS ke `POST /api/auth/bootstrap` dengan JSON:

```json
{
  "secret": "<BOOTSTRAP_SECRET>",
  "email": "admin@example.com",
  "fullName": "Administrator Sans Rent Cars",
  "password": "<kata sandi acak minimal 12 karakter>"
}
```

Endpoint ini hanya dapat membuat akun owner awal apabila belum ada akun owner/admin. Gunakan hanya sekali, simpan kata sandi di pengelola kredensial yang aman, lalu hapus/nonaktifkan `BOOTSTRAP_SECRET` dari lingkungan deployment setelah akun dibuat. Jangan masukkan secret atau kata sandi nyata ke dokumentasi atau terminal yang direkam.

## API yang tersedia

- `POST /api/auth/login`: autentikasi admin dan menerbitkan cookie sesi HTTP-only.
- `POST /api/auth/logout`: menghapus cookie sesi.
- `GET /api/auth/session`: memeriksa sesi aktif.
- `GET/POST /api/customers`: daftar dan tambah pelanggan untuk organisasi sesi.
- `GET/POST /api/vehicles`: daftar dan tambah kendaraan untuk organisasi sesi.

Sesi ditandatangani HMAC dan berlaku hingga 12 jam. Status akun dan peran diverifikasi ulang dari database untuk setiap permintaan terautentikasi. Password disimpan sebagai hash scrypt, bukan teks biasa. Akses data dibatasi menggunakan `organization_id` dari sesi server; klien tidak dapat memilih organisasi lewat request body.

## Batasan sebelum produksi

- Tambahkan pembatasan percobaan login dan pemantauan percobaan gagal sebelum paparan internet luas.
- Atur rotasi `SESSION_SECRET` dengan rencana invalidasi sesi.
- Jalankan pemeriksaan keamanan, pengujian end-to-end, dan uji pemulihan.
- Jangan aktifkan endpoint bootstrap di lingkungan publik tanpa secret kuat; hapus secret setelah bootstrap selesai.
- Integrasi WhatsApp dan AI belum otomatis aktif hanya karena autentikasi berhasil.
