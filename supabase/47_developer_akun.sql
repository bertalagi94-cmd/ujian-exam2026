-- 47_developer_akun.sql
--
-- Akun developer TERPISAH dari akun sekolah. Tabel ini sengaja tidak punya
-- kolom yayasan_id dan tidak ada hubungannya dengan tabel users/siswa:
-- akun developer tidak pernah dianggap pengguna sekolah mana pun.
--
-- Idempotent. Akun pertama dibuat lewat: node scripts/buat-developer.js
-- (skrip mencetak SQL INSERT berisi hash bcrypt; password tidak pernah
-- disimpan di repo).

CREATE TABLE IF NOT EXISTS developer_akun (
  id            TEXT PRIMARY KEY,
  username      TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  nama          TEXT NOT NULL DEFAULT 'Developer',
  status        TEXT NOT NULL DEFAULT 'AKTIF',
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  last_login    TIMESTAMPTZ,
  CONSTRAINT developer_status_valid CHECK (status IN ('AKTIF', 'NONAKTIF'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_developer_username
  ON developer_akun (lower(username));

-- Pola wajib repo: RLS aktif tanpa policy + cabut hak.
ALTER TABLE developer_akun ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON developer_akun FROM PUBLIC, anon, authenticated;

-- Verifikasi (jalankan manual setelah migrasi):
-- select to_regclass('developer_akun');                                    -- tidak boleh null
-- select has_table_privilege('anon', 'developer_akun', 'select');          -- harus false
