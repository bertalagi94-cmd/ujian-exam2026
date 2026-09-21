-- =============================================================================
-- Migrasi 24: SISTEM RESET PELANGGARAN BERURUTAN (R1 / R2 / R3)
--
-- ATURAN BISNIS
--   Pelanggaran #1 -> siswa harus memakai R1 untuk lanjut
--   Pelanggaran #2 -> R2
--   Pelanggaran #3 -> R3
--   Pelanggaran #4 -> ujian siswa OTOMATIS dihentikan (TERKUNCI), tanpa
--                     menunggu pengawas menekan apa pun.
--   - R1 hanya sah lebih dulu dari R2, R2 lebih dulu dari R3.
--   - Tiap kode sekali pakai.
--   - Reset TIDAK menghapus riwayat pelanggaran; ia hanya otorisasi lanjut.
--
-- DESAIN
--   Kode R1/R2/R3 TIDAK disimpan di database. Aplikasi menurunkannya dengan
--   HMAC dari rahasia server (src/lib/reset-berurutan.ts), sama seperti kode
--   darurat Essay. Yang disimpan di database hanyalah PENGHITUNG:
--       siswa_ujian.reset_terpakai  (0..3)
--   Urutan + sekali-pakai dijamin karena penghitung itu hanya bisa naik dari
--   n-1 ke n di dalam transaksi yang mengunci baris siswa_ujian.
--
--   Tiga fungsi di bawah ini menjalankan seluruh perubahan status di dalam
--   SATU transaksi dengan row lock, sehingga:
--     * dua pelanggaran bersamaan tidak bisa sama-sama menjadi "level 1"
--     * pelanggaran ke-4 mengunci siswa saat itu juga (atomik)
--     * kode yang sama tidak bisa dipakai dua kali walau dikirim paralel
--     * pengiriman ulang (retry / antrean offline) tidak menggandakan apa pun
--
-- Aman dijalankan berulang.
-- PRASYARAT: migrasi 01 (tabel dasar) sudah dijalankan.
-- =============================================================================

-- ── 1. Kolom baru ────────────────────────────────────────────────────────────
ALTER TABLE siswa_ujian
  ADD COLUMN IF NOT EXISTS reset_terpakai        SMALLINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS reset_gagal           SMALLINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS reset_terkunci_sampai TIMESTAMPTZ;

-- event_id = kunci idempoten yang dibuat client untuk SATU kejadian pelanggaran.
-- Pengiriman ulang event yang sama tidak boleh menjadi pelanggaran baru.
ALTER TABLE pelanggaran
  ADD COLUMN IF NOT EXISTS event_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_pelanggaran_event
  ON pelanggaran (sesi_id, nis, event_id)
  WHERE event_id IS NOT NULL;

-- Jejak audit pemakaian reset memakai tabel log_reset yang sudah ada (sudah
-- tercakup backup/restore/truncate). Kolom baru hanya untuk memudahkan
-- penelusuran; password_baru diisi '-' (kode tidak pernah disimpan).
ALTER TABLE log_reset
  ADD COLUMN IF NOT EXISTS sesi_id  TEXT,
  ADD COLUMN IF NOT EXISTS reset_no SMALLINT;

CREATE INDEX IF NOT EXISTS idx_log_reset_sesi_nis
  ON log_reset (sesi_id, nis)
  WHERE sesi_id IS NOT NULL;

-- ── 2. Catat pelanggaran (atomik, idempoten) ─────────────────────────────────
CREATE OR REPLACE FUNCTION catat_pelanggaran_atomik(
  p_sesi_id    TEXT,
  p_nis        TEXT,
  p_id         TEXT,
  p_jenis      TEXT,
  p_detail     TEXT,
  p_event_id   TEXT DEFAULT NULL,
  p_maks_reset INT  DEFAULT 3
)
RETURNS JSONB
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_sesi_status   TEXT;
  v_status        TEXT;
  v_terpakai      INT;
  v_level         INT;
  v_level_lama    INT;
BEGIN
  IF p_maks_reset IS NULL OR p_maks_reset < 1 OR p_maks_reset > 3 THEN
    RAISE EXCEPTION 'p_maks_reset harus 1..3';
  END IF;

  -- Sesi: FOR SHARE supaya penutupan sesi oleh pengawas menunggu kita selesai.
  SELECT status INTO v_sesi_status
  FROM sesi_ujian WHERE id = p_sesi_id FOR SHARE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('hasil', 'SESI_TIDAK_ADA');
  END IF;
  IF v_sesi_status <> 'BERJALAN' THEN
    RETURN jsonb_build_object('hasil', 'SESI_DITUTUP');
  END IF;

  -- Siswa: FOR UPDATE mengserialkan semua pelanggaran/reset siswa ini.
  SELECT status, reset_terpakai INTO v_status, v_terpakai
  FROM siswa_ujian
  WHERE sesi_id = p_sesi_id AND nis = p_nis
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('hasil', 'SISWA_TIDAK_TERDAFTAR');
  END IF;

  -- Idempoten: event yang sama sudah pernah dicatat -> kembalikan hasil lama.
  IF p_event_id IS NOT NULL THEN
    SELECT level INTO v_level_lama
    FROM pelanggaran
    WHERE sesi_id = p_sesi_id AND nis = p_nis AND event_id = p_event_id;
    IF FOUND THEN
      RETURN jsonb_build_object(
        'hasil', 'DUPLIKAT',
        'level', v_level_lama,
        'terkunci', v_status = 'TERKUNCI'
      );
    END IF;
  END IF;

  SELECT COUNT(*) INTO v_level
  FROM pelanggaran
  WHERE sesi_id = p_sesi_id AND nis = p_nis AND status <> 'DIABAIKAN';

  IF v_status = 'TERKUNCI' THEN
    RETURN jsonb_build_object('hasil', 'TERKUNCI', 'level', v_level, 'terkunci', TRUE);
  END IF;

  IF v_status = 'SELESAI' THEN
    RETURN jsonb_build_object('hasil', 'SUDAH_SELESAI', 'level', v_level, 'terkunci', FALSE);
  END IF;

  -- Siswa SUDAH menunggu kode reset dari pelanggaran sebelumnya. Kejadian baru
  -- selama menunggu bukan pelanggaran tambahan (satu reset = satu pelanggaran),
  -- supaya urutan R1 -> R2 -> R3 tidak bergeser.
  IF v_status = 'RESET' THEN
    RETURN jsonb_build_object('hasil', 'MENUNGGU_RESET', 'level', v_level, 'terkunci', FALSE);
  END IF;

  v_level := v_level + 1;

  -- Kode reset sudah habis dipakai -> pelanggaran ini menutup ujian siswa.
  IF v_terpakai >= p_maks_reset THEN
    INSERT INTO pelanggaran (id, sesi_id, nis, jenis, level, detail, status, event_id)
    VALUES (p_id, p_sesi_id, p_nis, p_jenis, v_level, p_detail, 'SUDAH_DITINDAKLANJUTI', p_event_id);

    UPDATE pelanggaran SET status = 'SUDAH_DITINDAKLANJUTI'
    WHERE sesi_id = p_sesi_id AND nis = p_nis AND status = 'BELUM_DITINDAKLANJUTI';

    UPDATE siswa_ujian SET status = 'TERKUNCI'
    WHERE sesi_id = p_sesi_id AND nis = p_nis;

    RETURN jsonb_build_object('hasil', 'TERKUNCI', 'level', v_level, 'terkunci', TRUE);
  END IF;

  INSERT INTO pelanggaran (id, sesi_id, nis, jenis, level, detail, status, event_id)
  VALUES (p_id, p_sesi_id, p_nis, p_jenis, v_level, p_detail, 'BELUM_DITINDAKLANJUTI', p_event_id);

  UPDATE siswa_ujian SET status = 'RESET'
  WHERE sesi_id = p_sesi_id AND nis = p_nis;

  RETURN jsonb_build_object(
    'hasil', 'DICATAT',
    'level', v_level,
    'terkunci', FALSE,
    'reset_berikutnya', v_terpakai + 1
  );
END;
$$;

-- ── 3. Pakai kode reset nomor N (atomik, berurutan, sekali pakai) ────────────
-- Aplikasi HANYA memanggil ini setelah mencocokkan kode yang diketik siswa
-- dengan kode R(N) turunan HMAC. Fungsi ini memastikan N memang "giliran"-nya.
CREATE OR REPLACE FUNCTION konsumsi_reset_berurutan(
  p_sesi_id  TEXT,
  p_nis      TEXT,
  p_nomor    INT,
  p_maks     INT  DEFAULT 3,
  p_oleh     TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_sesi_status TEXT;
  v_status      TEXT;
  v_terpakai    INT;
  v_terkunci    TIMESTAMPTZ;
  v_mulai       TIMESTAMPTZ;
BEGIN
  IF p_nomor IS NULL OR p_nomor < 1 OR p_maks IS NULL OR p_nomor > p_maks OR p_maks > 3 THEN
    RETURN jsonb_build_object('hasil', 'NOMOR_TIDAK_VALID');
  END IF;

  SELECT status INTO v_sesi_status
  FROM sesi_ujian WHERE id = p_sesi_id FOR SHARE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('hasil', 'SESI_TIDAK_ADA');
  END IF;
  IF v_sesi_status <> 'BERJALAN' THEN
    RETURN jsonb_build_object('hasil', 'SESI_DITUTUP');
  END IF;

  SELECT status, reset_terpakai, reset_terkunci_sampai,
         COALESCE(waktu_mulai_awal, waktu_mulai)
    INTO v_status, v_terpakai, v_terkunci, v_mulai
  FROM siswa_ujian
  WHERE sesi_id = p_sesi_id AND nis = p_nis
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('hasil', 'SISWA_TIDAK_TERDAFTAR');
  END IF;

  IF v_status = 'TERKUNCI' THEN
    RETURN jsonb_build_object('hasil', 'TERKUNCI');
  END IF;

  IF v_terkunci IS NOT NULL AND v_terkunci > NOW() THEN
    RETURN jsonb_build_object('hasil', 'DIKUNCI_SEMENTARA', 'sampai', v_terkunci);
  END IF;

  -- Reset nomor ini (atau yang lebih tinggi) sudah pernah dipakai. Ini kasus
  -- retry yang sah (respons pertama hilang) -> beri hasil yang sama, tanpa
  -- mengubah apa pun.
  IF v_terpakai >= p_nomor THEN
    RETURN jsonb_build_object('hasil', 'SUDAH_DIPAKAI', 'waktu_mulai', v_mulai, 'reset_terpakai', v_terpakai);
  END IF;

  -- R2 sebelum R1 / R3 sebelum R2 -> ditolak.
  IF v_terpakai <> p_nomor - 1 THEN
    RETURN jsonb_build_object('hasil', 'URUTAN_SALAH', 'reset_terpakai', v_terpakai);
  END IF;

  -- Kode hanya bermakna kalau siswa memang sedang menunggu reset.
  IF v_status <> 'RESET' THEN
    RETURN jsonb_build_object('hasil', 'TIDAK_PERLU_RESET', 'waktu_mulai', v_mulai, 'reset_terpakai', v_terpakai);
  END IF;

  UPDATE siswa_ujian
  SET reset_terpakai = p_nomor,
      reset_gagal = 0,
      reset_terkunci_sampai = NULL,
      status = 'AKTIF'
  WHERE sesi_id = p_sesi_id AND nis = p_nis;

  UPDATE pelanggaran SET status = 'SUDAH_DITINDAKLANJUTI'
  WHERE sesi_id = p_sesi_id AND nis = p_nis AND status = 'BELUM_DITINDAKLANJUTI';

  INSERT INTO log_reset (nis, reset_oleh, alasan, password_baru, digunakan, sesi_id, reset_no)
  VALUES (
    p_nis,
    COALESCE(p_oleh, 'siswa'),
    'sesi:' || p_sesi_id || ' — Reset ke-' || p_nomor || ' digunakan',
    '-',
    TRUE,
    p_sesi_id,
    p_nomor
  );

  RETURN jsonb_build_object('hasil', 'OK', 'waktu_mulai', v_mulai, 'reset_terpakai', p_nomor);
END;
$$;

-- ── 4. Catat kode reset salah + lockout sementara (anti brute-force) ─────────
CREATE OR REPLACE FUNCTION catat_reset_gagal(
  p_sesi_id    TEXT,
  p_nis        TEXT,
  p_maks_gagal INT DEFAULT 5,
  p_menit      INT DEFAULT 5
)
RETURNS JSONB
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_gagal    INT;
  v_terkunci TIMESTAMPTZ;
BEGIN
  SELECT reset_gagal, reset_terkunci_sampai INTO v_gagal, v_terkunci
  FROM siswa_ujian
  WHERE sesi_id = p_sesi_id AND nis = p_nis
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('hasil', 'SISWA_TIDAK_TERDAFTAR');
  END IF;

  IF v_terkunci IS NOT NULL AND v_terkunci > NOW() THEN
    RETURN jsonb_build_object('hasil', 'DIKUNCI_SEMENTARA', 'sampai', v_terkunci);
  END IF;

  v_gagal := v_gagal + 1;

  IF v_gagal >= p_maks_gagal THEN
    UPDATE siswa_ujian
    SET reset_gagal = 0,
        reset_terkunci_sampai = NOW() + make_interval(mins => p_menit)
    WHERE sesi_id = p_sesi_id AND nis = p_nis;
    RETURN jsonb_build_object('hasil', 'DIKUNCI_SEMENTARA', 'menit', p_menit);
  END IF;

  UPDATE siswa_ujian SET reset_gagal = v_gagal
  WHERE sesi_id = p_sesi_id AND nis = p_nis;

  RETURN jsonb_build_object('hasil', 'SALAH', 'sisa', p_maks_gagal - v_gagal);
END;
$$;

-- ── 5. Hak akses: hanya service_role (API route) ─────────────────────────────
REVOKE ALL ON FUNCTION catat_pelanggaran_atomik(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, INT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION konsumsi_reset_berurutan(TEXT, TEXT, INT, INT, TEXT)               FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION catat_reset_gagal(TEXT, TEXT, INT, INT)                            FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION catat_pelanggaran_atomik(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, INT) TO service_role;
GRANT EXECUTE ON FUNCTION konsumsi_reset_berurutan(TEXT, TEXT, INT, INT, TEXT)               TO service_role;
GRANT EXECUTE ON FUNCTION catat_reset_gagal(TEXT, TEXT, INT, INT)                            TO service_role;
