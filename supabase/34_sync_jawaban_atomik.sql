-- =============================================================================
-- Migrasi 34: sync_jawaban_atomik -- cek status/device ATOMIK dengan simpan jawaban
--
-- LATAR BELAKANG (audit, race condition /sync):
-- POST /api/siswa/ujian/sync sudah memeriksa, sebelum menyimpan jawaban:
--   - status sesi masih BERJALAN?
--   - status siswa masih aktif (bukan TERKUNCI/RESET)?
--   - device_id masih device yang sah?
-- Tapi pengecekan itu adalah query SELECT biasa (tanpa row lock), TERPISAH
-- dari panggilan sync_jawaban_revisi() (migrasi 20) yang benar-benar menulis
-- baris jawaban. Antara "cek lolos" dan "tulis jawaban" ada jendela waktu:
--
--   T1  /sync baca status sesi = BERJALAN
--   T2  pengawas menutup sesi (atau: device lain ambil alih / siswa di-RESET)
--   T3  /sync (request yang SAMA, cek-nya sudah lolos di T1) tetap menjalankan
--       sync_jawaban_revisi() dan menulis jawaban
--
-- Ini BUKAN bug yang mudah terjadi pada pemakaian normal (jendelanya sangat
-- sempit), tapi celahnya nyata secara concurrency -- sama seperti yang sudah
-- ditutup untuk /selesai lewat finalisasi_pg_atomik (migrasi 21/28/33).
--
-- FIX: fungsi baru sync_jawaban_atomik() melakukan HAL YANG SAMA seperti
-- finalisasi_pg_atomik -- mengunci baris sesi_ujian (FOR SHARE) dan
-- siswa_ujian (FOR UPDATE), mengecek ULANG status & device_id DI DALAM
-- transaksi yang sama, BARU kemudian menjalankan upsert jawaban (logika
-- upsert-nya sama persis dengan sync_jawaban_revisi migrasi 20: revisi lebih
-- besar menang, tidak peduli urutan kedatangan request).
--
-- sync_jawaban_revisi() (migrasi 20) TIDAK dihapus/diubah -- tetap ada untuk
-- kompatibilitas mundur & karena preflight migrasi 23 mensyaratkannya ada.
-- route.ts diperbarui untuk memanggil fungsi BARU ini, bukan yang lama.
--
-- p_records: jsonb array, tiap elemen SUDAH divalidasi/disaring oleh route.ts
-- (soal_id termasuk paket sesi ini, sudah lolos saringan "jawaban terlambat")
-- sebelum dikirim ke sini -- fungsi ini murni titik kunci ATOMIK untuk
-- otorisasi + penulisan, bukan tempat validasi bisnis lain.
--
-- Aman dijalankan berulang (CREATE OR REPLACE).
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
BEGIN
  -- 1) Kunci baris sesi (shared) + cek status di DALAM transaksi -- sama
  -- seperti finalisasi_pg_atomik, supaya penutupan sesi oleh pengawas tidak
  -- bisa menyelip di antara "cek BERJALAN" dan "tulis jawaban".
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

  -- 2) Kunci baris siswa (exclusive) -> serialisasi request sync ganda siswa
  -- ini, dan cek ULANG status/device di titik yang sama dengan penulisan.
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

  -- Sama seperti pola guard device_id di /sync & /selesai: hanya menolak
  -- kalau ADA device_id terdaftar di DB dan BEDA dengan yang dikirim.
  IF v_siswa_device IS NOT NULL AND v_siswa_device <> p_device_id THEN
    RETURN jsonb_build_object('hasil', 'DEVICE_LAIN');
  END IF;

  -- 3) Semua cek lolos SAMBIL baris masih terkunci -- baru sekarang aman
  -- menulis jawaban. Kalau tidak ada records (mis. semua jawaban di-filter
  -- karena terlambat sebelum sampai sini), kembalikan OK tanpa upsert.
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
      -- Inti perlindungan revisi (sama seperti migrasi 20): request lama yang
      -- terlambat sampai TIDAK diizinkan menimpa revisi yang lebih tinggi.
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

-- Fungsi ini MENULIS jawaban siswa: jangan bisa dipanggil lewat anon key
-- publik -- sama seperti alasan sync_jawaban_revisi direvoke di migrasi 23.
REVOKE ALL ON FUNCTION sync_jawaban_atomik(TEXT, TEXT, TEXT, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION sync_jawaban_atomik(TEXT, TEXT, TEXT, JSONB) TO service_role;
