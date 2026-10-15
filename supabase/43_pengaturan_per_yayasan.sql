-- 43_pengaturan_per_yayasan.sql  (Fase 2 multi-yayasan)
--
-- Tabel pengaturan tadinya berkunci `key` saja, jadi yayasan kedua tidak bisa
-- menyimpan pengaturannya sendiri. Migrasi ini mengganti kunci menjadi
-- (yayasan_id, key).
--
-- URUTAN WAJIB:
--   1. Kode baru (fase2-admin-bagian4) SUDAH ter-deploy. Kode itu memakai
--      onConflict 'yayasan_id,key' (butuh indeks unik; lihat 43a_cek_pengaturan.sql).
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

-- Ganti kunci utama menjadi (yayasan_id, key).
-- Membuat indeksnya sendiri (tidak lagi bergantung pada uq_pengaturan_yayasan_key
-- dari migrasi 39, yang ternyata bisa tidak ada di sebagian database).
-- Semua langkah berjalan dalam satu transaksi: kalau gagal, kunci lama utuh.
DO $$
DECLARE nama_pk text;
BEGIN
  SELECT conname INTO nama_pk FROM pg_constraint
   WHERE conrelid = 'pengaturan'::regclass AND contype = 'p';
  IF nama_pk IS NOT NULL THEN
    EXECUTE format('ALTER TABLE pengaturan DROP CONSTRAINT %I', nama_pk);
  END IF;
  ALTER TABLE pengaturan ADD CONSTRAINT pengaturan_pkey PRIMARY KEY (yayasan_id, key);
END $$;

-- Indeks unik dari migrasi 39 (kalau ada) kini mubazir karena kunci utama sudah
-- sama. Dibuang supaya tidak ada dua indeks identik.
DROP INDEX IF EXISTS uq_pengaturan_yayasan_key;

-- Cek (harus 1 baris, contype = p, definisi memuat yayasan_id dan key):
-- select conname, contype, pg_get_constraintdef(oid) from pg_constraint where conrelid = 'pengaturan'::regclass;
