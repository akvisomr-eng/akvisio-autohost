# WhatsApp Cloud API — rencana integrasi

## Status
Belum terhubung ke nomor live. Nomor yang direncanakan untuk Sans Rent Cars: +62 815-8687-8487.

## Prasyarat
1. Akses administrator yang sah ke Meta Business Portfolio dan WhatsApp Business Account.
2. Nomor dan akun yang memenuhi syarat; evaluasi migrasi atau coexistence sebelum mengubah aplikasi WhatsApp Business yang sedang digunakan.
3. Cloud API access token, phone number ID, WABA ID, verify token, dan app secret disimpan sebagai environment secrets.
4. URL HTTPS publik untuk webhook. GitHub Pages tidak dapat menjalankan endpoint webhook Next.js.
5. Pengujian webhook challenge, signature verification, idempotency, delivery status, retry, dan human handoff.

## Aturan keamanan
- Jangan commit token atau connection string.
- Verifikasi signature webhook menggunakan app secret.
- Simpan event masuk secara idempoten sebelum memprosesnya.
- Jangan menandai pembayaran sebagai lunas berdasarkan teks atau screenshot saja.
- Follow-up pemasaran harus menghormati consent dan kebijakan WhatsApp.
- Batasi log agar tidak menyimpan dokumen identitas atau data pribadi berlebihan.

## Urutan go-live
1. Test menggunakan nomor uji dan data dummy.
2. Uji inbound, outbound, template, dan status delivery.
3. Uji duplikasi webhook dan pemulihan kegagalan.
4. Uji handoff ke operator.
5. Persetujuan pemilik bisnis sebelum mengaktifkan nomor produksi.
