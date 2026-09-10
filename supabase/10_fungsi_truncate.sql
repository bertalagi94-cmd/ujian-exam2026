-- =============================================================================
-- BUG FIX (reset admin tidak benar-benar menghapus tabel besar): endpoint
-- src/app/api/admin/reset/route.ts memanggil RPC `truncate_tabel_besar` untuk
-- 8 tabel berukuran besar (TRUNCATE_TABLES: jawaban, jawaban_essay,
-- jawaban_essay_foto, siswa_ujian, nilai, pelanggaran, log_reset,
-- log_aktivitas) supaya tidak timeout di Vercel. TAPI function ini tidak
-- pernah dibuat di migrasi manapun (01-09) — akibatnya setiap kali admin
-- mereset kategori apapun, panggilan rpc() gagal dengan error
-- "function truncate_tabel_besar(...) does not exist" untuk kedelapan tabel
-- itu. Errornya tertangkap oleh clearTable() dan dimasukkan ke array
-- `errors`, tapi karena tabel-tabel lain (soal, paket_soal, kelas_mapel, dst,
-- yang pakai jalur DELETE biasa) tetap berhasil, endpoint tetap merespons
-- HTTP 207 "Reset selesai dengan beberapa error" — bukan gagal total — jadi
-- mudah terlewat. Hasilnya: jawaban PG, jawaban essay, nilai, foto jawaban
-- essay, dan log pelanggaran/reset/aktivitas TIDAK PERNAH benar-benar
-- terhapus oleh reset manapun, termasuk "Reset Semua Data".
--
-- Migrasi ini membuat function yang hilang tersebut. Beberapa catatan desain:
--   - Nama tabel di-WHITELIST persis sama dengan TRUNCATE_TABLES di
--     route.ts (bukan menerima nama tabel bebas) — mencegah SQL injection
--     lewat parameter `nama_tabel` dan mencegah admin (lewat bug lain di
--     endpoint ini di masa depan) tidak sengaja truncate tabel di luar
--     yang dimaksud, mis. `users` atau `pengaturan`.
--   - Tidak pakai CASCADE: skema ini (lihat 01_schema.sql) tidak punya FK
--     constraint sama sekali (semua id TEXT tanpa REFERENCES), jadi TRUNCATE
--     polos aman dan tidak akan menghapus baris di tabel lain.
--   - RESTART IDENTITY: log_reset (id) dan jawaban_essay/jawaban_essay_foto
--     (id BIGSERIAL) pakai sequence — direset ke 1 juga supaya konsisten
--     dengan tabel yang di-DELETE biasa (yang datanya memang kosong sama
--     sekali setelah reset).
--   - SECURITY DEFINER: dipanggil lewat createAdminClient() (service role)
--     dari server, bukan dari client langsung, jadi aman untuk dijalankan
--     dengan privilese pemilik function.
-- =============================================================================

CREATE OR REPLACE FUNCTION truncate_tabel_besar(nama_tabel TEXT)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Whitelist keras — HARUS sinkron dengan TRUNCATE_TABLES di
  -- src/app/api/admin/reset/route.ts. Tabel di luar daftar ini ditolak.
  IF nama_tabel NOT IN (
    'jawaban',
    'jawaban_essay',
    'jawaban_essay_foto',
    'siswa_ujian',
    'nilai',
    'pelanggaran',
    'log_reset',
    'log_aktivitas'
  ) THEN
    RAISE EXCEPTION 'truncate_tabel_besar: tabel "%" tidak diizinkan', nama_tabel;
  END IF;

  EXECUTE format('TRUNCATE TABLE %I RESTART IDENTITY', nama_tabel);
END;
$$;

-- Hanya service role (dipakai createAdminClient()) yang perlu menjalankan ini.
REVOKE ALL ON FUNCTION truncate_tabel_besar(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION truncate_tabel_besar(TEXT) TO service_role;
