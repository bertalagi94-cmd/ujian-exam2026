-- supabase/05_fix_rls.sql
--
-- FIX BUG #3 (RLS): hasil audit langsung ke Supabase Dashboard menunjukkan
-- 17 dari 19 tabel sudah punya RLS aktif tanpa policy (aman secara default —
-- kalau RLS aktif tapi 0 policy, semua baris ditolak untuk role anon/
-- authenticated, app selalu memakai service_role yang otomatis bypass RLS).
-- TAPI 3 tabel bermasalah:
--
--   1. jawaban       — RLS MATI TOTAL, dikombinasikan dengan grant lebar
--                       (anon: SELECT+INSERT+UPDATE+DELETE). Siapa pun yang
--                       punya NEXT_PUBLIC_SUPABASE_ANON_KEY (selalu ter-bundle
--                       ke browser) bisa langsung baca/tulis jawaban ujian
--                       SEMUA siswa lewat REST API Supabase, melewati semua
--                       validasi status RESET/TERKUNCI & tenggat waktu yang
--                       ada di /api/siswa/ujian/sync dan /selesai (validasi
--                       itu hanya ada di level API, tidak ada padanannya di
--                       level RLS untuk tabel ini).
--
--   2. siswa_ujian   — RLS aktif, tapi 1 policy SELECT `USING (true)` untuk
--                       role {anon, authenticated} — siapa saja tanpa login
--                       bisa membaca status ujian semua siswa (nis, status,
--                       device_id, dll).
--
--   3. pelanggaran   — sama, policy SELECT `USING (true)` untuk role anon —
--                       riwayat pelanggaran/kedisiplinan siswa bisa dibaca
--                       siapa saja tanpa login.
--
-- Policy #2 dan #3 sepertinya sengaja dibuat untuk papan status ujian
-- publik (nama policy eksplisit "..._utk_monitor"), tapi kebutuhan itu
-- SUDAH dipenuhi oleh /api/public/aktivitas (lihat
-- src/app/api/public/aktivitas/route.ts) yang memakai service_role dan
-- TIDAK butuh policy anon sama sekali — jadi policy ini aman dihapus.
--
-- Jalankan file ini di Supabase SQL Editor (atau `supabase db push` kalau
-- dipakai lewat migration CLI). Aman dijalankan berkali-kali (idempotent).

-- ── 1. jawaban: nyalakan RLS, TANPA policy ──────────────────────────────────
-- Tanpa policy sama sekali + RLS aktif = semua akses anon/authenticated
-- ditolak secara default. App tetap jalan normal karena semua endpoint
-- (src/app/api/siswa/ujian/sync, /selesai, dll) memakai createAdminClient()
-- yaitu service_role, yang SELALU bypass RLS.
ALTER TABLE jawaban ENABLE ROW LEVEL SECURITY;

-- Jaga-jaga: hapus dulu kalau ternyata ada policy longgar yang sempat
-- dibuat manual di Dashboard tapi tidak ter-commit ke repo.
DROP POLICY IF EXISTS "izinkan_semua_jawaban" ON jawaban;

-- ── 2. siswa_ujian: hapus policy anon SELECT USING(true) ───────────────────
DROP POLICY IF EXISTS izinkan_baca_status_siswa_ujian_utk_monitor ON siswa_ujian;

-- ── 3. pelanggaran: hapus policy anon SELECT USING(true) ───────────────────
DROP POLICY IF EXISTS izinkan_baca_pelanggaran_utk_monitor ON pelanggaran;

-- ── Verifikasi setelah menjalankan file ini ─────────────────────────────────
-- Jalankan query berikut dan pastikan hasilnya kosong / rowsecurity = true
-- untuk ketiga tabel di atas:
--
--   select relname as tabel, relrowsecurity as rls_aktif
--   from pg_class
--   where relname in ('jawaban', 'siswa_ujian', 'pelanggaran');
--
--   select tablename, policyname, roles, cmd
--   from pg_policies
--   where tablename in ('jawaban', 'siswa_ujian', 'pelanggaran');
--
-- Setelah ini, coba akses tabel `jawaban` langsung lewat REST API pakai
-- anon key (mis. curl -H "apikey: <ANON_KEY>" <PROJECT_URL>/rest/v1/jawaban)
-- dan pastikan hasilnya array kosong / 401, BUKAN daftar jawaban siswa.
