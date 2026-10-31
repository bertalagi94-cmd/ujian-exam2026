# Perbaikan hasil audit essay, kode darurat, dan kunci permanen

Basis: commit `76d3a4b`. ZIP ini berisi berkas yang berubah saja, dengan struktur
folder yang sama dengan repo — cukup disalin menimpa repo (ekstrak di akar repo).

## Urutan penerapan
1. **Di luar jam ujian.** Kunci amplop essay diturunkan dari kode darurat, dan kode
   berubah dari 6 angka menjadi 7 karakter. Sesi yang sudah berjalan dengan amplop
   lama tidak bisa dibuka dengan kode baru.
2. Jalankan `supabase/53_perbaikan_audit_essay_dan_kunci.sql` di SQL Editor Supabase
   (aman diulang). Pesan NOTICE "diperbarui memakai IS DISTINCT FROM" untuk dua
   fungsi finalisasi berarti berhasil.
3. Deploy kode. Kalau kode lebih dulu tayang daripada migrasi: koreksi essay dan kunci
   permanen tetap jalan seperti lama, dan pengembalian hitungan percobaan dilewati
   dengan peringatan di log (fail-safe).

## Isi per temuan
| # | Temuan | Perbaikan | Berkas |
|---|---|---|---|
| 1 | Batas waktu essay bisa dilewati dengan memblokir heartbeat | Setelah batas lewat, autosave essay hanya menerima jawaban yang klaim waktunya sebelum batas (kebijakan sama dengan PG). Klien sekarang mengirim `waktuJawabMs`. Diterima/ditolak dicatat ke `log_aktivitas` (aksi `ESSAY_TERLAMBAT`). | essay/jawab/route.ts, siswa/ujian/page.tsx, ujian-outbox.ts |
| 2 | Siswa terkunci dari rekonsiliasi kode darurat (429) | Hitungan percobaan dikembalikan untuk kode benar dan untuk percobaan yang ditolak karena sudah melewati batas; hanya tebakan salah yang tersisa. Klien tidak lagi menghapus bukti offline saat 429. Pengawas punya tombol "Reset percobaan" di panel Kode Darurat Essay. | essay/mulai/route.ts, page.tsx, mode-pengawas/reset-percobaan-essay (baru), kode-darurat-essay/route.ts, ModePengawasTab.tsx, migrasi 53 |
| 3 | Kode darurat 6 digit terlalu mudah ditebak offline | Kode 7 karakter, alfabet 32 tanpa I/O/0/1 (sama dengan kode reset). Input siswa otomatis huruf besar. | essay-amplop-shared.ts, essay-amplop-server.ts, page.tsx |
| 4 | Kunci permanen: pesan sukses bohong | Fungsi mengembalikan `OK_NILAI_TETAP` bila nilai tidak berubah; route admin menampilkan pesan yang jujur dan `nilaiDiubah: false`. | migrasi 53, admin/pelanggaran/route.ts |
| 5 | Reset berurutan menerima kode lama saat status RESET | Pada status RESET, kode lama dijawab "belum bisa" (`retryable`), tanpa membuka kunci dan tanpa menghitung percobaan gagal. | verifikasi-reset/route.ts |
| 6a | Koreksi essay bisa menimpa nilai gugur total (race) | Cek TERKUNCI di dalam `simpan_koreksi_essay_atomik` (`SISWA_TERKUNCI`). | migrasi 53, koreksi-essay/route.ts |
| 6b | Cek device lewat bila `p_device_id` NULL | `IS DISTINCT FROM` di `finalisasi_essay_atomik` dan `finalisasi_pg_atomik`. | migrasi 53 |
| 6c | Reset pengawas tanpa pelanggaran | Siswa AKTIF hanya bisa direset bila ada pelanggaran `BELUM_DITINDAKLANJUTI`. Siswa yang sudah RESET tetap bisa melihat kodenya lagi. | pengawas/sesi/[id]/reset-siswa/route.ts |
| 6d | Amplop dan kode tidak dihapus dari localStorage | Dihapus setelah essay terkirim final (jalur langsung dan jalur outbox). | essay-amplop-client.ts, page.tsx, ujian-outbox.ts |

## Batas yang perlu Anda tahu
- **Temuan 1 mengecilkan celah, tidak menutupnya total.** Waktu jawab berasal dari
  klien, jadi siswa yang sengaja memalsukan jam jawabannya masih bisa lolos dalam
  rentang yang sah. Kekuatannya sama dengan PG. Tinjau log `ESSAY_TERLAMBAT` bila
  curiga.
- **Temuan 3:** angka "3 tahun di 64 inti" adalah perkiraan kasar dari satu inti,
  bukan uji dengan alat penyerang sungguhan.
- **Temuan 6c:** pengawas yang memang ingin mereset siswa AKTIF tanpa pelanggaran
  tidak bisa lagi lewat tombol ini (disengaja). Admin tetap punya `bypass_reset`.
- Yang BELUM diperiksa: isolasi antar yayasan di 173 route (aman selama
  `MULTI_YAYASAN_ENABLED` mati), dan area login/JWT, upload, backup/restore.

## Yang sudah diuji
- Migrasi 53 di Postgres 16 lokal dengan migrasi 19, 31, 32, 33, 45 asli dari repo:
  terpasang dua kali tanpa error; `OK_NILAI_TETAP`, `SISWA_TERKUNCI`,
  `SUDAH_DIKIRIM_WALI`, device NULL ditolak (essay dan PG), device kosong di DB
  tetap boleh, hitung/kembalikan percobaan; anon/authenticated tetap tanpa hak.
- Uji logika (tsx): kode 7 karakter (alfabet, deterministik, tidak sensitif huruf
  besar/kecil, kode 6 digit lama ditolak), kebijakan terlambat essay, enkripsi
  amplop server ke klien.
- `tsc --noEmit` lulus tanpa error.
- **Belum diuji:** jalannya aplikasi di browser, dan Supabase produksi Anda.
  Jalankan skenario di staging: blokir `cek-sesi` lewat DevTools lalu kirim essay
  setelah waktu habis; buka essay dengan kode darurat offline.
