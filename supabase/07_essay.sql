-- =============================================================================
-- Migrasi: Fitur Soal Essay (opsional, tambahan di atas ujian PG yang sudah ada)
-- Mengikuti desain yang sudah disepakati (lihat ringkasan diskusi).
-- Konvensi mengikuti pola yang SUDAH ADA di 01_schema.sql:
--   - jadwal  : konfigurasi ujian dibuat guru SEBELUM sesi dibuka
--   - sesi_ujian: instance ujian yang benar2 berjalan, dibuat dari jadwal
--     (lihat src/app/api/guru/mode-pengawas/route.ts) — memakai info_json
--     untuk field fleksibel, jadi kolom essay di sesi_ujian ikut pola itu
--   - siswa_ujian / nilai: kolom baru ditambahkan langsung (bukan info_json)
--     karena sering di-filter/query langsung, sama seperti kolom status yang ada
-- =============================================================================

-- ── 1. Konfigurasi essay di JADWAL (diisi guru saat membuat/mengedit jadwal) ─
ALTER TABLE jadwal
  ADD COLUMN IF NOT EXISTS essay_aktif BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS essay_mode_jawaban TEXT DEFAULT 'DIGITAL',   -- 'DIGITAL' | 'KERTAS'
  ADD COLUMN IF NOT EXISTS essay_durasi_menit INTEGER,
  ADD COLUMN IF NOT EXISTS essay_bobot_pg_persen INTEGER NOT NULL DEFAULT 50,
  ADD COLUMN IF NOT EXISTS essay_bobot_essay_persen INTEGER NOT NULL DEFAULT 50,
  ADD COLUMN IF NOT EXISTS essay_instruksi TEXT;                       -- catatan tambahan guru (opsional)

-- Catatan: saat sesi_ujian dibuat dari jadwal (lihat mode-pengawas/route.ts,
-- guru/susulan/route.ts, admin/susulan/route.ts — SEMUA tempat yang melakukan
-- `db.from('sesi_ujian').insert(...)`), field2 di atas HARUS disalin ke dalam
-- sesi_ujian.info_json, contoh:
--   info_json: {
--     essay_aktif: jadwal.essay_aktif,
--     essay_mode_jawaban: jadwal.essay_mode_jawaban,
--     essay_durasi_menit: jadwal.essay_durasi_menit,
--     essay_bobot_pg_persen: jadwal.essay_bobot_pg_persen,
--     essay_bobot_essay_persen: jadwal.essay_bobot_essay_persen,
--     essay_instruksi: jadwal.essay_instruksi,
--   }
-- Ini supaya kalau guru mengubah jadwal SETELAH sesi berjalan, sesi yang
-- sedang aktif tidak ikut berubah (sama seperti field `durasi` yang sudah
-- disalin dari jadwal ke sesi_ujian saat ini).

-- ── 2. Bank soal essay ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS soal_essay (
  id TEXT PRIMARY KEY,
  jadwal_id TEXT NOT NULL,        -- soal essay melekat ke SATU jadwal (bukan bank lintas jadwal)
  mapel_id TEXT,
  kelas_id TEXT,
  guru_id TEXT,
  teks TEXT NOT NULL,
  gambar_url TEXT,
  bobot_maks NUMERIC(5,2) NOT NULL DEFAULT 100,
  urutan INTEGER NOT NULL DEFAULT 0,
  status TEXT DEFAULT 'DRAFT',    -- 'DRAFT' | 'DISETUJUI' — mengikuti konvensi status di 'soal'
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_soal_essay_jadwal ON soal_essay(jadwal_id);
CREATE INDEX IF NOT EXISTS idx_soal_essay_guru ON soal_essay(guru_id);

-- ── 3. Status pengerjaan essay per siswa ────────────────────────────────────
ALTER TABLE siswa_ujian
  ADD COLUMN IF NOT EXISTS status_essay TEXT DEFAULT 'BELUM_MULAI',
    -- 'BELUM_MULAI' | 'MENGERJAKAN' | 'SUDAH_KIRIM' | 'TIDAK_MENGERJAKAN'
  ADD COLUMN IF NOT EXISTS waktu_mulai_essay TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS waktu_kirim_essay TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS akses_kirim_essay_dibuka BOOLEAN NOT NULL DEFAULT FALSE;
    -- khusus mode KERTAS: guru (pengawas) membuka akses ini secara manual
    -- sebelum tombol "Kirim" di akun siswa aktif — sesuai desain yang disepakati

-- ── 4. Jawaban essay mode DIGITAL (diketik langsung di akun siswa) ─────────
CREATE TABLE IF NOT EXISTS jawaban_essay (
  id BIGSERIAL PRIMARY KEY,
  sesi_id TEXT NOT NULL,
  nis TEXT NOT NULL,
  soal_essay_id TEXT NOT NULL,
  jawaban_teks TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(sesi_id, nis, soal_essay_id)
);

CREATE INDEX IF NOT EXISTS idx_jawaban_essay_sesi_nis ON jawaban_essay(sesi_id, nis);

-- ── 5. Bukti jawaban essay mode KERTAS (1 foto per siswa per sesi) ─────────
CREATE TABLE IF NOT EXISTS jawaban_essay_foto (
  id BIGSERIAL PRIMARY KEY,
  sesi_id TEXT NOT NULL,
  nis TEXT NOT NULL,
  foto_url TEXT NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(sesi_id, nis)
);

-- ── 6. Nilai essay & nilai total gabungan ───────────────────────────────────
ALTER TABLE nilai
  ADD COLUMN IF NOT EXISTS nilai_essay NUMERIC(5,2),          -- diisi guru saat koreksi (skala 0-100, hasil hitung dari bobot_maks)
  ADD COLUMN IF NOT EXISTS nilai_total NUMERIC(5,2),          -- gabungan PG + essay sesuai bobot jadwal; NULL selama belum dinilai/dirilis
  ADD COLUMN IF NOT EXISTS dinilai_pada TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS dinilai_oleh TEXT,
  ADD COLUMN IF NOT EXISTS dirilis BOOLEAN NOT NULL DEFAULT FALSE,   -- true = nilai essay/total sudah boleh dilihat siswa
  ADD COLUMN IF NOT EXISTS dirilis_pada TIMESTAMPTZ;

-- ── 7. Batas durasi essay yang ditentukan Admin (dipakai memvalidasi input
-- durasi guru). Tabel `pengaturan` sudah berupa key-value generik dan sudah
-- ada endpoint GET/PUT-nya (src/app/api/admin/pengaturan/route.ts) — jadi
-- CUKUP tambah 2 baris default di sini, TIDAK perlu kolom/tabel baru.
INSERT INTO pengaturan (key, value) VALUES
  ('batas_durasi_essay_min_menit', '10'),
  ('batas_durasi_essay_max_menit', '180')
ON CONFLICT (key) DO NOTHING;
