-- =============================================================================
-- Migrasi 56: perbaikan hasil audit
--
-- 1) Jawaban susulan (setelah sesi ditutup) DITOLAK untuk siswa yang sudah
--    submit sendiri lewat /selesai. Penanda: kolom baru nilai.submit_mandiri,
--    diisi TRUE oleh finalisasi_pg_atomik() (jalur submit siswa sendiri).
--    Nilai yang dibuat jalur lain (finalisasi paksa oleh pengawas/admin, kunci
--    permanen) TIDAK diberi penanda, jadi siswa yang belum sempat submit tetap
--    bisa mengirim jawaban offline-nya yang sah (perilaku migrasi 55 tetap).
--
-- 2) Pengecekan device di 3 fungsi memakai IS DISTINCT FROM supaya aman kalau
--    p_device_id NULL (sebelumnya "<>" terhadap NULL bernilai NULL -> lolos).
--
-- Signature semua fungsi TIDAK berubah, jadi CREATE OR REPLACE cukup (tidak
-- perlu DROP). Aman dijalankan berulang.
--
-- PRASYARAT: migrasi 20, 33, 34, 55 sudah terpasang.
-- CATATAN: baris nilai yang dibuat SEBELUM migrasi ini punya submit_mandiri =
-- NULL, sehingga untuk sesi lama perilakunya tetap seperti migrasi 55. Hanya
-- submit baru setelah migrasi ini yang terlindungi.
-- =============================================================================

ALTER TABLE nilai ADD COLUMN IF NOT EXISTS submit_mandiri BOOLEAN;

COMMENT ON COLUMN nilai.submit_mandiri IS
  'TRUE = nilai dibuat dari submit siswa sendiri (/selesai). Dipakai menolak jawaban susulan setelah sesi ditutup.';

-- -----------------------------------------------------------------------------
-- finalisasi_pg_atomik (dasar: migrasi 33) + submit_mandiri + IS DISTINCT FROM
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION finalisasi_pg_atomik(
  p_sesi_id      TEXT,
  p_nis          TEXT,
  p_nilai        JSONB,
  p_essay_aktif  BOOLEAN,
  p_klaim_offline JSONB DEFAULT NULL,
  p_device_id    TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_sesi_status   TEXT;
  v_siswa_status  TEXT;
  v_siswa_device  TEXT;
  v_nilai_id      TEXT;
BEGIN
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

  SELECT status, device_id INTO v_siswa_status, v_siswa_device
  FROM siswa_ujian
  WHERE sesi_id = p_sesi_id AND nis = p_nis
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('hasil', 'SISWA_TIDAK_TERDAFTAR');
  END IF;

  IF v_siswa_status = 'RESET' THEN
    RETURN jsonb_build_object('hasil', 'SISWA_RESET');
  END IF;

  IF v_siswa_status = 'TERKUNCI' THEN
    RETURN jsonb_build_object('hasil', 'SISWA_TERKUNCI');
  END IF;

  IF v_siswa_device IS NOT NULL AND v_siswa_device IS DISTINCT FROM p_device_id THEN
    RETURN jsonb_build_object('hasil', 'DEVICE_LAIN');
  END IF;

  INSERT INTO nilai (id, sesi_id, nis, mapel_id, kelas, benar, total, nilai, grade, lulus, kkm, "timestamp", catatan_guru, submit_mandiri)
  VALUES (
    p_nilai->>'id',
    p_sesi_id,
    p_nis,
    p_nilai->>'mapel_id',
    p_nilai->>'kelas',
    COALESCE((p_nilai->>'benar')::int, 0),
    COALESCE((p_nilai->>'total')::int, 0),
    COALESCE((p_nilai->>'nilai')::numeric, 0),
    p_nilai->>'grade',
    COALESCE((p_nilai->>'lulus')::boolean, FALSE),
    COALESCE((p_nilai->>'kkm')::int, 75),
    COALESCE((p_nilai->>'timestamp')::timestamptz, NOW()),
    p_nilai->>'catatan_guru',
    TRUE
  )
  ON CONFLICT (sesi_id, nis) DO NOTHING;

  IF p_essay_aktif THEN
    UPDATE siswa_ujian
    SET status_essay = 'BELUM_MULAI'
    WHERE sesi_id = p_sesi_id
      AND nis = p_nis
      AND (status_essay IS NULL OR status_essay = 'BELUM_MULAI');
  ELSE
    UPDATE siswa_ujian
    SET status = 'SELESAI',
        waktu_selesai = NOW()
    WHERE sesi_id = p_sesi_id AND nis = p_nis;
  END IF;

  IF p_klaim_offline IS NOT NULL THEN
    UPDATE siswa_ujian
    SET pg_selesai_offline     = TRUE,
        pg_waktu_selesai_klaim = (p_klaim_offline->>'waktu_klaim')::timestamptz,
        pg_offline_audit       = p_klaim_offline->'audit'
    WHERE sesi_id = p_sesi_id AND nis = p_nis;
  END IF;

  SELECT id INTO v_nilai_id
  FROM nilai
  WHERE sesi_id = p_sesi_id AND nis = p_nis;

  RETURN jsonb_build_object('hasil', 'OK', 'nilai_id', v_nilai_id);
END;
$$;

REVOKE ALL ON FUNCTION finalisasi_pg_atomik(TEXT, TEXT, JSONB, BOOLEAN, JSONB, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION finalisasi_pg_atomik(TEXT, TEXT, JSONB, BOOLEAN, JSONB, TEXT) TO service_role;

-- -----------------------------------------------------------------------------
-- sync_jawaban_atomik (dasar: migrasi 34) + IS DISTINCT FROM
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION sync_jawaban_atomik(
  p_sesi_id   TEXT,
  p_nis       TEXT,
  p_device_id TEXT,
  p_records   JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_sesi_status  TEXT;
  v_siswa_status TEXT;
  v_siswa_device TEXT;
  v_acked        JSONB;
BEGIN
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

  SELECT status, device_id INTO v_siswa_status, v_siswa_device
  FROM siswa_ujian
  WHERE sesi_id = p_sesi_id AND nis = p_nis
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('hasil', 'SISWA_TIDAK_TERDAFTAR');
  END IF;

  IF v_siswa_status = 'RESET' THEN
    RETURN jsonb_build_object('hasil', 'SISWA_RESET');
  END IF;

  IF v_siswa_status = 'TERKUNCI' THEN
    RETURN jsonb_build_object('hasil', 'SISWA_TERKUNCI');
  END IF;

  IF v_siswa_device IS NOT NULL AND v_siswa_device IS DISTINCT FROM p_device_id THEN
    RETURN jsonb_build_object('hasil', 'DEVICE_LAIN');
  END IF;

  IF p_records IS NULL OR jsonb_array_length(p_records) = 0 THEN
    RETURN jsonb_build_object('hasil', 'OK', 'acked', '[]'::jsonb);
  END IF;

  WITH input AS (
    SELECT
      (r->>'soal_id')::text AS soal_id,
      (r->>'jawaban')::text AS jawaban,
      COALESCE((r->>'revisi')::int, 0) AS revisi
    FROM jsonb_array_elements(p_records) AS r
  ),
  upserted AS (
    INSERT INTO jawaban (sesi_id, nis, soal_id, jawaban, revisi, updated_at, sync_status, local_timestamp)
    SELECT p_sesi_id, p_nis, soal_id, jawaban, revisi, NOW(), 'SYNCED',
           (EXTRACT(EPOCH FROM NOW()) * 1000)::bigint
    FROM input
    ON CONFLICT (sesi_id, nis, soal_id) DO UPDATE
      SET jawaban         = EXCLUDED.jawaban,
          revisi          = EXCLUDED.revisi,
          updated_at      = NOW(),
          sync_status     = 'SYNCED',
          local_timestamp = EXCLUDED.local_timestamp
      WHERE EXCLUDED.revisi > jawaban.revisi
    RETURNING soal_id, jawaban, revisi
  )
  SELECT jsonb_agg(jsonb_build_object(
    'out_soal_id', i.soal_id,
    'out_jawaban', COALESCE(u.jawaban, j.jawaban, i.jawaban),
    'out_revisi', COALESCE(u.revisi, j.revisi, i.revisi),
    'out_accepted', (u.soal_id IS NOT NULL)
  ))
  INTO v_acked
  FROM input i
  LEFT JOIN upserted u ON u.soal_id = i.soal_id
  LEFT JOIN jawaban j
    ON j.sesi_id = p_sesi_id AND j.nis = p_nis AND j.soal_id = i.soal_id
   AND u.soal_id IS NULL;

  RETURN jsonb_build_object('hasil', 'OK', 'acked', COALESCE(v_acked, '[]'::jsonb));
END;
$$;

REVOKE ALL ON FUNCTION sync_jawaban_atomik(TEXT, TEXT, TEXT, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION sync_jawaban_atomik(TEXT, TEXT, TEXT, JSONB) TO service_role;

-- -----------------------------------------------------------------------------
-- sync_jawaban_susulan_atomik (dasar: migrasi 55)
--   + IS DISTINCT FROM
--   + tolak kalau siswa sudah submit sendiri (hasil 'SUDAH_SUBMIT')
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION sync_jawaban_susulan_atomik(
  p_sesi_id      TEXT,
  p_nis          TEXT,
  p_device_id    TEXT,
  p_records      JSONB,
  p_jendela_jam  INT DEFAULT 24
)
RETURNS JSONB
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_sesi_status  TEXT;
  v_sesi_selesai TIMESTAMPTZ;
  v_siswa_status TEXT;
  v_siswa_device TEXT;
  v_acked        JSONB;
  v_berubah      INT := 0;
BEGIN
  SELECT status, waktu_selesai INTO v_sesi_status, v_sesi_selesai
  FROM sesi_ujian
  WHERE id = p_sesi_id
  FOR SHARE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('hasil', 'SESI_TIDAK_ADA');
  END IF;

  IF v_sesi_status = 'BERJALAN' THEN
    RETURN jsonb_build_object('hasil', 'SESI_MASIH_BERJALAN');
  END IF;

  IF v_sesi_status <> 'SELESAI' THEN
    RETURN jsonb_build_object('hasil', 'SESI_DITUTUP');
  END IF;

  IF v_sesi_selesai IS NULL
     OR NOW() > v_sesi_selesai + make_interval(hours => GREATEST(p_jendela_jam, 0)) THEN
    RETURN jsonb_build_object('hasil', 'JENDELA_HABIS');
  END IF;

  SELECT status, device_id INTO v_siswa_status, v_siswa_device
  FROM siswa_ujian
  WHERE sesi_id = p_sesi_id AND nis = p_nis
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('hasil', 'SISWA_TIDAK_TERDAFTAR');
  END IF;

  IF v_siswa_status = 'RESET' THEN
    RETURN jsonb_build_object('hasil', 'SISWA_RESET');
  END IF;

  IF v_siswa_status = 'TERKUNCI' THEN
    RETURN jsonb_build_object('hasil', 'SISWA_TERKUNCI');
  END IF;

  IF v_siswa_device IS NOT NULL AND v_siswa_device IS DISTINCT FROM p_device_id THEN
    RETURN jsonb_build_object('hasil', 'DEVICE_LAIN');
  END IF;

  -- BARU (migrasi 56): siswa yang sudah submit sendiri tidak boleh mengubah
  -- jawabannya setelah sesi ditutup. Jawaban siswa yang submit online sudah
  -- terverifikasi sinkron oleh client sebelum /selesai dipanggil, jadi tidak
  -- ada jawaban sah yang hilang karena penolakan ini.
  IF EXISTS (
    SELECT 1 FROM nilai
    WHERE sesi_id = p_sesi_id AND nis = p_nis AND submit_mandiri IS TRUE
  ) THEN
    RETURN jsonb_build_object('hasil', 'SUDAH_SUBMIT');
  END IF;

  IF p_records IS NULL OR jsonb_array_length(p_records) = 0 THEN
    RETURN jsonb_build_object('hasil', 'OK', 'acked', '[]'::jsonb, 'jumlah_berubah', 0);
  END IF;

  WITH input AS (
    SELECT
      (r->>'soal_id')::text AS soal_id,
      (r->>'jawaban')::text AS jawaban,
      COALESCE((r->>'revisi')::int, 0) AS revisi
    FROM jsonb_array_elements(p_records) AS r
  ),
  upserted AS (
    INSERT INTO jawaban (sesi_id, nis, soal_id, jawaban, revisi, updated_at, sync_status, local_timestamp)
    SELECT p_sesi_id, p_nis, soal_id, jawaban, revisi, NOW(), 'SYNCED',
           (EXTRACT(EPOCH FROM NOW()) * 1000)::bigint
    FROM input
    ON CONFLICT (sesi_id, nis, soal_id) DO UPDATE
      SET jawaban         = EXCLUDED.jawaban,
          revisi          = EXCLUDED.revisi,
          updated_at      = NOW(),
          sync_status     = 'SYNCED',
          local_timestamp = EXCLUDED.local_timestamp
      WHERE EXCLUDED.revisi > jawaban.revisi
    RETURNING soal_id, jawaban, revisi
  )
  SELECT jsonb_agg(jsonb_build_object(
    'out_soal_id', i.soal_id,
    'out_jawaban', COALESCE(u.jawaban, j.jawaban, i.jawaban),
    'out_revisi', COALESCE(u.revisi, j.revisi, i.revisi),
    'out_accepted', (u.soal_id IS NOT NULL)
  ))
  INTO v_acked
  FROM input i
  LEFT JOIN upserted u ON u.soal_id = i.soal_id
  LEFT JOIN jawaban j
    ON j.sesi_id = p_sesi_id AND j.nis = p_nis AND j.soal_id = i.soal_id
   AND u.soal_id IS NULL;

  SELECT COUNT(*) INTO v_berubah
  FROM jsonb_array_elements(COALESCE(v_acked, '[]'::jsonb)) AS e
  WHERE (e->>'out_accepted')::boolean;

  RETURN jsonb_build_object(
    'hasil', 'OK',
    'acked', COALESCE(v_acked, '[]'::jsonb),
    'jumlah_berubah', v_berubah
  );
END;
$$;

REVOKE ALL ON FUNCTION sync_jawaban_susulan_atomik(TEXT, TEXT, TEXT, JSONB, INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION sync_jawaban_susulan_atomik(TEXT, TEXT, TEXT, JSONB, INT) TO service_role;
