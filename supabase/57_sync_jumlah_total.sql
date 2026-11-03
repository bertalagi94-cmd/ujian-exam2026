-- =============================================================================
-- Migrasi 57: sync_jawaban_atomik mengembalikan jumlah_total
--
-- TUJUAN (PERF): setelah fungsi ini selesai, /api/siswa/ujian/sync dulu
-- menjalankan SATU query lagi hanya untuk menghitung jumlah jawaban siswa
-- (SELECT count(*) FROM jawaban WHERE sesi_id=... AND nis=...) sebagai
-- `totalSynced`. Pada load test query itu muncul ~111 ribu kali. Sekarang angka
-- yang sama dihitung di akhir fungsi (di transaksi yang sama) dan dikembalikan
-- sebagai field `jumlah_total` -- satu round-trip ke database per sync hilang.
--
-- YANG BERUBAH: hanya ditambah variabel v_total + SELECT count(*) sebelum RETURN,
-- dan field 'jumlah_total' pada hasil 'OK'.
-- YANG TIDAK BERUBAH: urutan kunci baris, cek status/device/reset, aturan revisi
-- (WHERE EXCLUDED.revisi > jawaban.revisi), isi upsert, dan hak akses.
--
-- AMAN DIJALANKAN KAPAN SAJA: CREATE OR REPLACE selesai seketika. Kode route
-- memakai jumlah_total kalau ada, dan kembali ke query count lama kalau tidak
-- ada, jadi urutan deploy kode dan SQL tidak masalah.
--
-- CARA MENJALANKAN: tempel seluruh file ini di Supabase SQL Editor, Run satu kali.
--
-- CARA MEMBATALKAN: jalankan lagi blok `sync_jawaban_atomik` dari
-- supabase/56_perbaikan_audit.sql (baris "CREATE OR REPLACE FUNCTION
-- sync_jawaban_atomik" sampai GRANT-nya). Route tetap jalan karena ada fallback.
--
-- CAKUPAN: hanya sync_jawaban_atomik (sesi BERJALAN). sync_jawaban_susulan_atomik
-- TIDAK diubah; route memakai query count lama untuk jalur susulan.
-- =============================================================================

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
  v_total        INT;
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
    SELECT count(*) INTO v_total
    FROM jawaban
    WHERE sesi_id = p_sesi_id AND nis = p_nis;

    RETURN jsonb_build_object('hasil', 'OK', 'acked', '[]'::jsonb, 'jumlah_total', v_total);
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

  -- Ground truth jumlah jawaban siswa ini SETELAH upsert, di transaksi yang sama
  -- (menggantikan SELECT count(*) terpisah di route /sync).
  SELECT count(*) INTO v_total
  FROM jawaban
  WHERE sesi_id = p_sesi_id AND nis = p_nis;

  RETURN jsonb_build_object(
    'hasil', 'OK',
    'acked', COALESCE(v_acked, '[]'::jsonb),
    'jumlah_total', v_total
  );
END;
$$;

REVOKE ALL ON FUNCTION sync_jawaban_atomik(TEXT, TEXT, TEXT, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION sync_jawaban_atomik(TEXT, TEXT, TEXT, JSONB) TO service_role;
