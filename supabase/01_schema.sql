-- =============================================================================
-- SmartExam — Schema database (disinkronkan ulang dari Supabase produksi
-- via introspeksi information_schema.columns + pg_indexes pada 28 Jun 2026).
--
-- CATATAN PENTING: file ini sebelumnya TIDAK SINKRON dengan database asli,
-- karena beberapa kali perubahan kolom/index dilakukan langsung lewat SQL
-- Editor Supabase tanpa pernah di-commit ke sini. Perbedaan yang ditemukan
-- saat sinkronisasi ini:
--
--   1. Tabel `soal` punya DUA set kolom gambar yang tumpang tindih:
--      - gambar_url, gambar_a..gambar_e   (set LAMA)
--      - gambar_pertanyaan, gambar_opsi_a..gambar_opsi_e  (set BARU)
--      Kemungkinan ada 2 jalur kode pembuatan soal yang menulis ke kolom
--      berbeda — perlu ditelusuri mana yang sekarang benar-benar dipakai
--      untuk dibaca oleh UI, supaya kolom yang sudah tidak terpakai bisa
--      dibersihkan/di-drop.
--   2. Tabel `soal` ternyata juga punya kolom `acak` (sebelumnya dikira
--      hanya ada di `paket_soal`).
--   3. Tabel `nilai` punya banyak kolom baru terkait alur "kirim nilai ke
--      wali kelas / guru": nilai_edit, grade_edit, lulus_edit,
--      dikirim_ke_wali, dikirim_at, dikembalikan, catatan_guru.
--   4. Tabel `nilai` ternyata sudah punya UNIQUE(sesi_id, nis) di database
--      asli — sebelumnya TIDAK tertulis di file ini, padahal kode aplikasi
--      (selesai/route.ts) sudah lama mengandalkan constraint ini lewat
--      upsert(... onConflict: 'sesi_id,nis').
--   5. Tabel `users` punya kolom baru `no_hp`.
--   6. Tabel `siswa_ujian` punya kolom baru `waktu_mulai_awal` dan
--      `last_heartbeat` (dipakai untuk timer ujian yang tahan reset, dan
--      deteksi login ganda/device stale).
--   7. Tabel `log_reset` punya kolom baru `percobaan_gagal` dan
--      `terkunci_sampai` (rate-limiting verifikasi kode reset).
--   8. CHECK constraint yang dulu ada di `jadwal.status`
--      (IN ('AKTIF','BERJALAN','SELESAI')) dan `users.role`
--      (IN ('ADMIN','GURU','PENGAWAS','KEPSEK')) TIDAK ditemukan lagi di
--      database asli — sepertinya sudah dihapus, sehingga validasi nilai
--      yang sah untuk kolom ini sekarang murni ditangani di level aplikasi.
--      (Asumsi ini berdasarkan hasil query check_constraints yang kosong —
--      tolong konfirmasi ulang kalau ternyata constraint itu masih ada.)
--   9. Banyak index tambahan sudah ada di database asli yang tidak pernah
--      tercatat di file lama (lihat bagian "Indexes" di bawah) — termasuk
--      idx_soal_guru dan idx_users_status yang sebelumnya tidak ada sama
--      sekali.
--  10. Tabel `kisi_kisi` yang disebut "DIHAPUS" di komentar kode lama tetap
--      tidak ada di schema ini (dikonfirmasi tidak muncul di hasil
--      introspeksi sama sekali).
-- =============================================================================

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
  role TEXT NOT NULL,
  mapel_id TEXT,
  last_login TIMESTAMPTZ,
  status TEXT DEFAULT 'AKTIF',
  is_tester TEXT DEFAULT 'NO',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  no_hp TEXT
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
  -- (CHECK constraint lama untuk kolom ini sudah tidak ada di database asli)
  status TEXT DEFAULT 'AKTIF',
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
  created_at TIMESTAMPTZ DEFAULT NOW(),
  notif_dibaca BOOLEAN DEFAULT TRUE
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
  gambar_url TEXT,           -- set kolom gambar LAMA — lihat catatan #1 di atas
  paket_id TEXT,
  gambar_a TEXT, gambar_b TEXT, gambar_c TEXT, gambar_d TEXT, gambar_e TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  gambar_pertanyaan TEXT,    -- set kolom gambar BARU — lihat catatan #1 di atas
  gambar_opsi_a TEXT, gambar_opsi_b TEXT, gambar_opsi_c TEXT, gambar_opsi_d TEXT, gambar_opsi_e TEXT,
  acak TEXT DEFAULT 'YA'
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
  waktu_mulai_awal TIMESTAMPTZ,  -- referensi timer yang tidak berubah walau di-reset
  last_heartbeat TIMESTAMPTZ,    -- dipakai untuk deteksi login ganda/device stale
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
  kkm INTEGER DEFAULT 75,
  -- Kolom di bawah ini untuk alur edit/kirim nilai ke wali kelas:
  nilai_edit NUMERIC(5,2),
  grade_edit TEXT,
  lulus_edit BOOLEAN,
  dikirim_ke_wali BOOLEAN NOT NULL DEFAULT FALSE,
  dikirim_at TIMESTAMPTZ,
  dikembalikan BOOLEAN NOT NULL DEFAULT FALSE,
  catatan_guru TEXT,
  UNIQUE(sesi_id, nis)
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
  created_at TIMESTAMPTZ DEFAULT NOW(),
  percobaan_gagal INTEGER DEFAULT 0,   -- rate-limit verifikasi kode reset
  terkunci_sampai TIMESTAMPTZ          -- lockout sementara setelah gagal berkali-kali
);

CREATE TABLE log_aktivitas (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  aksi TEXT,
  detail TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================================================
-- Indexes (disinkronkan dari pg_indexes — banyak yang sebelumnya tidak
-- tercatat di file lama, lihat catatan #9 di atas)
-- =============================================================================
CREATE INDEX idx_jadwal_tanggal ON jadwal(tanggal);

CREATE INDEX idx_jawaban_sesi_nis ON jawaban(sesi_id, nis);

CREATE INDEX idx_log_created ON log_aktivitas(created_at DESC);

CREATE INDEX idx_nilai_nis ON nilai(nis);
CREATE INDEX idx_nilai_mapel ON nilai(mapel_id);
CREATE INDEX idx_nilai_sesi ON nilai(sesi_id);
CREATE INDEX idx_nilai_timestamp ON nilai("timestamp" DESC);
CREATE INDEX idx_nilai_kelas ON nilai(kelas);
CREATE INDEX idx_nilai_dikirim ON nilai(dikirim_ke_wali);
CREATE INDEX idx_nilai_dikembalikan ON nilai(dikembalikan);

CREATE INDEX idx_paket_soal_guru ON paket_soal(guru_id);
CREATE INDEX idx_paket_mapel_kelas_status ON paket_soal(mapel_id, kelas_id, status);

CREATE INDEX idx_pelanggaran_sesi_nis ON pelanggaran(sesi_id, nis);

CREATE INDEX idx_sesi_status ON sesi_ujian(status);
CREATE INDEX idx_sesi_kode ON sesi_ujian(kode_sesi);

CREATE INDEX idx_siswa_kelas ON siswa(kelas);
CREATE INDEX idx_siswa_status ON siswa(status);

CREATE INDEX idx_siswa_ujian_sesi ON siswa_ujian(sesi_id);
CREATE INDEX idx_siswa_ujian_sesi_nis ON siswa_ujian(sesi_id, nis);

CREATE INDEX idx_soal_paket ON soal(paket_id);
CREATE INDEX idx_soal_mapel ON soal(mapel_id);
CREATE INDEX idx_soal_status ON soal(status);
CREATE INDEX idx_soal_guru ON soal(guru_id);

CREATE INDEX idx_users_status ON users(status);
