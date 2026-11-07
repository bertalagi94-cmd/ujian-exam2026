-- =============================================================================
-- 64 — Tempat Surat (baris "<tempat>, <tanggal>" pada Daftar Hadir & Berita Acara)
-- =============================================================================
-- Kolom opsional per sekolah/jenjang. Kalau kosong, dokumen cetak otomatis
-- memakai kolom `kota` (Kota / Kabupaten). Aman dijalankan berulang.
-- Jalankan SEBELUM men-deploy kode yang membaca/menyimpan kolom ini.
-- =============================================================================

ALTER TABLE sekolah ADD COLUMN IF NOT EXISTS tempat_surat TEXT DEFAULT '';
