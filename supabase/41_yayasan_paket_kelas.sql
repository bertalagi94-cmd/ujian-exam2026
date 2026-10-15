-- 41_yayasan_paket_kelas.sql  (Fase 2 multi-yayasan)
--
-- 1) paket_soal dibuat lewat fungsi database buat_paket_soal_atomik() tanpa
--    yayasan_id -> terisi DEFAULT 'YYS_AWAL' (salah untuk yayasan lain).
--    Trigger ini menyalin yayasan_id dari mapel-nya.
-- 2) Nama kelas tadinya unik di seluruh database; sekarang unik PER YAYASAN
--    (yayasan lain boleh punya kelas "7A" sendiri).
--
-- Aman dijalankan berulang dan aman untuk data lama. Jalankan saat tidak ada ujian.
-- Perubahan kunci tabel `pengaturan` SENGAJA belum ada di sini: harus dipasang
-- bersamaan dengan kode admin (migrasi 42).

CREATE OR REPLACE FUNCTION public.set_yayasan_paket_dari_mapel()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_yayasan TEXT;
BEGIN
  SELECT yayasan_id INTO v_yayasan FROM mapel WHERE id = NEW.mapel_id;
  IF v_yayasan IS NOT NULL THEN
    NEW.yayasan_id := v_yayasan;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.set_yayasan_paket_dari_mapel() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_yayasan_paket_dari_mapel() TO service_role;

DROP TRIGGER IF EXISTS trg_paket_soal_yayasan ON paket_soal;
CREATE TRIGGER trg_paket_soal_yayasan
  BEFORE INSERT ON paket_soal
  FOR EACH ROW EXECUTE FUNCTION public.set_yayasan_paket_dari_mapel();

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'kelas_nama_unique') THEN
    ALTER TABLE kelas DROP CONSTRAINT kelas_nama_unique;
  END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS kelas_yayasan_nama_unique ON kelas (yayasan_id, nama);

-- Cek (harus 0 baris):
-- select p.id from paket_soal p join mapel m on m.id = p.mapel_id
--   where p.yayasan_id is distinct from m.yayasan_id;
