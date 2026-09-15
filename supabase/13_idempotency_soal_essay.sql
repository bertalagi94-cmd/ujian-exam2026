-- =============================================================================
-- FIX BUG: soal essay dobel saat koneksi ke DB lambat lalu guru menekan
-- submit ulang.
--
-- Kejadiannya: apiRequest() di client punya timeout 10 detik (AbortController)
-- — kalau insert di server lebih lambat dari itu, browser membatalkan koneksi
-- dan menampilkan toast merah ("gagal"), TAPI proses INSERT di server (Next.js
-- API route -> Supabase) tidak ikut berhenti karena tidak ada pengecekan
-- req.signal, jadi insert pertama tetap tersimpan. Guru yang mengira gagal
-- lalu menekan submit lagi -> insert kedua jalan -> soal jadi dobel.
--
-- Sebelum ini soal_essay hanya punya UNIQUE(id) (auto-generated per request,
-- jadi tidak pernah bentrok) — tidak ada cara bagi DB untuk tahu bahwa dua
-- request adalah "percobaan yang sama" yang diulang. Kolom idempotency_key
-- di bawah diisi SATU kali oleh client per sesi pengisian form (tetap sama
-- walau request diulang setelah gagal/timeout, baru diganti baru setelah
-- request itu benar-benar sukses) — lihat handleTambahSoal() di
-- src/app/guru/paket/page.tsx dan POST di
-- src/app/api/guru/soal-essay/route.ts.
-- =============================================================================

ALTER TABLE soal_essay
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

-- UNIQUE constraint biasa di Postgres MENGIZINKAN banyak baris NULL (soal
-- lama sebelum migrasi ini tidak akan bermasalah), tapi begitu ada isinya,
-- nilai yang sama tidak boleh dipakai dua kali. Ini jadi jaring pengaman
-- terakhir di level database — walau dua request identik entah bagaimana
-- sampai ke server nyaris bersamaan (race condition), DB sendiri yang
-- menolak baris kedua, bukan cuma mengandalkan pengecekan di kode.
CREATE UNIQUE INDEX IF NOT EXISTS idx_soal_essay_idempotency
  ON soal_essay(idempotency_key)
  WHERE idempotency_key IS NOT NULL;
