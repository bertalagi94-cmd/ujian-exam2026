# Perbaikan pasca simulasi 12 November 2026

Basis: commit `90e77fd` (repo `bertalagi94-cmd/ujian-exam2026`). Semua file di zip
memakai path relatif dari akar repo; ekstrak dan timpa langsung.

## File yang berubah

| File | Perubahan |
|---|---|
| `src/app/siswa/ujian/page.tsx` | TAB_SWITCH + WINDOW_BLUR digabung, dilapor hanya bila siswa hilang >= `AMBANG_PELANGGARAN_MS` (3000). Detail pelanggaran memuat konteks (APK/WEB, lock, model HP). Kirim `device_info` sekali per tab (jeda acak 5-45 dtk). |
| `src/app/api/siswa/device-info/route.ts` | BARU. Mengisi `siswa.device_info`. |
| `src/app/api/siswa/ujian/pelanggaran/route.ts` | `maxDuration = 15`; menyimpan waktu kejadian asli di akhir `detail` (`| kejadian=ISO tunda=Ns`). |
| `src/lib/pelanggaran-outbox.ts` | Mengirim `waktuKejadian` (= `dibuatIso`). |
| `src/app/api/guru/mode-pengawas/route.ts` | `maxDuration = 20` (GET polling + POST buka sesi). |
| `src/app/api/guru/mode-pengawas/tutup/route.ts` | Catat `TUTUP_SESI` dan `TUTUP_SESI_RINCIAN` di `log_aktivitas`. |
| `src/app/api/admin/sesi/[id]/tutup-paksa/route.ts` | Sama seperti di atas. |
| `src/app/guru/jadwal-pengawasan/tabs/ModePengawasTab.tsx` | Dialog "Tutup Sesi" menampilkan siswa RESET. |
| `docs/DIAGNOSIS-SIMULASI-2026-11-12.sql` | BARU. Query diagnosis (A-F, plus G-H untuk data baru). |

Tidak ada migrasi SQL.

## Langkah manual setelah deploy

1. Vercel: set `SUPABASE_FETCH_TIMEOUT_MS=10000`, lalu redeploy. Default di kode sengaja
   tetap 30000 karena route backup/restore/impor (maxDuration 60) memakai klien yang sama.
   Setelah itu UJI backup dan restore.
2. Putuskan ambang pelanggaran. 3 detik adalah usulan, bukan fakta. Ubah
   `AMBANG_PELANGGARAN_MS` di `page.tsx`; 0 = perilaku lama (lapor seketika).
3. Perubahan web berlaku tanpa build ulang APK. Pastikan `sw.js` tidak menahan JS lama
   di HP siswa (pertanyaan terbuka di dokumen simulasi).

## Yang perlu diketahui

- Ambang tidak menyelesaikan layar mati: layar mati > 3 detik tetap dihitung TAB_SWITCH.
  Pembedaannya butuh event `ACTION_SCREEN_OFF` di plugin native (APK baru, opsional).
- EXIT_FULLSCREEN dan LOCK_RELEASED tidak memakai ambang.
- Pengawas yang menutup sesi kini melihat siswa RESET, tetapi mereka tetap dinilai dari
  jawaban yang ada di server saat sesi ditutup.

## Koreksi terhadap dokumen simulasi (dari pembacaan kode)

- Polling `cek-sesi` = 60 detik (`JEDA_CEK_SESI_MS`, "mode hemat darurat 9 Nov 2026"),
  bukan 10 detik. Heartbeat ditulis di setiap `cek-sesi` DAN setiap `sync`; sync cepat
  berjalan setelah tiap jawaban. Kandidat beban ada di situ, belum terbukti.
- Timeout klien (`apiRequest`) 10 dtk, timeout Supabase server 30 dtk: server tetap
  bekerja ~20 dtk setelah klien menyerah, sementara outbox mengirim ulang.
- Login sudah punya timeout query 10 dtk dan antrean sendiri.
- Siswa masuk lewat kode sesi dari pengawas; pesan "Kode sesi tidak ditemukan" sudah ada.
  41 siswa tanpa sesi adalah masalah prosedur (buat semua sesi sebelum siswa login).

## Sengaja TIDAK diubah (belum ada bukti)

- Fungsi RPC (`FOR SHARE`/`FOR UPDATE`, `lock_timeout`). Jalankan query E dan F saat
  beban puncak di simulasi berikutnya dulu.
- Heartbeat per sync, dan GET mode-pengawas yang membaca semua baris `siswa_ujian`
  tiap polling. Keduanya kandidat, tunggu data.
- Proyek Android (tidak ada di repo ini).

## Keamanan

- Repo ini tidak berisi `.jks`, `PANDUAN.md` atau `ExamLockPlugin.java`.
- Riwayat git (2114 commit): tidak ada `.env`, keystore, atau `.pem` yang pernah tercatat.
  Pencarian pola kunci JWT hanya dijalankan pada 20 revisi terbaru.
- Keystore Android di proyek terpisah: jangan pernah masuk repo publik.
