# AKVISIO Autohost

**AI Host untuk layanan pelanggan dan operasi bisnis melalui percakapan.** AKVISIO Autohost dirancang sebagai SaaS multi-tenant: setiap usaha memiliki data, aturan, knowledge base, kanal, dan pengguna sendiri. Sans Rent Cars adalah tenant awal/pilot, bukan nama produk.

## Status yang perlu diketahui

Repositori ini masih dalam pengembangan. Fondasi yang tersedia meliputi autentikasi/session, data pelanggan dan armada, booking, inbox percakapan WhatsApp, ingestion webhook, balasan manual staf, serta API keuangan dasar dengan pembatasan tenant dan audit.

**AI Host belum boleh dianggap aktif/live.** Pipeline webhook saat ini menyimpan event dan pesan; balasan AI otomatis belum diaktifkan. Fitur paket langganan SaaS, tagihan aktivasi, penagihan berulang, komisi transaksi, dan Super Admin masih dalam pengerjaan. Integrasi WhatsApp outbound tetap fail-closed sampai konfigurasi, persetujuan, dan uji resmi tersedia.

## Arah produk

- **AI Host 24/7:** menjawab hanya berdasarkan knowledge base tenant dan data yang dikembalikan oleh tool bisnis yang diizinkan.
- **Asisten booking:** mengumpulkan kebutuhan pelanggan, meminta data yang belum ada, memeriksa ketersediaan/harga dari data resmi, lalu membuat permintaan booking secara aman. Tidak boleh mengarang ketersediaan atau mengonfirmasi booking tanpa transaksi database yang sah.
- **Inbox bersama:** staf dapat mengambil alih percakapan; selama handoff aktif AI tidak membalas otomatis.
- **CRM operasional:** pelanggan, kendaraan, booking, invoice, pembayaran, biaya, dan laporan.
- **SaaS Super Admin:** tenant, paket, aktivasi, langganan, invoice, pembayaran terverifikasi, komisi, batas penggunaan, status akun, dan audit.
- **Multi-tenant by design:** semua akses data tenant harus diverifikasi server-side dan dites untuk mencegah kebocoran lintas tenant.

## Stack

- Next.js + TypeScript
- Neon PostgreSQL
- GitHub Actions untuk CI
- WhatsApp Business Platform Cloud API resmi (outbound tetap nonaktif secara default)
- Provider AI yang dapat dikonfigurasi melalui environment; tidak ada secret di repository

## Pengembangan lokal

1. Gunakan Node.js 22 atau lebih baru.
2. Salin `.env.example` ke `.env.local`.
3. Isi koneksi database **development**, secret session, dan konfigurasi lokal yang dibutuhkan.
4. Jalankan `npm install`, lalu `npm run dev`.
5. Jalankan `npm test`, `npm run typecheck`, dan `npm run lint` sebelum mengirim perubahan.

## Database dan rilis

- Terapkan migrasi baru terlebih dahulu ke branch Neon development dan verifikasi hasilnya.
- Jangan menjalankan migrasi terhadap branch production tanpa persetujuan eksplisit.
- Jangan memasukkan kredensial, token WhatsApp, data identitas pelanggan, atau data pembayaran sensitif ke Git.
- Perubahan yang belum lolos CI tidak boleh dianggap siap rilis.

## Prinsip keselamatan bisnis

- Ketersediaan armada dan pembuatan booking harus divalidasi secara transaksional di PostgreSQL.
- Pembayaran hanya dianggap terverifikasi melalui callback provider tepercaya atau konfirmasi staf yang berwenang; chat/screenshot pelanggan bukan bukti final.
- AI hanya boleh menggunakan tool yang di-allowlist; model tidak boleh membuat SQL arbitrer atau mengubah status finansial secara langsung.
- Handoff manusia, deduplikasi pesan, idempotensi, audit, batas biaya/pemakaian, dan penanganan kegagalan merupakan persyaratan produk.
- Outbound WhatsApp harus tetap mati bila credential, nomor resmi, jendela pesan, allowlist uji, atau feature flag tidak memenuhi aturan.
