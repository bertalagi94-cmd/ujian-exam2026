-- =============================================================================
-- Migrasi 14: Kolom snapshot paket (paket_soal_id / paket_essay_id) di sesi_ujian
--
-- LATAR BELAKANG (BUG P0 hasil audit):
-- Kode di beberapa file sudah lama merujuk ke kolom:
--   sesi_ujian.paket_soal_id   (lihat src/app/api/siswa/ujian/validasi/route.ts,
--                                src/lib/penilaian-ujian.ts)
--   sesi_ujian.paket_essay_id  (lihat src/app/api/siswa/ujian/essay/mulai/route.ts,
--                                src/app/api/guru/koreksi-essay/route.ts)
-- Tujuannya: begitu siswa PERTAMA masuk/mulai essay, ID paket soal yang dia
-- kerjakan dikunci ("di-snapshot") ke sesi_ujian, supaya:
--   - siswa lain yang menyusul, dan
--   - guru yang mengoreksi belakangan,
-- semuanya membaca paket yang SAMA PERSIS, walau guru mengubah status
-- DISETUJUI paket lain untuk mapel+kelas yang sama SETELAH ujian dimulai.
--
-- MASALAHNYA: kolom ini TIDAK PERNAH dibuat oleh migrasi manapun (01-13).
-- 01_schema.sql mendefinisikan sesi_ujian TANPA kolom ini. Kalau database
-- Supabase dibuat ulang dari nol dengan menjalankan semua file migrasi yang
-- ada, seluruh fitur snapshot di atas akan gagal dengan error
-- "column sesi_ujian.paket_soal_id does not exist".
--
-- Migrasi ini menambahkan kolom yang hilang tsb. Aman dijalankan berkali-kali
-- (IF NOT EXISTS) dan aman untuk database yang kolomnya sudah pernah dibuat
-- manual sebelumnya (mis. langsung dari Supabase Studio).
-- =============================================================================

ALTER TABLE sesi_ujian
  ADD COLUMN IF NOT EXISTS paket_soal_id TEXT,
  ADD COLUMN IF NOT EXISTS paket_essay_id TEXT;

CREATE INDEX IF NOT EXISTS idx_sesi_ujian_paket_soal ON sesi_ujian(paket_soal_id);
CREATE INDEX IF NOT EXISTS idx_sesi_ujian_paket_essay ON sesi_ujian(paket_essay_id);

-- Catatan: sengaja TIDAK diberi FOREIGN KEY ke paket_soal/paket_essay supaya
-- tidak memblokir kasus sesi lama yang paketnya sudah dihapus/diduplikasi —
-- sama seperti pola FK (atau ketiadaannya) di tabel lain pada schema ini.
