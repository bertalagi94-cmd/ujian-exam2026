-- =============================================================================
-- 63 — Ketua Panitia Ujian (penanda tangan Daftar Hadir & Berita Acara)
-- =============================================================================
-- Daftar Hadir dan Berita Acara kini ditandatangani oleh Pengawas Ujian dan
-- Ketua Panitia Ujian (bukan lagi Kepala Sekolah). Nama & NIP ketua panitia
-- disimpan per sekolah/jenjang di tabel `sekolah`, diisi admin lewat menu
-- Pengaturan > Sekolah & Jenjang (dropdown data guru atau input manual).
--
-- Aman dijalankan berulang (IF NOT EXISTS). Jalankan SEBELUM men-deploy kode
-- yang menyimpan kolom ini, kalau tidak simpan data Sekolah akan gagal.
-- =============================================================================

ALTER TABLE sekolah ADD COLUMN IF NOT EXISTS nama_ketua_panitia TEXT DEFAULT '';
ALTER TABLE sekolah ADD COLUMN IF NOT EXISTS nip_ketua_panitia  TEXT DEFAULT '';
