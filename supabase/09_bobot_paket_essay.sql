-- =============================================================================
-- Migrasi: pindahkan bobot nilai PG vs Essay dari `jadwal` (per tanggal
-- ujian) ke `paket_essay` (per mapel+kelas) — konsisten dengan mode_jawaban
-- & durasi_menit yang sudah lebih dulu dipindah ke sini di 08_paket_essay.sql.
--
-- Alasan: bobot PG:Essay adalah properti dari BANK SOAL (seberapa besar
-- essay dihargai dibanding PG untuk mapel+kelas ini), bukan properti tanggal
-- ujian tertentu. Guru mengaturnya SEKALI saat membuat paket essay, sama
-- seperti mode jawaban & durasi — bukan per jadwal yang bisa berulang kali
-- dibuka untuk mapel+kelas yang sama (ujian utama, susulan, dst).
--
-- Kolom jadwal.essay_bobot_pg_persen / essay_bobot_essay_persen DIBIARKAN
-- APA ADANYA (tidak dihapus) untuk kompatibilitas mundur & jejak data lama —
-- tapi sudah TIDAK DIBACA lagi oleh kode manapun setelah migrasi ini.
-- =============================================================================

ALTER TABLE paket_essay
  ADD COLUMN IF NOT EXISTS bobot_pg_persen INTEGER NOT NULL DEFAULT 50,
  ADD COLUMN IF NOT EXISTS bobot_essay_persen INTEGER NOT NULL DEFAULT 50;

-- Salin nilai bobot yang mungkin sudah pernah diatur guru lewat jadwal lama
-- (dari halaman "Soal Essay" sebelum migrasi ke paket_essay) ke paket_essay
-- yang cocok mapel+kelas-nya, supaya tidak tiba-tiba balik ke default 50/50
-- untuk paket yang sudah ada. Best-effort saja (ambil salah satu jadwal
-- yang cocok); aman dilewati kalau tidak ada baris yang cocok.
UPDATE paket_essay pe
SET
  bobot_pg_persen = j.essay_bobot_pg_persen,
  bobot_essay_persen = j.essay_bobot_essay_persen
FROM (
  SELECT DISTINCT ON (mapel_id, kelas)
    mapel_id, kelas, essay_bobot_pg_persen, essay_bobot_essay_persen
  FROM jadwal
  WHERE essay_bobot_pg_persen IS NOT NULL
  ORDER BY mapel_id, kelas, tanggal DESC
) j
WHERE pe.mapel_id = j.mapel_id
  AND pe.kelas_id = (SELECT id FROM kelas WHERE nama = j.kelas LIMIT 1);
