-- =============================================================================
-- Migrasi 58: ganti NISN siswa yang ATOMIK dan LENGKAP
--
-- LATAR BELAKANG:
-- NISN disimpan di kolom `nis`, yang menjadi PRIMARY KEY tabel `siswa` dan
-- juga tersimpan sebagai teks biasa (TANPA foreign key) di tabel-tabel turunan.
-- Karena itu NISN tidak bisa diganti dengan satu UPDATE biasa: kalau hanya
-- tabel `siswa` yang diubah, semua nilai, jawaban, dan riwayat ujian siswa itu
-- menjadi data yatim dan "hilang" dari akunnya.
--
-- SOLUSI (pola sama seperti hapus_siswa_atomik di migrasi 27): satu fungsi
-- Postgres yang memperbarui SEMUA tabel dalam SATU transaksi -- commit bersama
-- atau batal bersama.
--
-- Perlindungan di dalam fungsi:
--   * NISN lama harus ada; NISN baru tidak boleh sudah dipakai siswa lain.
--   * NISN baru tidak boleh bentrok dengan username akun staf (tabel users).
--   * NISN baru tidak boleh sudah punya data yatim di tabel turunan (sisa siswa
--     lama yang dihapus sebelum migrasi 27), supaya data orang lain tidak
--     ikut tergabung ke siswa ini.
--
-- Aman dijalankan berulang (CREATE OR REPLACE).
-- =============================================================================

CREATE OR REPLACE FUNCTION ganti_nisn_atomik(p_nis_lama TEXT, p_nis_baru TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_ada BOOLEAN;
BEGIN
  IF p_nis_baru IS NULL OR btrim(p_nis_baru) = '' THEN
    RETURN jsonb_build_object('hasil', 'NISN_BARU_KOSONG');
  END IF;

  IF p_nis_lama = p_nis_baru THEN
    RETURN jsonb_build_object('hasil', 'OK', 'berubah', false);
  END IF;

  -- Kunci baris siswa lama supaya tidak ada request lain yang mengubahnya
  -- di tengah proses.
  SELECT TRUE INTO v_ada FROM siswa WHERE nis = p_nis_lama FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('hasil', 'SISWA_TIDAK_ADA');
  END IF;

  IF EXISTS (SELECT 1 FROM siswa WHERE nis = p_nis_baru) THEN
    RETURN jsonb_build_object('hasil', 'NISN_SUDAH_ADA');
  END IF;

  IF EXISTS (SELECT 1 FROM users WHERE username = p_nis_baru) THEN
    RETURN jsonb_build_object('hasil', 'BENTROK_USERNAME');
  END IF;

  IF EXISTS (SELECT 1 FROM pelanggaran          WHERE nis = p_nis_baru)
  OR EXISTS (SELECT 1 FROM log_reset            WHERE nis = p_nis_baru)
  OR EXISTS (SELECT 1 FROM nilai                WHERE nis = p_nis_baru)
  OR EXISTS (SELECT 1 FROM jawaban              WHERE nis = p_nis_baru)
  OR EXISTS (SELECT 1 FROM jawaban_essay        WHERE nis = p_nis_baru)
  OR EXISTS (SELECT 1 FROM jawaban_essay_foto   WHERE nis = p_nis_baru)
  OR EXISTS (SELECT 1 FROM skor_essay_siswa     WHERE nis = p_nis_baru)
  OR EXISTS (SELECT 1 FROM essay_amplop_offline WHERE nis = p_nis_baru)
  OR EXISTS (SELECT 1 FROM siswa_ujian          WHERE nis = p_nis_baru) THEN
    RETURN jsonb_build_object('hasil', 'ADA_DATA_YATIM');
  END IF;

  UPDATE pelanggaran          SET nis = p_nis_baru WHERE nis = p_nis_lama;
  UPDATE log_reset            SET nis = p_nis_baru WHERE nis = p_nis_lama;
  UPDATE nilai                SET nis = p_nis_baru WHERE nis = p_nis_lama;
  UPDATE jawaban              SET nis = p_nis_baru WHERE nis = p_nis_lama;
  UPDATE jawaban_essay        SET nis = p_nis_baru WHERE nis = p_nis_lama;
  UPDATE jawaban_essay_foto   SET nis = p_nis_baru WHERE nis = p_nis_lama;
  UPDATE skor_essay_siswa     SET nis = p_nis_baru WHERE nis = p_nis_lama;
  UPDATE essay_amplop_offline SET nis = p_nis_baru WHERE nis = p_nis_lama;
  UPDATE siswa_ujian          SET nis = p_nis_baru WHERE nis = p_nis_lama;
  UPDATE siswa                SET nis = p_nis_baru WHERE nis = p_nis_lama;

  RETURN jsonb_build_object('hasil', 'OK', 'berubah', true);
END;
$$;

REVOKE ALL ON FUNCTION ganti_nisn_atomik(TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION ganti_nisn_atomik(TEXT, TEXT) TO service_role;
