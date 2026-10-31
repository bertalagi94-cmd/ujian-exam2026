# Perbaikan: essay siswa tutup-paksa + jawaban offline susulan

Dua perbaikan, dibuat dari prinsip:
1. Nilai tidak boleh hilang kecuali pelanggaran berat.
2. Ujian tidak boleh berlarut ke sesi berikutnya (bagian ini BELUM dikerjakan, lihat "Belum dikerjakan").

## Cara menerapkan

1. Ekstrak zip ini di folder root repo dan timpa file yang sama.
2. Jalankan `supabase/55_sync_jawaban_setelah_tutup.sql` di SQL Editor Supabase (satu kali, aman diulang).
   Sebaiknya SEBELUM deploy kode. Kalau kode lebih dulu: jawaban susulan menerima error sementara (503)
   dan tetap aman di HP siswa, lalu terkirim otomatis begitu migrasi dijalankan.
3. Deploy seperti biasa.

## File

| File | Status |
|---|---|
| `src/app/api/guru/koreksi-essay/route.ts` | diubah (GET) |
| `src/app/guru/penilaian/tabs/PeriksaEssayTab.tsx` | diubah |
| `src/app/api/siswa/ujian/sync/route.ts` | diubah |
| `src/lib/hitung-ulang-nilai-susulan.ts` | baru |
| `supabase/55_sync_jawaban_setelah_tutup.sql` | baru |

Tidak diubah: `finalisasi-nilai.ts`, `kirim-nilai/route.ts` (aturan rilis tetap ketat), semua route tutup sesi.

## Bagian 1 — Essay siswa tutup-paksa

Masalah: siswa yang sesinya ditutup paksa otomatis berstatus `TIDAK_MENGERJAKAN` dengan `nilai_essay` kosong.
Layar guru menyembunyikan kolom skor untuk status itu, padahal server `kirim-nilai` menolak rilis kalau `nilai_essay` kosong.

Perubahan:
- API (`koreksi-essay` GET): `sudahDinilai` sekarang berarti `nilai_essay` sudah terisi (sama dengan aturan server).
  Field baru `tutupPaksaBelumDinilai` = status essay `TIDAK_MENGERJAKAN` dan `nilai_essay` masih kosong
  (siswa terkunci pelanggaran dikecualikan; nilainya tetap 0).
- Tampilan guru: kolom skor, Simpan, dan "Tidak Mengerjakan" tetap tampil untuk siswa tutup-paksa yang belum dinilai,
  dan untuk siswa yang sudah diberi skor (bisa diedit lagi selama belum dikirim ke wali kelas).
  Hanya siswa yang SENGAJA ditandai "Tidak Mengerjakan" oleh guru (essay 0, tanpa skor per soal) yang kontrolnya disembunyikan.
- Lencana "Perlu Dinilai (sesi ditutup paksa)" (kuning) menggantikan "Tidak Mengerjakan" (merah) untuk siswa tersebut,
  plus satu baris peringatan "N siswa sesinya ditutup paksa dan essay-nya belum dinilai".
- Tombol rilis massal tetap nonaktif sampai semua siswa diputuskan, dengan alasan yang jelas.

Guru punya tiga pilihan per siswa: nilai jawaban yang sempat tersimpan, tekan "Tidak Mengerjakan", atau tunda.

KEBIJAKAN yang saya asumsikan: guru BOLEH menilai jawaban parsial siswa tutup-paksa.
Kalau sekolah mewajibkan nilai 0, kabari saya, tampilannya berbeda.

## Bagian 2 — Jawaban offline susulan setelah sesi ditutup

Masalah: `/api/siswa/ujian/sync` menolak semua jawaban begitu sesi bukan BERJALAN, jadi jawaban yang dibuat
siswa sebelum waktunya habis tapi terkirim belakangan (HP offline) hilang.

Perubahan:
- Sesi berstatus SELESAI tidak lagi langsung ditolak. Jawaban harus lolos saringan bukti waktu yang SUDAH ADA
  (`saringJawabanTerlambat`): dibuat setelah siswa mulai, sebelum batas waktunya sendiri, bukan di masa depan,
  dan tidak ada heartbeat server yang membuktikan siswa online sampai lewat batas.
- Jendela penerimaan: 24 jam setelah sesi ditutup (`JENDELA_JAWABAN_SUSULAN_JAM` di `sync/route.ts`).
  Dicek di dalam transaksi database oleh fungsi baru `sync_jawaban_susulan_atomik`.
- Siswa TERKUNCI (gugur total) dan RESET tidak menerima jawaban susulan.
- Setelah jawaban tersimpan, nilai PG siswa dihitung ulang (`hitung-ulang-nilai-susulan.ts`), dengan pengaman:
  - Nilai yang sudah dikirim ke wali kelas, sudah dirilis ke siswa, atau essay-nya sudah dinilai TIDAK diubah otomatis.
    Sistem hanya menambah catatan `[SUSULAN]` di `catatan_guru` supaya guru meninjau.
    (Untuk kasus essay sudah dinilai: guru cukup menyimpan ulang koreksi essay, itu menghitung ulang nilai total.)
  - Hasil edit manual guru (`nilai_edit`, dll.) tidak disentuh.
  - Kalau hitung ulang gagal, siswa menerima 503 dan HP mencoba lagi otomatis; hitung ulang idempoten.
- Setiap penerimaan dicatat di `log_aktivitas` (aksi `SYNC_SETELAH_TUTUP` dan `SYNC_TERLAMBAT`).

Dua pilihan kebijakan di bagian atas `sync/route.ts` (perlu diputuskan sekolah):
- `JENDELA_JAWABAN_SUSULAN_JAM = 24`.
- `SUSULAN_HANYA_SEBELUM_WAKTU_TUTUP = false`. Pada sesi yang ditutup lebih awal dari batas waktu siswa,
  `false` tetap menerima jawaban yang dibuat sebelum batas waktu siswa itu sendiri (siswa dapat waktu penuh).
  `true` hanya menerima yang dibuat sebelum sesi ditutup. Saya pilih `false` agar sejalan dengan "jangan ada nilai hilang".

## Batasan yang jujur

- Waktu jawaban berasal dari HP siswa (bukti, bukan jaminan). Ini sama dengan kebijakan yang sudah ada di
  `deadline-pg.ts`; penegak tambahannya heartbeat server, jendela 24 jam, dan log.
- Aplikasi di HP siswa memanggil `/selesai` setelah `/sync`. Untuk sesi yang sudah ditutup `/selesai` tetap
  menolak, jadi siswa mungkin melihat paketnya "gagal terkirim" walau jawabannya SUDAH tersimpan dan dinilai.
  Layar siswa tidak saya ubah (berisiko). Beri tahu siswa/pengawas agar tidak panik, atau minta saya merapikan pesannya.
- Tidak ada penutupan otomatis sesi; belum ada aturan tutup bertingkat. Lihat di bawah.

## Belum dikerjakan (sengaja)

- Aturan tutup sesi bertingkat (blokir kalau ada siswa bersinyal dan masih punya waktu, konfirmasi tertulis, jalur admin).
- Penutupan otomatis saat sesi berikutnya dibuka.
- Pemeriksaan pemicu pelanggaran tidak sengaja (notifikasi WhatsApp dsb.) dan fitur pemulihannya.

Bagian 2 sengaja dibuat lebih dulu karena aturan tutup sesi yang melindungi siswa offline hanya aman kalau
jawaban offline yang terlambat bisa diterima.

## Tes yang disarankan (data percobaan, satu sesi ber-essay)

1. Siswa A menulis sebagian essay lalu sesi ditutup paksa. Guru bisa menilai A, lencana berubah jadi "Sudah Dinilai".
2. Siswa B tidak menulis apa pun, sesi ditutup paksa. Guru menekan "Tidak Mengerjakan", lencana merah.
3. Siswa C menekan Kirim normal. Tidak terpengaruh.
4. Setelah A dan B diputuskan, "Rilis Nilai ke Semua Siswa" berhasil.
5. Sebelum A dan B diputuskan: rilis massal nonaktif dan banner peringatan tampil.
6. Susulan: siswa D mengerjakan PG dengan mode pesawat, pengawas menutup sesi, lalu HP D online lagi dalam batas waktunya.
   Jawabannya masuk dan nilai PG D naik; `catatan_guru` berisi `[SUSULAN]`.
7. Susulan ditolak: ulangi (6) tapi online lagi lewat 24 jam, atau dengan siswa yang dikunci pelanggaran.
8. Susulan pada nilai yang sudah dikirim ke wali: nilai tidak berubah, hanya muncul catatan `[SUSULAN]`.

## Verifikasi yang sudah dilakukan

- `tsc --noEmit` lulus pada salinan repo yang sudah ditimpa file-file ini.
- Sintaks SQL dan PL/pgSQL fungsi baru diparse (pglast).
- BELUM dijalankan terhadap database nyata atau di browser. Tolong jalankan daftar tes di atas di lingkungan percobaan.
