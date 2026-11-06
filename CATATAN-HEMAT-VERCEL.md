# Perbaikan hemat Vercel (7 Nov 2026)

Tujuan: mengurangi jumlah invocation dan CPU fungsi Vercel saat banyak siswa ujian
serentak. Logika ujian, penilaian, anti-curang, dan format data TIDAK diubah.
Tidak perlu migrasi SQL. `npx tsc --noEmit` lulus.

| File | Perubahan |
|---|---|
| `src/lib/status-jaringan.ts` | Denyut `/api/siswa/ujian/health` dari 5 dtk menjadi 20 dtk, dan dilewati bila ada request lain yang baru berhasil (<15 dtk). Saat ada kegagalan, denyut tetap rapat 3 dtk seperti sebelumnya. |
| `src/lib/clock-offset.ts` | Tambah pencatat "kontak server terakhir" (`catatKontakServer`). |
| `src/lib/utils.ts` | `apiRequest` mencatat kontak server saat response < 500. |
| `src/app/siswa/ujian/page.tsx` | Polling `cek-sesi` 10 dtk menjadi 20 dtk. Autosync 30 dtk dilewati bila jawaban tidak berubah sejak sync berhasil terakhir (tetap dipaksa tiap 3 menit). Sync cepat setelah klik, sync saat submit, dan retry tidak berubah. |
| `src/app/guru/jadwal-pengawasan/tabs/ModePengawasTab.tsx` | Polling pelanggaran 1,5 dtk menjadi 3 dtk, polling roster 8 dtk menjadi 12 dtk. Ambang pop-up "siswa terputus" 30 dtk menjadi 45 dtk (menyesuaikan heartbeat ~20 dtk agar tidak salah alarm). |
| `vercel.json` | `"regions": ["sin1"]` (Singapura, sama dengan region Supabase). |

## Perkiraan dampak (per siswa di halaman ujian)
Sebelum: sekitar 20 panggilan/menit (health 12 + cek-sesi 6 + sync 2).
Sesudah: sekitar 4-6 panggilan/menit. Sync (yang paling berat di CPU/database) turun
terbesar karena tidak dikirim ulang bila tidak ada perubahan.

## Perubahan perilaku yang perlu diketahui
- Siswa tahu sesi ditutup/dikunci/di-reset pengawas paling lambat ~20 dtk (dulu ~10 dtk).
- Heartbeat siswa tertulis tiap ~20 dtk (dulu ~10 dtk). Label "tanpa sinyal" 60 dtk tetap.
- Notifikasi pelanggaran di layar pengawas bisa terlambat sampai 3 dtk (dulu 1,5 dtk).
- Putus jaringan tetap terdeteksi cepat: event `offline` browser langsung, atau 1 denyut gagal lalu denyut 3 dtk.

## Region fungsi (penting)
Cek di Vercel: Project > Settings > Functions > Function Region.
Kalau sebelumnya Washington (iad1), setiap query ke Supabase Singapura menempuh
perjalanan jauh dan fungsi berjalan lebih lama. Dengan `sin1`, fungsi dekat database.
Setelah deploy, pastikan region di Settings menunjukkan Singapore (sin1).

## Cara memverifikasi setelah deploy
1. Buka Vercel > Usage, catat Function Invocations dan Fluid Active CPU.
2. Uji dengan 30-50 siswa/guru mengerjakan ujian selama 10 menit.
3. Bandingkan kenaikan angka. Target: kira-kira 4-6 invocation per siswa per menit.
