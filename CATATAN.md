# Perbaikan hasil audit — ujian-exam2026

Dasar: repo cabang `main`, commit `977a81b`. Struktur folder zip ini SAMA dengan repo,
jadi tinggal salin-timpa. Ada juga `perbaikan-audit.patch` (bisa dipakai `git apply`).

PENTING: berkas di sini adalah versi LENGKAP dari commit 977a81b. Jika di repo Anda
ada perubahan setelah commit itu pada berkas yang sama, JANGAN timpa buta — pakai
patch (`git apply --3way perbaikan-audit.patch`) atau bandingkan dulu dengan `git diff`.

## Berkas (8 diubah, 2 baru)
BARU    src/lib/device-id.ts            getDeviceId() dipindah dari page.tsx (kunci localStorage sama)
BARU    src/lib/device-guard.ts         cekDeviceSiswa() + saklar DEVICE_LOCK_STRICT
UBAH    src/app/api/siswa/ujian/pelanggaran/route.ts        cek perangkat sebelum RPC
UBAH    src/app/api/siswa/ujian/verifikasi-reset/route.ts   cek perangkat sebelum membuka/ubah status
UBAH    src/lib/pelanggaran-outbox.ts   kirim deviceId (diambil saat kirim)
UBAH    src/lib/reset-offline-client.ts kirim deviceId (diambil saat kirim)
UBAH    src/app/siswa/ujian/page.tsx    impor getDeviceId dari lib + kirim deviceId di 2 panggilan verifikasi-reset
UBAH    src/lib/ujian-outbox.ts         cadangan gagal dibaca != cadangan kosong; finalisasi dihentikan
UBAH    next.config.js                  + HSTS, + Permissions-Policy
UBAH    README.md                       bagian yang usang diperbarui sesuai kode

## Urutan rilis yang disarankan
1. Deploy kode ini (tanpa env baru). Perangkat dengan client lama tetap berfungsi:
   request tanpa deviceId diloloskan + peringatan di log Vercel
   ("[device-guard] ... request tanpa deviceId"). deviceId yang BERBEDA langsung ditolak.
2. Build & bagikan APK/PWA baru ke semua perangkat siswa.
3. Setelah log peringatan di atas berhenti muncul, set env `DEVICE_LOCK_STRICT=true`
   di Vercel lalu redeploy -> request tanpa deviceId ikut ditolak.

## Perilaku baru
- pelanggaran: perangkat berbeda -> HTTP 409 (antrean klien menandai GAGAL, tidak diulang).
- verifikasi-reset: perangkat berbeda -> {valid:false, permanen:true, message}.
- Baris siswa_ujian tanpa device_id (data lama) tetap lolos (tidak ada yang dibandingkan).
- ujian-outbox: cadangan localStorage ada tapi rusak/tak terbaca -> paket berstatus GAGAL
  dengan pesan "hubungi pengawas" (tidak lagi lanjut ke /selesai). Cadangan kosong = aman.
- Tidak ada migrasi database baru.

## Pengujian yang sudah dijalankan
- npm ci && npx tsc --noEmit  -> lulus tanpa error
- npx next build (env dummy)  -> sukses
- next start + curl -I /login -> header HSTS & Permissions-Policy terkirim, CSP/XFO lama tetap ada
- Uji logika cekDeviceSiswa (13 kasus) dan bacaBackupJawabanLokal (8 kasus) -> lulus
BELUM diuji: alur ujian nyata di browser/APK, database produksi, beban serentak.
Mohon uji dengan 2 perangkat/tab: (a) kirim pelanggaran dari perangkat kedua -> harus ditolak,
(b) masukkan kode reset dari perangkat kedua -> harus ditolak, (c) alur normal 1 perangkat tidak terganggu.

## Sengaja TIDAK diubah
- eventId tetap opsional di server (client selalu mengirimnya; wajibkan setelah client lama hilang).
- Mode tanpa deviceId default tidak ketat demi keamanan rollout APK lama (lihat urutan rilis).
