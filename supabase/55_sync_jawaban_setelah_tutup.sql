-- =============================================================================
-- Migrasi 55: sync_jawaban_susulan_atomik -- terima jawaban offline yang
-- terlambat sampai SETELAH sesi ditutup (dalam jendela waktu terbatas)
--
-- LATAR BELAKANG:
-- Prinsip: jawaban yang dibuat siswa SEBELUM waktunya habis tidak boleh hilang
-- hanya karena HP-nya offline dan baru terkirim setelah pengawas menutup sesi.
-- Sebelumnya /api/siswa/ujian/sync menolak semua jawaban begitu
-- sesi_ujian.status <> 'BERJALAN' (409 "Sesi ujian sudah ditutup"), sehingga
-- jawaban offline yang sah ikut hilang.
--
-- Fungsi ini MELENGKAPI sync_jawaban_atomik() (migrasi 34), TIDAK menggantikannya.
-- Bedanya HANYA di pengecekan sesi:
--   - sync_jawaban_atomik         : sesi harus BERJALAN.
--   - sync_jawaban_susulan_atomik : sesi harus SELESAI dan waktu_selesai-nya
--                                   belum lewat p_jendela_jam jam (bawaan 24).
-- Pengecekan siswa (RESET/TERKUNCI/device) dan logika upsert (revisi lebih
-- besar menang) SAMA PERSIS dengan migrasi 34.
--
-- Validasi bisnis (bukti waktu jawaban dibuat SEBELUM batas siswa, soal_id
-- sah, jeda offline nyata) tetap dilakukan route.ts lewat
-- saringJawabanTerlambat() di src/lib/deadline-pg.ts -- fungsi ini murni titik
-- kunci ATOMIK untuk otorisasi + penulisan.
--
-- Mengembalikan juga 'jumlah_berubah' (berapa baris jawaban benar-benar
-- berubah/ditambah) supaya route.ts tahu apakah nilai PG perlu dihitung ulang.
--
-- Aman dijalankan berulang (CREATE OR REPLACE). Tidak mengubah tabel apa pun.
-- =============================================================================

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
  -- 1) Kunci baris sesi (shared) dan cek status + jendela waktu di DALAM
  -- transaksi (pola sama dengan migrasi 34).
  SELECT status, waktu_selesai INTO v_sesi_status, v_sesi_selesai
  FROM sesi_ujian
  WHERE id = p_sesi_id
  FOR SHARE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('hasil', 'SESI_TIDAK_ADA');
  END IF;

  -- Sesi masih berjalan: ini BUKAN jalur susulan. Caller harus memakai
  -- sync_jawaban_atomik() biasa.
  IF v_sesi_status = 'BERJALAN' THEN
    RETURN jsonb_build_object('hasil', 'SESI_MASIH_BERJALAN');
  END IF;

  IF v_sesi_status <> 'SELESAI' THEN
    RETURN jsonb_build_object('hasil', 'SESI_DITUTUP');
  END IF;

  -- Jendela penerimaan jawaban susulan. Tanpa waktu_selesai tercatat kita
  -- tidak bisa membuktikan sesi baru ditutup, jadi ditolak (fail closed).
  IF v_sesi_selesai IS NULL
     OR NOW() > v_sesi_selesai + make_interval(hours => GREATEST(p_jendela_jam, 0)) THEN
    RETURN jsonb_build_object('hasil', 'JENDELA_HABIS');
  END IF;

  -- 2) Kunci baris siswa (exclusive) dan cek status/device.
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

  -- Siswa yang gugur total karena pelanggaran berat tidak menerima jawaban
  -- susulan (nilai tetap 0 sesuai aturan gugur total).
  IF v_siswa_status = 'TERKUNCI' THEN
    RETURN jsonb_build_object('hasil', 'SISWA_TERKUNCI');
  END IF;

  IF v_siswa_device IS NOT NULL AND v_siswa_device <> p_device_id THEN
    RETURN jsonb_build_object('hasil', 'DEVICE_LAIN');
  END IF;

  IF p_records IS NULL OR jsonb_array_length(p_records) = 0 THEN
    RETURN jsonb_build_object('hasil', 'OK', 'acked', '[]'::jsonb, 'jumlah_berubah', 0);
  END IF;

  -- 3) Upsert: logika IDENTIK dengan sync_jawaban_atomik (migrasi 34).
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

-- Fungsi ini MENULIS jawaban siswa: hanya service role (API route) yang boleh.
REVOKE ALL ON FUNCTION sync_jawaban_susulan_atomik(TEXT, TEXT, TEXT, JSONB, INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION sync_jawaban_susulan_atomik(TEXT, TEXT, TEXT, JSONB, INT) TO service_role;
