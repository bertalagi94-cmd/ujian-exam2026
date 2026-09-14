-- =============================================================================
-- Migrasi: Toggle "Akses Mulai Essay" per SESI (bukan per siswa)
--
-- FIX (dokumentasi hilang — ditemukan lewat audit ChatGPT): kolom ini SUDAH
-- lama dipakai luas di kode (essay/mulai/route.ts, essay/info/route.ts,
-- guru/mode-pengawas/toggle-akses-mulai-essay/route.ts,
-- guru/mode-pengawas/page.tsx) dan berbagai komentar di kode lain sejak awal
-- sudah merujuk ke file "11_akses_mulai_essay.sql" ini sebagai sumbernya —
-- tapi file-nya sendiri TIDAK PERNAH benar-benar dibuat/di-commit ke repo.
-- Kolomnya kemungkinan besar sudah ditambahkan langsung lewat Supabase SQL
-- editor pada satu titik (makanya fitur sudah berjalan di production), tapi
-- riwayatnya hilang dari git — kalau database dibuat ulang dari nol memakai
-- urutan file supabase/*.sql yang ada, fitur "Akses Mulai Essay" akan patah
-- (kolom tidak ditemukan) walau semua kode aplikasinya sudah lengkap.
--
-- FIX: tambahkan migrasi ini supaya riwayatnya tercatat di repo. Aman
-- dijalankan ulang di database yang SUDAH punya kolom ini (IF NOT EXISTS),
-- jadi tidak ada risiko menjalankan ini di production yang sudah berjalan.
--
-- Beda dengan `siswa_ujian.akses_kirim_essay_dibuka` (per SISWA, di
-- 07_essay.sql, mode KERTAS, SUDAH deprecated — lihat
-- guru/mode-pengawas/buka-akses-essay/route.ts) — kolom di migrasi ini
-- adalah toggle level SESI, berlaku untuk KEDUA mode jawaban (DIGITAL &
-- KERTAS), dan masih AKTIF dipakai untuk mengontrol kapan siswa yang sudah
-- selesai PG boleh menekan "Mulai" essay.
-- =============================================================================

ALTER TABLE sesi_ujian
  ADD COLUMN IF NOT EXISTS akses_mulai_essay_dibuka BOOLEAN NOT NULL DEFAULT FALSE;
