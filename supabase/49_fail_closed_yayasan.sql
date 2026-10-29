-- 49_fail_closed_yayasan.sql
--
-- Mengubah dua fungsi dari migrasi 42 menjadi FAIL-CLOSED:
--   * get_dashboard_stats(p_yayasan_id)
--   * hapus_kelas_atomik(p_nama, p_kelas_id, p_yayasan_id)
--
-- Sebelumnya p_yayasan_id NULL berarti "semua yayasan" (dibiarkan supaya
-- migrasi 42 aman dijalankan sebelum kode baru terpasang). Kode baru sudah
-- terpasang dan SELALU mengirim yayasan (admin/kelas, admin/dashboard), jadi
-- NULL sekarang ditolak dengan error — bukan menghapus/membaca lintas yayasan.
--
-- Perilaku untuk pemanggil yang mengirim p_yayasan_id TIDAK berubah.
-- Signature (termasuk DEFAULT NULL) sengaja dipertahankan: CREATE OR REPLACE
-- tidak boleh menghapus default parameter, dan grant lama tetap berlaku.
--
-- PRASYARAT: deploy kode aplikasi versi saat ini lebih dulu (yang mengirim
-- p_yayasan_id). Jalankan saat tidak ada ujian. Aman dijalankan berulang.

-- ── 1) get_dashboard_stats ──────────────────────────────────────────────────
-- Tadinya LANGUAGE sql; diubah ke plpgsql supaya bisa RAISE EXCEPTION.
-- Isi query dan bentuk JSON hasil sama persis dengan migrasi 42.
CREATE OR REPLACE FUNCTION public.get_dashboard_stats(p_yayasan_id TEXT DEFAULT NULL)
RETURNS json
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $function$
BEGIN
  IF p_yayasan_id IS NULL OR p_yayasan_id = '' THEN
    RAISE EXCEPTION 'yayasan_id wajib diisi' USING ERRCODE = '22023';
  END IF;

  RETURN (
    WITH nilai_efektif AS (
      SELECT
        n.mapel_id,
        CASE
          WHEN COALESCE((su.info_json->>'essay_aktif')::boolean, false)
               AND n.dirilis IS TRUE
               AND n.nilai_total IS NOT NULL
          THEN n.nilai_total
          ELSE n.nilai
        END AS nilai_pakai
      FROM nilai n
      LEFT JOIN sesi_ujian su ON su.id = n.sesi_id
      WHERE n.yayasan_id = p_yayasan_id
    )
    SELECT json_build_object(
      'rata_rata_nilai', ROUND(AVG(nilai_pakai)::numeric, 0),
      'nilai_per_mapel', (
        SELECT json_agg(x ORDER BY x.total DESC) FROM (
          SELECT mapel_id, ROUND(AVG(nilai_pakai)::numeric, 0) AS rata, COUNT(*) AS total
          FROM nilai_efektif
          GROUP BY mapel_id
          ORDER BY total DESC
          LIMIT 10
        ) x
      )
    )
    FROM nilai_efektif
  );
END;
$function$;

-- ── 2) hapus_kelas_atomik ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.hapus_kelas_atomik(
  p_nama TEXT,
  p_kelas_id TEXT DEFAULT NULL,
  p_yayasan_id TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_jumlah_siswa INTEGER;
BEGIN
  IF p_yayasan_id IS NULL OR p_yayasan_id = '' THEN
    RAISE EXCEPTION 'yayasan_id wajib diisi' USING ERRCODE = '22023';
  END IF;

  PERFORM 1 FROM siswa
    WHERE kelas = p_nama AND yayasan_id = p_yayasan_id
    FOR UPDATE;

  SELECT COUNT(*) INTO v_jumlah_siswa FROM siswa
    WHERE kelas = p_nama AND yayasan_id = p_yayasan_id;

  DELETE FROM pelanggaran          WHERE nis IN (SELECT nis FROM siswa WHERE kelas = p_nama AND yayasan_id = p_yayasan_id);
  DELETE FROM log_reset            WHERE nis IN (SELECT nis FROM siswa WHERE kelas = p_nama AND yayasan_id = p_yayasan_id);
  DELETE FROM nilai                WHERE nis IN (SELECT nis FROM siswa WHERE kelas = p_nama AND yayasan_id = p_yayasan_id);
  DELETE FROM jawaban              WHERE nis IN (SELECT nis FROM siswa WHERE kelas = p_nama AND yayasan_id = p_yayasan_id);
  DELETE FROM jawaban_essay        WHERE nis IN (SELECT nis FROM siswa WHERE kelas = p_nama AND yayasan_id = p_yayasan_id);
  DELETE FROM jawaban_essay_foto   WHERE nis IN (SELECT nis FROM siswa WHERE kelas = p_nama AND yayasan_id = p_yayasan_id);
  DELETE FROM skor_essay_siswa     WHERE nis IN (SELECT nis FROM siswa WHERE kelas = p_nama AND yayasan_id = p_yayasan_id);
  DELETE FROM essay_amplop_offline WHERE nis IN (SELECT nis FROM siswa WHERE kelas = p_nama AND yayasan_id = p_yayasan_id);
  DELETE FROM siswa_ujian          WHERE nis IN (SELECT nis FROM siswa WHERE kelas = p_nama AND yayasan_id = p_yayasan_id);
  DELETE FROM siswa                WHERE kelas = p_nama AND yayasan_id = p_yayasan_id;

  IF p_kelas_id IS NOT NULL THEN
    DELETE FROM kelas WHERE id = p_kelas_id AND yayasan_id = p_yayasan_id;
  ELSE
    DELETE FROM kelas WHERE nama = p_nama AND yayasan_id = p_yayasan_id;
  END IF;

  RETURN jsonb_build_object('hasil', 'OK', 'jumlah_siswa', v_jumlah_siswa);
END;
$$;

-- Grant dari migrasi 42 tetap berlaku (CREATE OR REPLACE tidak mengubahnya);
-- dinyatakan ulang agar file ini mandiri.
REVOKE ALL ON FUNCTION public.get_dashboard_stats(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_dashboard_stats(TEXT) TO service_role;
REVOKE ALL ON FUNCTION public.hapus_kelas_atomik(TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.hapus_kelas_atomik(TEXT, TEXT, TEXT) TO service_role;

-- Cek setelah dijalankan (keduanya harus error 'yayasan_id wajib diisi'):
-- select public.get_dashboard_stats(null);
-- select public.hapus_kelas_atomik('ZZ-TEST', null, null);
