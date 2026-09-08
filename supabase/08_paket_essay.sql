-- =============================================================================
-- Migrasi: Soal Essay disamakan penuh dengan pola Soal PG (paket per
-- mapel+kelas, lepas dari jadwal ujian tertentu — bisa dipakai ulang /
-- diduplikasi, dan lewat alur validasi admin yang sama).
--
-- Sebelum ini, soal_essay melekat ke SATU jadwal_id (lihat 07_essay.sql) dan
-- guru menyetujui soalnya sendiri (tidak lewat admin). Sekarang:
--   - paket_essay meniru paket_soal: mapel_id + kelas_id + guru_id, dengan
--     status DRAFT -> MENUNGGU -> DISETUJUI/DITOLAK (divalidasi admin).
--   - Pengaturan yang dulu ada di halaman "Soal Essay" (Mode Jawaban,
--     Durasi) sekarang jadi bagian dari SETUP paket_essay (dipilih sekali
--     saat membuat paket), BUKAN lagi per jadwal ujian.
--   - Bobot PG vs Essay (persen) TIDAK perlu diisi guru lagi saat membuat
--     soal — kolom jadwal.essay_bobot_pg_persen / essay_bobot_essay_persen
--     dibiarkan apa adanya (default 50/50) dan tetap dipakai sebagaimana
--     mestinya di guru/koreksi-essay saat menghitung nilai_total, karena
--     guru tetap menilai essay secara manual per siswa seperti sebelumnya.
--   - Soal essay yang SUDAH ADA (lama, melekat ke jadwal_id) TIDAK perlu
--     dimigrasikan manual: tabel soal_essay dari awal sudah punya kolom
--     mapel_id & kelas_id yang terisi, jadi begitu titik-titik konsumsi
--     (sisi siswa, koreksi) diubah untuk mengambil soal berdasarkan
--     mapel_id+kelas_id (bukan jadwal_id) — persis seperti pola PG — soal
--     lama otomatis tetap terbaca selama sudah berstatus DISETUJUI.
-- =============================================================================

-- ── 1. Tabel paket_essay (meniru paket_soal) ────────────────────────────────
CREATE TABLE IF NOT EXISTS paket_essay (
  id TEXT PRIMARY KEY,
  mapel_id TEXT,
  kelas_id TEXT,
  guru_id TEXT,
  status TEXT DEFAULT 'DRAFT',              -- DRAFT | MENUNGGU | DISETUJUI | DITOLAK
  tanggal TIMESTAMPTZ DEFAULT NOW(),
  catatan TEXT,
  jumlah_soal INTEGER DEFAULT 0,
  mode_jawaban TEXT DEFAULT 'DIGITAL',      -- DIGITAL | KERTAS (dulu ada di jadwal.essay_mode_jawaban)
  durasi_menit INTEGER DEFAULT 30,          -- dulu ada di jadwal.essay_durasi_menit
  created_at TIMESTAMPTZ DEFAULT NOW(),
  notif_dibaca BOOLEAN DEFAULT TRUE
);

CREATE INDEX IF NOT EXISTS idx_paket_essay_guru ON paket_essay(guru_id);
CREATE INDEX IF NOT EXISTS idx_paket_essay_mapel_kelas ON paket_essay(mapel_id, kelas_id);

-- ── 2. soal_essay: tambah keterkaitan ke paket_essay, jadwal_id jadi opsional
ALTER TABLE soal_essay
  ADD COLUMN IF NOT EXISTS paket_essay_id TEXT;

ALTER TABLE soal_essay
  ALTER COLUMN jadwal_id DROP NOT NULL;

CREATE INDEX IF NOT EXISTS idx_soal_essay_paket ON soal_essay(paket_essay_id);
CREATE INDEX IF NOT EXISTS idx_soal_essay_mapel_kelas ON soal_essay(mapel_id, kelas_id);

-- soal_essay.status sebelumnya hanya 'DRAFT' | 'DISETUJUI' (guru self-approve).
-- Sekarang mengikuti siklus penuh seperti tabel `soal` (PG):
-- 'DRAFT' | 'MENUNGGU' | 'DISETUJUI' | 'DITOLAK'. Tidak perlu ALTER apapun
-- karena kolomnya TEXT bebas — cukup dipastikan di kode API yang menuliskannya.
