-- =============================================================================
-- Migrasi 26: aksi admin "kunci permanen" yang ATOMIK
--
-- LATAR BELAKANG (temuan audit lanjutan — Batch 3, item "kunci_permanen"):
-- PATCH /api/admin/pelanggaran (action=kunci_permanen) sebelumnya melakukan
-- 5 tulisan TERPISAH lewat PostgREST, dan HAMPIR SEMUANYA TIDAK MEMERIKSA
-- ERROR sama sekali:
--
--   1) UPDATE siswa_ujian SET status = 'TERKUNCI'              (error diabaikan)
--   2) SELECT nilai ... (cek sudah ada?)
--   3) INSERT nilai (benar=0,total=0,nilai=0,...) kalau belum ada (error diabaikan)
--   4) UPDATE siswa_ujian SET waktu_selesai = NOW()            (error diabaikan)
--   5) UPDATE pelanggaran SET status = 'SUDAH_DITINDAKLANJUTI' (error diabaikan)
--   6) INSERT log_reset (jejak audit)                          (error diabaikan)
--
-- Karena error TIDAK diperiksa, kalau salah satu langkah gagal (mis. gangguan
-- DB sesaat, constraint violation), ADMIN TETAP MELIHAT RESPONS SUKSES ("...
-- telah dikunci permanen dan nilai diset 0") walau state di database bisa
-- timpang — mis. status TERKUNCI tersimpan tapi baris nilai gagal ter-insert
-- (siswa jadi tidak punya nilai sama sekali untuk sesi ini, tidak akan pernah
-- muncul di rekap), atau pelanggaran gagal ditandai ditindaklanjuti sehingga
-- terus muncul sebagai "belum ditindaklanjuti" walau siswanya sudah dikunci.
--
-- SOLUSI: satu fungsi Postgres yang menjalankan semuanya dalam satu transaksi
-- DAN memeriksa/melaporkan kegagalan — commit bersama atau batal bersama.
-- Pola & gaya sama persis dengan finalisasi_pg_atomik (migrasi 21) dan
-- simpan_koreksi_essay_atomik (migrasi 25).
--
-- Aman dijalankan berulang (CREATE OR REPLACE).
-- =============================================================================

CREATE OR REPLACE FUNCTION kunci_permanen_atomik(
  p_sesi_id      TEXT,
  p_nis          TEXT,
  p_nilai_id_baru TEXT,   -- id siap pakai (generateId('NIL')) kalau nilai perlu dibuat; diabaikan kalau nilai sudah ada
  p_reset_oleh   TEXT,
  p_catatan      TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_siswa_ujian_ada BOOLEAN;
  v_nilai_id        TEXT;
  v_mapel_id        TEXT;
  v_kelas           TEXT;
  v_kkm             INTEGER;
BEGIN
  -- 1) Kunci baris siswa_ujian (exclusive) & set TERKUNCI.
  SELECT TRUE INTO v_siswa_ujian_ada
  FROM siswa_ujian
  WHERE sesi_id = p_sesi_id AND nis = p_nis
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('hasil', 'SISWA_UJIAN_TIDAK_ADA');
  END IF;

  UPDATE siswa_ujian
  SET status = 'TERKUNCI'
  WHERE sesi_id = p_sesi_id AND nis = p_nis;

  -- 2) Kalau nilai belum ada, buat baris nilai 0 (mengunci siswa ini di 0
  --    untuk sesi ini) — status TETAP 'TERKUNCI' (BUKAN 'SELESAI'), supaya
  --    guard akses ujian & indikator dashboard pengawas/guru tetap konsisten.
  SELECT id INTO v_nilai_id
  FROM nilai
  WHERE sesi_id = p_sesi_id AND nis = p_nis
  FOR UPDATE;

  IF v_nilai_id IS NULL THEN
    SELECT mapel_id, kelas INTO v_mapel_id, v_kelas
    FROM sesi_ujian WHERE id = p_sesi_id;

    IF v_mapel_id IS NULL THEN
      RETURN jsonb_build_object('hasil', 'SESI_TIDAK_ADA');
    END IF;

    SELECT kkm INTO v_kkm FROM mapel WHERE id = v_mapel_id;

    INSERT INTO nilai (id, sesi_id, nis, mapel_id, kelas, benar, total, nilai, grade, lulus, kkm, "timestamp")
    VALUES (p_nilai_id_baru, p_sesi_id, p_nis, v_mapel_id, v_kelas, 0, 0, 0, 'E', FALSE, COALESCE(v_kkm, 75), NOW())
    ON CONFLICT (sesi_id, nis) DO NOTHING;

    UPDATE siswa_ujian
    SET waktu_selesai = NOW()
    WHERE sesi_id = p_sesi_id AND nis = p_nis;
  END IF;

  -- 3) Tandai semua pelanggaran siswa ini di sesi ini sudah ditindaklanjuti.
  UPDATE pelanggaran
  SET status = 'SUDAH_DITINDAKLANJUTI'
  WHERE sesi_id = p_sesi_id AND nis = p_nis;

  -- 4) Jejak audit.
  INSERT INTO log_reset (nis, reset_oleh, alasan, password_baru, digunakan)
  VALUES (
    p_nis,
    p_reset_oleh,
    'sesi:' || p_sesi_id || ' — Dikunci permanen oleh ADMIN' || COALESCE(': ' || p_catatan, ''),
    '-',
    TRUE
  );

  RETURN jsonb_build_object('hasil', 'OK');
END;
$$;

-- Fungsi ini MENGUNCI siswa & mengubah nilai: jangan bisa dipanggil lewat
-- anon key publik. Hanya service role (createAdminClient di API route) yang
-- boleh menjalankan.
REVOKE ALL ON FUNCTION kunci_permanen_atomik(TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION kunci_permanen_atomik(TEXT, TEXT, TEXT, TEXT, TEXT) TO service_role;
