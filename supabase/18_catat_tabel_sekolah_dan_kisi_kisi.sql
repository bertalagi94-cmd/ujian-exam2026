-- =============================================================================
-- Migrasi 18: Catat tabel sekolah & kisi_kisi (skema presisi dari production)
--
-- LATAR BELAKANG (temuan audit — lihat percakapan pengembangan):
-- Tabel `sekolah` (fitur multi-jenjang, dipakai di src/app/api/admin/sekolah/**
-- dan src/lib/kepsek-scope.ts) dan tabel `kisi_kisi` (dipakai di
-- src/app/api/{admin,guru,siswa,kepsek}/kisi-kisi/**) TERBUKTI aktif dipakai
-- di kode, tapi tidak ada di file migrasi manapun (01-17). Sama seperti
-- migrasi 16 & 17: dibuat langsung lewat Supabase SQL Editor, tidak pernah
-- disalin ke repo.
--
-- Isi migrasi ini disalin PERSIS dari hasil query terhadap
-- information_schema.columns DAN pg_constraint pada database production,
-- BUKAN tebakan dari kode. Kolom, tipe data, foreign key, unique constraint,
-- dan check constraint semuanya sudah diverifikasi cocok 1:1 dengan
-- production (termasuk sekolah_id di users & kelas, dan constraint di
-- kisi_kisi/users/kelas).
--
-- TEMUAN PENTING dari verifikasi constraint: kisi_kisi punya
-- UNIQUE(mapel_id, kelas_id) — artinya secara desain database HANYA BOLEH
-- ADA SATU baris kisi_kisi per kombinasi mapel+kelas (bukan per guru). Kalau
-- ada 2 guru berbeda mengajar mapel yang sama di kelas yang sama dan
-- keduanya coba membuat kisi-kisi, guru kedua akan gagal insert karena
-- bentrok unique constraint ini — perlu dicek di UI apakah pesan errornya
-- sudah jelas untuk kasus itu.
--
-- DAMPAK sebelum migrasi ini: rebuild database dari nol lewat file 01-17
-- akan membuat seluruh fitur jenjang/sekolah dan kisi-kisi guru gagal total
-- ("relation does not exist") sejak request pertama ke endpoint terkait.
-- =============================================================================

CREATE TABLE IF NOT EXISTS sekolah (
  id            TEXT PRIMARY KEY,
  label         TEXT NOT NULL,
  nama_sekolah  TEXT NOT NULL,
  npsn          TEXT DEFAULT '',
  nama_kepsek   TEXT DEFAULT '',
  nip_kepsek    TEXT DEFAULT '',
  alamat        TEXT DEFAULT '',
  kota          TEXT DEFAULT '',
  tahun_ajaran  TEXT DEFAULT '',
  logo_url      TEXT DEFAULT '',
  urutan        INTEGER DEFAULT 0,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS kisi_kisi (
  id          TEXT PRIMARY KEY,
  mapel_id    TEXT NOT NULL,
  kelas_id    TEXT NOT NULL,
  guru_id     TEXT NOT NULL,
  konten      TEXT NOT NULL DEFAULT '',
  status      TEXT DEFAULT 'DRAFT' CHECK (status = ANY (ARRAY['DRAFT'::text, 'TERKIRIM'::text])),
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT kisi_kisi_mapel_id_kelas_id_key UNIQUE (mapel_id, kelas_id)
);

-- ── Kolom sekolah_id (dipakai untuk scope akun KEPSEK/GURU) ────────────────
-- Diverifikasi lewat information_schema + pg_constraint: text, nullable,
-- tanpa default, FK ke sekolah(id) ON DELETE SET NULL di kedua tabel.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS sekolah_id TEXT;

ALTER TABLE kelas
  ADD COLUMN IF NOT EXISTS sekolah_id TEXT;

-- PostgreSQL tidak punya "ADD CONSTRAINT IF NOT EXISTS", jadi dibungkus DO
-- block supaya migrasi ini tetap aman dijalankan berkali-kali (idempotent),
-- sama seperti pola CREATE ... IF NOT EXISTS di bagian lain file ini.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'users_sekolah_id_fkey'
  ) THEN
    ALTER TABLE users
      ADD CONSTRAINT users_sekolah_id_fkey FOREIGN KEY (sekolah_id) REFERENCES sekolah(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'kelas_sekolah_id_fkey'
  ) THEN
    ALTER TABLE kelas
      ADD CONSTRAINT kelas_sekolah_id_fkey FOREIGN KEY (sekolah_id) REFERENCES sekolah(id) ON DELETE SET NULL;
  END IF;
END $$;
