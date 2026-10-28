-- 48_logo_aplikasi_global.sql
--
-- Logo aplikasi dipindah dari pengaturan PER SEKOLAH (tabel pengaturan,
-- key 'logoAplikasi') menjadi pengaturan GLOBAL yang hanya bisa diubah oleh
-- akun developer (Panel Developer, /developer). Admin sekolah hanya mengelola
-- logo sekolahnya sendiri.
--
-- Tabel ini sengaja tidak punya kolom yayasan_id: isinya berlaku untuk semua
-- sekolah. Hanya server (service role) yang membaca/menulisnya.
--
-- URUTAN: deploy kode baru dulu atau sesudahnya sama-sama aman. Selama tabel
-- ini belum ada, logo aplikasi tidak tampil (halaman tetap jalan, memakai logo
-- sekolah sebagai cadangan).
--
-- Idempotent. Baris lama 'logoAplikasi' di tabel pengaturan TIDAK dihapus,
-- tetapi tidak lagi dibaca aplikasi.

CREATE TABLE IF NOT EXISTS pengaturan_global (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Pola wajib repo: RLS aktif tanpa policy + cabut hak.
ALTER TABLE pengaturan_global ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON pengaturan_global FROM PUBLIC, anon, authenticated;

-- Bawa logo aplikasi yang sekarang dipakai yayasan awal supaya tampilan tidak
-- berubah sampai developer mengunggah logo baru. Tidak menimpa kalau sudah ada.
INSERT INTO pengaturan_global (key, value)
SELECT 'logoAplikasi', value
  FROM pengaturan
 WHERE yayasan_id = 'YYS_AWAL' AND key = 'logoAplikasi' AND COALESCE(value, '') <> ''
ON CONFLICT (key) DO NOTHING;

-- Verifikasi (jalankan manual setelah migrasi):
-- select to_regclass('pengaturan_global');                                    -- tidak boleh null
-- select has_table_privilege('anon', 'pengaturan_global', 'select');          -- harus false
-- select * from pengaturan_global;                                            -- logoAplikasi terisi kalau dulu ada
