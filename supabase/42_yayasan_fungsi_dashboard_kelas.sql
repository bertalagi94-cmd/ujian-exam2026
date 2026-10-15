-- 42_yayasan_fungsi_dashboard_kelas.sql  (Fase 2 multi-yayasan)
--
-- Dua fungsi database tadinya bekerja pada SELURUH database:
--  1) get_dashboard_stats()    -> rata-rata nilai dashboard mencampur semua yayasan.
--  2) hapus_kelas_atomik()     -> menghapus siswa berdasarkan NAMA kelas saja.
--     Sejak migrasi 41 dua yayasan boleh punya kelas "7A"; tanpa perbaikan ini,
--     menghapus "7A" di satu yayasan ikut menghapus siswa + nilai "7A" yayasan lain.
--
-- Kedua fungsi diberi parameter yayasan. Kalau parameter tidak dikirim (NULL),
-- perilakunya sama persis seperti sebelumnya, jadi AMAN dijalankan SEBELUM kode
-- baru dipasang. Jalankan saat tidak ada ujian.

-- ── 1) get_dashboard_stats(p_yayasan_id) ────────────────────────────────────
DROP FUNCTION IF EXISTS public.get_dashboard_stats();

CREATE OR REPLACE FUNCTION public.get_dashboard_stats(p_yayasan_id TEXT DEFAULT NULL)
RETURNS json
LANGUAGE sql
STABLE
SET search_path = public
AS $function$
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
    WHERE p_yayasan_id IS NULL OR n.yayasan_id = p_yayasan_id
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
  FROM nilai_efektif;
$function$;

REVOKE ALL ON FUNCTION public.get_dashboard_stats(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_dashboard_stats(TEXT) TO service_role;

-- ── 2) hapus_kelas_atomik(p_nama, p_kelas_id, p_yayasan_id) ─────────────────
DROP FUNCTION IF EXISTS public.hapus_kelas_atomik(TEXT, TEXT);

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
  PERFORM 1 FROM siswa
    WHERE kelas = p_nama AND (p_yayasan_id IS NULL OR yayasan_id = p_yayasan_id)
    FOR UPDATE;

  SELECT COUNT(*) INTO v_jumlah_siswa FROM siswa
    WHERE kelas = p_nama AND (p_yayasan_id IS NULL OR yayasan_id = p_yayasan_id);

  DELETE FROM pelanggaran          WHERE nis IN (SELECT nis FROM siswa WHERE kelas = p_nama AND (p_yayasan_id IS NULL OR yayasan_id = p_yayasan_id));
  DELETE FROM log_reset            WHERE nis IN (SELECT nis FROM siswa WHERE kelas = p_nama AND (p_yayasan_id IS NULL OR yayasan_id = p_yayasan_id));
  DELETE FROM nilai                WHERE nis IN (SELECT nis FROM siswa WHERE kelas = p_nama AND (p_yayasan_id IS NULL OR yayasan_id = p_yayasan_id));
  DELETE FROM jawaban              WHERE nis IN (SELECT nis FROM siswa WHERE kelas = p_nama AND (p_yayasan_id IS NULL OR yayasan_id = p_yayasan_id));
  DELETE FROM jawaban_essay        WHERE nis IN (SELECT nis FROM siswa WHERE kelas = p_nama AND (p_yayasan_id IS NULL OR yayasan_id = p_yayasan_id));
  DELETE FROM jawaban_essay_foto   WHERE nis IN (SELECT nis FROM siswa WHERE kelas = p_nama AND (p_yayasan_id IS NULL OR yayasan_id = p_yayasan_id));
  DELETE FROM skor_essay_siswa     WHERE nis IN (SELECT nis FROM siswa WHERE kelas = p_nama AND (p_yayasan_id IS NULL OR yayasan_id = p_yayasan_id));
  DELETE FROM essay_amplop_offline WHERE nis IN (SELECT nis FROM siswa WHERE kelas = p_nama AND (p_yayasan_id IS NULL OR yayasan_id = p_yayasan_id));
  DELETE FROM siswa_ujian          WHERE nis IN (SELECT nis FROM siswa WHERE kelas = p_nama AND (p_yayasan_id IS NULL OR yayasan_id = p_yayasan_id));
  DELETE FROM siswa                WHERE kelas = p_nama AND (p_yayasan_id IS NULL OR yayasan_id = p_yayasan_id);

  IF p_kelas_id IS NOT NULL THEN
    DELETE FROM kelas WHERE id = p_kelas_id AND (p_yayasan_id IS NULL OR yayasan_id = p_yayasan_id);
  ELSE
    DELETE FROM kelas WHERE nama = p_nama AND (p_yayasan_id IS NULL OR yayasan_id = p_yayasan_id);
  END IF;

  RETURN jsonb_build_object('hasil', 'OK', 'jumlah_siswa', v_jumlah_siswa);
END;
$$;

REVOKE ALL ON FUNCTION public.hapus_kelas_atomik(TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.hapus_kelas_atomik(TEXT, TEXT, TEXT) TO service_role;

-- ── 3) Kolom yayasan_id di tabel pelanggaran ────────────────────────────────
-- Tabel ini tidak punya relasi ke sesi_ujian, jadi daftar/ubah/hapus pelanggaran
-- di panel admin tidak bisa dibatasi per yayasan. Kolom ini diisi otomatis dari
-- sesi_ujian oleh trigger (juga untuk baris yang dibuat fungsi catat_pelanggaran_atomik).
ALTER TABLE pelanggaran ADD COLUMN IF NOT EXISTS yayasan_id TEXT;

UPDATE pelanggaran p
   SET yayasan_id = s.yayasan_id
  FROM sesi_ujian s
 WHERE s.id = p.sesi_id AND p.yayasan_id IS NULL;

UPDATE pelanggaran SET yayasan_id = 'YYS_AWAL' WHERE yayasan_id IS NULL;

CREATE OR REPLACE FUNCTION public.set_yayasan_pelanggaran_dari_sesi()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_yayasan TEXT;
BEGIN
  SELECT yayasan_id INTO v_yayasan FROM sesi_ujian WHERE id = NEW.sesi_id;
  NEW.yayasan_id := COALESCE(v_yayasan, NEW.yayasan_id, 'YYS_AWAL');
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.set_yayasan_pelanggaran_dari_sesi() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_yayasan_pelanggaran_dari_sesi() TO service_role;

DROP TRIGGER IF EXISTS trg_pelanggaran_yayasan ON pelanggaran;
CREATE TRIGGER trg_pelanggaran_yayasan
  BEFORE INSERT ON pelanggaran
  FOR EACH ROW EXECUTE FUNCTION public.set_yayasan_pelanggaran_dari_sesi();

CREATE INDEX IF NOT EXISTS idx_pelanggaran_yayasan ON pelanggaran (yayasan_id);

-- Cek setelah dijalankan (keduanya harus 0):
-- select count(*) from pelanggaran where yayasan_id is null;
-- select count(*) from pelanggaran p join sesi_ujian s on s.id = p.sesi_id
--   where p.yayasan_id is distinct from s.yayasan_id;
