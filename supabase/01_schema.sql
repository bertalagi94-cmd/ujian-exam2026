-- ============================================================
-- SMARTEXAM - MTS ALKHAIRAAT TATAKALAI
-- Jalankan file ini di Supabase SQL Editor
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

DROP TABLE IF EXISTS log_aktivitas CASCADE;
DROP TABLE IF EXISTS log_reset CASCADE;
DROP TABLE IF EXISTS pelanggaran CASCADE;
DROP TABLE IF EXISTS nilai CASCADE;
DROP TABLE IF EXISTS jawaban CASCADE;
DROP TABLE IF EXISTS siswa_ujian CASCADE;
DROP TABLE IF EXISTS sesi_ujian CASCADE;
DROP TABLE IF EXISTS jadwal CASCADE;
DROP TABLE IF EXISTS soal CASCADE;
DROP TABLE IF EXISTS paket_soal CASCADE;
DROP TABLE IF EXISTS kelas_mapel CASCADE;
DROP TABLE IF EXISTS mapel CASCADE;
DROP TABLE IF EXISTS kelas CASCADE;
DROP TABLE IF EXISTS siswa CASCADE;
DROP TABLE IF EXISTS users CASCADE;
DROP TABLE IF EXISTS pengaturan CASCADE;

CREATE TABLE pengaturan (
  key TEXT PRIMARY KEY,
  value TEXT,
  deskripsi TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE siswa (
  nis TEXT PRIMARY KEY,
  nama TEXT NOT NULL,
  kelas TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  status TEXT DEFAULT 'AKTIF',
  tempat_lahir TEXT,
  tanggal_lahir DATE,
  jenis_kelamin TEXT,
  last_login TIMESTAMPTZ,
  device_info TEXT,
  is_tester TEXT DEFAULT 'NO',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE users (
  username TEXT PRIMARY KEY,
  password_hash TEXT NOT NULL,
  nama TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('ADMIN', 'GURU', 'PENGAWAS', 'KEPSEK')),
  mapel_id TEXT,
  last_login TIMESTAMPTZ,
  status TEXT DEFAULT 'AKTIF',
  is_tester TEXT DEFAULT 'NO',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE kelas (
  id TEXT PRIMARY KEY,
  nama TEXT NOT NULL,
  jurusan TEXT DEFAULT '-',
  wali_kelas TEXT,
  jumlah INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE mapel (
  id TEXT PRIMARY KEY,
  nama TEXT NOT NULL,
  guru_id TEXT,
  kelas_list TEXT,
  jumlah_opsi INTEGER DEFAULT 4,
  kkm INTEGER DEFAULT 75,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE kelas_mapel (
  id TEXT PRIMARY KEY,
  kelas_id TEXT,
  nama_kelas TEXT,
  mapel_id TEXT,
  nama_mapel TEXT,
  status TEXT DEFAULT 'BELUM',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(kelas_id, mapel_id)
);

CREATE TABLE jadwal (
  id TEXT PRIMARY KEY,
  tanggal DATE NOT NULL,
  sesi INTEGER DEFAULT 1,
  jam_mulai TEXT NOT NULL,
  jam_selesai TEXT NOT NULL,
  mapel_id TEXT,
  kelas TEXT NOT NULL,
  pengawas TEXT,
  durasi INTEGER DEFAULT 90,
  -- status: AKTIF = belum dimulai, BERJALAN = sesi sedang aktif, SELESAI = ujian selesai
  status TEXT DEFAULT 'AKTIF' CHECK (status IN ('AKTIF', 'BERJALAN', 'SELESAI')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE paket_soal (
  id TEXT PRIMARY KEY,
  mapel_id TEXT,
  kelas_id TEXT,
  guru_id TEXT,
  status TEXT DEFAULT 'DRAFT',
  tanggal TIMESTAMPTZ DEFAULT NOW(),
  catatan TEXT,
  jumlah_soal INTEGER DEFAULT 0,
  acak TEXT DEFAULT 'YA',   -- YA = urutan soal diacak per siswa
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE soal (
  id TEXT PRIMARY KEY,
  mapel_id TEXT,
  kelas_id TEXT,
  guru_id TEXT,
  teks TEXT NOT NULL,
  opsi_a TEXT, opsi_b TEXT, opsi_c TEXT, opsi_d TEXT, opsi_e TEXT,
  kunci TEXT NOT NULL,
  pembahasan TEXT,
  tingkat TEXT DEFAULT 'Sedang',
  jumlah_opsi INTEGER DEFAULT 4,
  status TEXT DEFAULT 'DRAFT',
  tanggal TIMESTAMPTZ DEFAULT NOW(),
  catatan TEXT,
  gambar_url TEXT,
  paket_id TEXT,
  gambar_a TEXT, gambar_b TEXT, gambar_c TEXT, gambar_d TEXT, gambar_e TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE sesi_ujian (
  id TEXT PRIMARY KEY,
  jadwal_id TEXT,
  mapel_id TEXT,
  kelas TEXT,
  durasi INTEGER DEFAULT 90,
  info_json JSONB DEFAULT '{}',
  waktu_mulai TIMESTAMPTZ DEFAULT NOW(),
  waktu_selesai TIMESTAMPTZ,
  status TEXT DEFAULT 'BERJALAN',
  jumlah_peserta INTEGER DEFAULT 0,
  kode_sesi TEXT UNIQUE,
  is_darurat BOOLEAN DEFAULT FALSE,
  siswa_diizinkan TEXT[],
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE siswa_ujian (
  id BIGSERIAL PRIMARY KEY,
  sesi_id TEXT,
  nis TEXT,
  waktu_daftar TIMESTAMPTZ DEFAULT NOW(),
  waktu_mulai TIMESTAMPTZ DEFAULT NOW(),
  status TEXT DEFAULT 'AKTIF',
  waktu_selesai TIMESTAMPTZ,
  device_id TEXT,
  UNIQUE(sesi_id, nis)
);

CREATE TABLE jawaban (
  id BIGSERIAL PRIMARY KEY,
  sesi_id TEXT NOT NULL,
  nis TEXT NOT NULL,
  soal_id TEXT NOT NULL,
  jawaban TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  sync_status TEXT DEFAULT 'SYNCED',
  local_timestamp BIGINT,
  UNIQUE(sesi_id, nis, soal_id)
);

CREATE TABLE nilai (
  id TEXT PRIMARY KEY,
  sesi_id TEXT,
  nis TEXT,
  mapel_id TEXT,
  kelas TEXT,
  benar INTEGER DEFAULT 0,
  total INTEGER DEFAULT 0,
  nilai NUMERIC(5,2) DEFAULT 0,
  grade TEXT,
  timestamp TIMESTAMPTZ DEFAULT NOW(),
  lulus BOOLEAN DEFAULT FALSE,
  kkm INTEGER DEFAULT 75
);

CREATE TABLE pelanggaran (
  id TEXT PRIMARY KEY,
  sesi_id TEXT,
  nis TEXT,
  jenis TEXT,
  level INTEGER DEFAULT 1,
  detail TEXT,
  status TEXT DEFAULT 'BELUM_DITINDAKLANJUTI',
  tindakan TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE log_reset (
  id BIGSERIAL PRIMARY KEY,
  nis TEXT,
  reset_oleh TEXT,
  alasan TEXT,
  password_baru TEXT,
  device_baru TEXT,
  digunakan BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE log_aktivitas (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  aksi TEXT,
  detail TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_siswa_kelas ON siswa(kelas);
CREATE INDEX idx_soal_paket ON soal(paket_id);
CREATE INDEX idx_soal_mapel ON soal(mapel_id);
CREATE INDEX idx_soal_status ON soal(status);
CREATE INDEX idx_jawaban_sesi_nis ON jawaban(sesi_id, nis);
CREATE INDEX idx_nilai_nis ON nilai(nis);
CREATE INDEX idx_nilai_mapel ON nilai(mapel_id);
CREATE INDEX idx_siswa_ujian_sesi ON siswa_ujian(sesi_id);
CREATE INDEX idx_log_created ON log_aktivitas(created_at DESC);
CREATE INDEX idx_jadwal_tanggal ON jadwal(tanggal);
