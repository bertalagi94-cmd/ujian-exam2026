-- =============================================================================
-- Migrasi 32: finalisasi ESSAY yang ATOMIK (status_essay + status siswa dalam
--             1 transaksi, sama seperti finalisasi_pg_atomik untuk PG)
--
-- LATAR BELAKANG (temuan audit alur online/offline):
-- POST /api/siswa/ujian/essay/kirim adalah SATU-SATUNYA titik akhir yang
-- menutup sesi ujian siswa (status_essay -> SUDAH_KIRIM, siswa_ujian.status
-- -> SELESAI), tapi sebelumnya semua pengecekan & penulisannya dilakukan
-- sebagai query-query TERPISAH lewat PostgREST:
--
--   1) SELECT sesi_ujian.status                    -> cek 'BERJALAN'
--   2) SELECT siswa_ujian (status, status_essay,
--      device_id)                                   -> cek TERKUNCI/RESET/
--                                                        device/MENGERJAKAN
--   3) SELECT ULANG sesi_ujian.status (tanpa lock)  -> mempersempit celah
--      (lihat komentar lama di route.ts), TAPI TETAP BUKAN atomik
--   4) UPDATE siswa_ujian (status_essay, status)
--
-- Akibatnya ada beberapa celah race nyata:
--
--   a) Antara langkah (3) dan (4) pengawas masih bisa menutup sesi TEPAT di
--      tengah, atau status siswa masih bisa berubah jadi TERKUNCI/RESET
--      (mis. pelanggaran yang baru saja tersinkron) -- keduanya TIDAK dibaca
--      ulang di langkah (3), hanya status sesi yang dibaca ulang di sana.
--   b) device_id HANYA dicek di langkah (2), tidak pernah dibaca ulang di
--      dalam lock -- kalau device_id siswa berubah TEPAT di antara (2) dan
--      (4), UPDATE di (4) tetap jalan memakai data device_id yang sudah basi.
--   c) Dua request essay/kirim yang datang nyaris bersamaan dari siswa yang
--      sama (klik ganda / retry jaringan outbox offline) bisa lolos
--      pengecekan status_essay='MENGERJAKAN' berdua-duanya sebelum salah satu
--      sempat menulis SUDAH_KIRIM -- ditolong sebagian oleh WHERE
--      status_essay='MENGERJAKAN' di UPDATE (hanya 1 yang match), tapi
--      langkah (1)-(3) tetap dijalankan dua kali secara sia-sia tanpa lock.
--
-- SOLUSI (pola yang sama persis dengan finalisasi_pg_atomik, migrasi 21/28):
-- satu fungsi Postgres yang mengunci & memvalidasi & menulis dalam SATU
-- transaksi:
--   - SELECT ... FOR SHARE pada baris sesi_ujian.
--       * Banyak siswa bisa kirim essay bersamaan (FOR SHARE tidak saling
--         blok satu sama lain).
--       * UPDATE status sesi oleh pengawas (tutup / tutup-paksa) butuh lock
--         EKSKLUSIF, jadi MENUNGGU sampai commit essay/kirim yang sedang
--         berjalan selesai; kirim yang datang SETELAH penutupan melihat
--         status 'SELESAI' dan ditolak. Tidak ada lagi celah TOCTOU.
--   - SELECT ... FOR UPDATE pada baris siswa_ujian -> dua request essay/kirim
--     bersamaan dari siswa yang sama diserialkan sepenuhnya (bukan cuma
--     dilindungi WHERE di UPDATE).
--   - device_id, status (TERKUNCI/RESET), dan status_essay (MENGERJAKAN)
--     SEMUANYA dibaca ulang DI DALAM lock yang sama, jadi keputusan akhir
--     memakai data yang benar-benar terbaru, bukan data basi dari query
--     sebelum lock diambil.
--
-- Pengecekan yang TIDAK butuh atomicity tetap tinggal di route.ts (dijalankan
-- sebelum memanggil fungsi ini, sebagai early-return cepat untuk kasus
-- normal): idempotent "sudah pernah kirim" (sebelum lock diambil, untuk
-- menghindari lock yang tidak perlu di kasus paling umum -- refresh halaman),
-- dan validasi batas waktu essay (sudahLewatBatasWaktuEssay) -- keduanya
-- murni perhitungan berdasarkan data yang tidak berubah akibat request lain,
-- jadi tidak berisiko race.
--
-- Aman dijalankan berulang (CREATE OR REPLACE). Kompatibel mundur: kalau
-- migrasi ini belum dijalankan tapi kode sudah di-deploy, panggilan RPC akan
-- gagal dan endpoint membalas 500 (fail closed) -- lihat komentar FAIL CLOSED
-- di route.ts.
-- =============================================================================

CREATE OR REPLACE FUNCTION finalisasi_essay_atomik(
  p_sesi_id   TEXT,
  p_nis       TEXT,
  p_device_id TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_sesi_status   TEXT;
  v_siswa_status  TEXT;
  v_status_essay  TEXT;
  v_device_id_db  TEXT;
BEGIN
  -- 1) Kunci baris sesi (shared) + cek status di DALAM transaksi.
  SELECT status INTO v_sesi_status
  FROM sesi_ujian
  WHERE id = p_sesi_id
  FOR SHARE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('hasil', 'SESI_TIDAK_ADA');
  END IF;

  IF v_sesi_status <> 'BERJALAN' THEN
    RETURN jsonb_build_object('hasil', 'SESI_DITUTUP');
  END IF;

  -- 2) Kunci baris siswa (exclusive) -> serialisasi request ganda siswa ini,
  --    dan baca status TERBARU (bukan data basi dari sebelum lock diambil).
  SELECT status, status_essay, device_id
  INTO v_siswa_status, v_status_essay, v_device_id_db
  FROM siswa_ujian
  WHERE sesi_id = p_sesi_id AND nis = p_nis
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('hasil', 'SISWA_TIDAK_TERDAFTAR');
  END IF;

  -- Idempotent: kalau sudah pernah kirim (mis. kalah race lawan request lain
  -- yang commit duluan TEPAT di dalam lock ini), kembalikan sukses -- BUKAN
  -- error -- terlepas dari device_id, sama seperti perilaku early-return lama
  -- di route.ts ("siswa yang sudah berhasil kirim dari device yang sah tetap
  -- bisa mengambil ulang hasilnya walau device_id di localStorage berubah").
  IF v_status_essay = 'SUDAH_KIRIM' THEN
    RETURN jsonb_build_object('hasil', 'SUDAH_KIRIM');
  END IF;

  -- FIX (device_id sebelumnya tidak pernah dibaca ulang di dalam lock):
  -- tolak kalau device_id yang terdaftar TERBARU tidak cocok dengan device
  -- yang mengirim permintaan ini. Device_id NULL (data lama / belum pernah
  -- tercatat) tidak diblokir, sama seperti perilaku lama di route.ts.
  IF v_device_id_db IS NOT NULL AND v_device_id_db <> p_device_id THEN
    RETURN jsonb_build_object('hasil', 'DEVICE_LAIN');
  END IF;

  IF v_siswa_status = 'RESET' THEN
    RETURN jsonb_build_object('hasil', 'SISWA_RESET');
  END IF;

  IF v_siswa_status = 'TERKUNCI' THEN
    RETURN jsonb_build_object('hasil', 'SISWA_TERKUNCI');
  END IF;

  IF v_status_essay IS DISTINCT FROM 'MENGERJAKAN' THEN
    RETURN jsonb_build_object('hasil', 'ESSAY_BELUM_MULAI');
  END IF;

  -- 3) Tulis status final. WHERE status_essay='MENGERJAKAN' dipertahankan
  --    sebagai lapis kedua walau sudah dilindungi FOR UPDATE -- murni
  --    defensif, tidak seharusnya pernah membuat 0 baris ter-update di sini.
  UPDATE siswa_ujian
  SET status_essay      = 'SUDAH_KIRIM',
      waktu_kirim_essay = NOW(),
      status            = 'SELESAI',
      waktu_selesai     = NOW()
  WHERE sesi_id = p_sesi_id
    AND nis = p_nis
    AND status_essay = 'MENGERJAKAN';

  RETURN jsonb_build_object('hasil', 'OK');
END;
$$;

-- Fungsi ini MENULIS status akhir ujian siswa: jangan bisa dipanggil lewat
-- anon key publik. Hanya service role (createAdminClient di API route) yang
-- boleh menjalankan.
REVOKE ALL ON FUNCTION finalisasi_essay_atomik(TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION finalisasi_essay_atomik(TEXT, TEXT, TEXT) TO service_role;
