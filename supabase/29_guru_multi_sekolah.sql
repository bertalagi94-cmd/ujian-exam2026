-- =============================================================================
-- Migrasi 24: Guru boleh mengajar di lebih dari satu sekolah/jenjang
--
-- LATAR BELAKANG:
-- users.sekolah_id (migrasi 18) hanya kolom TUNGGAL — cukup untuk KEPSEK
-- (satu kepsek = satu sekolah yang diawasi), tapi tidak cukup untuk GURU:
-- pada praktiknya ada guru yang mengajar di kedua jenjang sekaligus (mis.
-- SMP dan SMA dalam satu yayasan). Dengan kolom tunggal, guru seperti ini
-- terpaksa hanya bisa diset ke SATU sekolah, sehingga kisi-kisi/kelas di
-- jenjang lainnya tetap tak terlihat olehnya.
--
-- Migrasi ini menambahkan tabel relasi many-to-many `guru_sekolah` khusus
-- untuk akun GURU. Kolom `users.sekolah_id` TETAP ADA dan tetap dipakai
-- apa adanya untuk KEPSEK (tidak diubah). Data sekolah_id yang sudah
-- terlanjur terisi untuk akun GURU (dari migrasi 18) dipindahkan sebagai
-- baris pertama di tabel baru ini supaya tidak ada guru yang scope-nya
-- tiba-tiba kosong setelah migrasi.
-- =============================================================================

CREATE TABLE IF NOT EXISTS guru_sekolah (
  username    TEXT NOT NULL REFERENCES users(username) ON DELETE CASCADE,
  sekolah_id  TEXT NOT NULL REFERENCES sekolah(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (username, sekolah_id)
);

CREATE INDEX IF NOT EXISTS idx_guru_sekolah_username ON guru_sekolah(username);
CREATE INDEX IF NOT EXISTS idx_guru_sekolah_sekolah_id ON guru_sekolah(sekolah_id);

-- Backfill: bawa data users.sekolah_id GURU yang sudah ada ke tabel relasi
-- baru, supaya guru yang sudah diset sekolahnya (via migrasi 18/UI lama)
-- tidak kehilangan scope-nya begitu kode aplikasi pindah membaca dari sini.
INSERT INTO guru_sekolah (username, sekolah_id)
SELECT username, sekolah_id
FROM users
WHERE role = 'GURU' AND sekolah_id IS NOT NULL
ON CONFLICT (username, sekolah_id) DO NOTHING;
