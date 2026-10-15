-- 40_yayasan_trigger_nilai.sql  (Fase 2 multi-yayasan)
--
-- MASALAH: fungsi database (finalisasi_pg_atomik, dll.) menulis baris `nilai`
-- tanpa yayasan_id, sehingga terisi DEFAULT 'YYS_AWAL'. Untuk yayasan lain,
-- nilai siswa akan "masuk" ke yayasan yang salah dan tidak tampil di aplikasi.
--
-- SOLUSI: trigger yang menyalin yayasan_id dari sesi_ujian (sumber kebenaran)
-- setiap kali baris nilai dibuat. Aman dijalankan berulang. Tidak mengubah data
-- lama (semua data lama memang milik YYS_AWAL).
-- Jalankan di Supabase SQL Editor SAAT TIDAK ADA UJIAN.

CREATE OR REPLACE FUNCTION public.set_yayasan_nilai_dari_sesi()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_yayasan TEXT;
BEGIN
  SELECT yayasan_id INTO v_yayasan FROM sesi_ujian WHERE id = NEW.sesi_id;
  IF v_yayasan IS NOT NULL THEN
    NEW.yayasan_id := v_yayasan;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.set_yayasan_nilai_dari_sesi() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_yayasan_nilai_dari_sesi() TO service_role;

DROP TRIGGER IF EXISTS trg_nilai_yayasan ON nilai;
CREATE TRIGGER trg_nilai_yayasan
  BEFORE INSERT ON nilai
  FOR EACH ROW EXECUTE FUNCTION public.set_yayasan_nilai_dari_sesi();

-- Cek setelah dijalankan (harus 0 baris):
-- select n.id from nilai n join sesi_ujian s on s.id = n.sesi_id
--   where n.yayasan_id is distinct from s.yayasan_id;
