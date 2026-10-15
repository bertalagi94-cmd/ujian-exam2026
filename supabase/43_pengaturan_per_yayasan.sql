-- 43_pengaturan_per_yayasan.sql  (Fase 2 multi-yayasan)
--
-- Tabel pengaturan tadinya berkunci `key` saja, jadi yayasan kedua tidak bisa
-- menyimpan pengaturannya sendiri. Migrasi ini mengganti kunci menjadi
-- (yayasan_id, key).
--
-- URUTAN WAJIB:
--   1. Kode baru (fase2-admin-bagian4) SUDAH ter-deploy. Kode itu memakai
--      onConflict 'yayasan_id,key' yang sudah jalan dengan indeks dari migrasi 39.
--   2. Baru jalankan file ini.
--   3. Baru nyalakan MULTI_YAYASAN_ENABLED.
-- Jangan dijalankan saat ada ujian. Kode LAMA (yang masih onConflict 'key') akan
-- error di Pengaturan setelah file ini dijalankan.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pengaturan WHERE yayasan_id IS NULL) THEN
    RAISE EXCEPTION 'Ada baris pengaturan tanpa yayasan_id. Jalankan migrasi 39 dulu.';
  END IF;
END $$;

ALTER TABLE pengaturan ALTER COLUMN yayasan_id SET NOT NULL;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pengaturan_pkey') THEN
    ALTER TABLE pengaturan DROP CONSTRAINT pengaturan_pkey;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'pengaturan'::regclass AND contype = 'p') THEN
    ALTER TABLE pengaturan ADD CONSTRAINT pengaturan_pkey PRIMARY KEY USING INDEX uq_pengaturan_yayasan_key;
  END IF;
END $$;

-- Cek: select conname, contype from pg_constraint where conrelid = 'pengaturan'::regclass;
