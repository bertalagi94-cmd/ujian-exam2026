-- =============================================================================
-- Migrasi 23: HARDENING KEAMANAN DATABASE (RLS + hak akses fungsi/tabel)
--
-- ── LATAR BELAKANG (temuan audit) ────────────────────────────────────────────
-- Aplikasi ini HANYA memakai service_role (createAdminClient) untuk semua
-- akses database. Client `anon`/`authenticated` tidak dipakai untuk apa pun
-- yang hidup (satu-satunya pemakai, src/hooks/useMonitorRealtime.ts, tidak
-- diimpor di mana pun dan policy anon-nya sudah dihapus di migrasi 05).
--
-- Tapi migrasi lama tidak konsisten mencabut hak akses:
--
--   1. FUNGSI. Di Supabase, objek baru di schema public otomatis mendapat
--      EXECUTE untuk anon & authenticated lewat default privileges.
--      `REVOKE ... FROM PUBLIC` (dipakai di migrasi 10 dan 22) TIDAK mencabut
--      grant eksplisit itu. Migrasi 19 dan 21 sudah benar (mencabut dari
--      PUBLIC, anon, authenticated); migrasi berikut TIDAK:
--        - truncate_tabel_besar      (10, 22) SECURITY DEFINER, whitelist
--                                    mencakup nilai/jawaban/siswa_ujian/
--                                    pelanggaran -> bisa dikosongkan lewat
--                                    /rest/v1/rpc dengan anon key publik
--        - sinkron_sequence_setelah_restore (22) SECURITY DEFINER
--        - set_status_paket_soal / set_status_paket_essay (16) SECURITY
--                                    DEFINER tanpa cek pemanggil -> siapa
--                                    pun bisa menyetujui/menolak paket soal
--        - increment_jumlah_peserta  (17) SECURITY DEFINER, tanpa search_path
--        - sync_jawaban_revisi       (20) tanpa REVOKE; sesi_id & nis dibaca
--                                    dari payload -> bisa menulis jawaban
--                                    siswa mana pun tanpa lewat validasi
--                                    deadline/device/status di route API
--
--   2. TABEL. Tabel yang dibuat setelah audit migrasi 05 tidak pernah diberi
--      ENABLE ROW LEVEL SECURITY: soal_essay, jawaban_essay,
--      jawaban_essay_foto, paket_essay, skor_essay_siswa, metrik_sistem,
--      sekolah, kisi_kisi. Tabel baru juga otomatis mendapat grant ke anon.
--
-- ── YANG DILAKUKAN MIGRASI INI ───────────────────────────────────────────────
--   A. PREFLIGHT: berhenti (RAISE EXCEPTION) kalau migrasi 20/21/22 belum
--      terpasang. Tujuannya: setelah migrasi ini sukses, kode aplikasi boleh
--      fail-closed (tanpa jalur fallback lama) dengan aman.
--   B. ENABLE RLS di SEMUA tabel schema public.
--   C. Hapus semua policy untuk anon/authenticated/public (aplikasi tidak
--      memakainya; tanpa policy + RLS aktif = semua ditolak).
--   D. Cabut semua hak anon/authenticated pada tabel, sequence, dan fungsi;
--      izinkan EXECUTE fungsi hanya untuk service_role.
--   E. Ubah default privileges supaya objek BARU tidak otomatis terbuka.
--   F. Kunci search_path fungsi increment_jumlah_peserta.
--   G. POSTFLIGHT: verifikasi hasilnya; kalau ada yang masih terbuka,
--      seluruh migrasi dibatalkan (rollback).
--
-- Seluruhnya satu transaksi. Aman dijalankan berulang (idempotent).
--
-- ── SETELAH MIGRASI INI SUKSES ───────────────────────────────────────────────
--   1. Deploy kode terbaru (fallback lama di sync/selesai sudah dihapus).
--   2. Jalankan uji dari luar (lihat "UJI DARI LUAR" di bagian bawah file).
--   3. WAJIB: setiap migrasi/tabel/fungsi BARU ke depan harus menyertakan
--      RLS + REVOKE eksplisit (lihat pola di 19 dan 21) — default privileges
--      di bawah membantu, tapi jangan mengandalkannya sendirian.
-- =============================================================================

BEGIN;

-- ── A. PREFLIGHT ─────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_hilang text[] := ARRAY[]::text[];
BEGIN
  IF to_regprocedure('public.sync_jawaban_revisi(jsonb)') IS NULL THEN
    v_hilang := array_append(v_hilang, 'fungsi sync_jawaban_revisi(jsonb) [migrasi 20]'::text);
  END IF;

  IF to_regprocedure('public.finalisasi_pg_atomik(text,text,jsonb,boolean,jsonb)') IS NULL THEN
    v_hilang := array_append(v_hilang, 'fungsi finalisasi_pg_atomik(...) [migrasi 21]'::text);
  END IF;

  IF to_regprocedure('public.truncate_tabel_besar(text)') IS NULL THEN
    v_hilang := array_append(v_hilang, 'fungsi truncate_tabel_besar(text) [migrasi 10/22]'::text);
  END IF;

  IF to_regprocedure('public.sinkron_sequence_setelah_restore()') IS NULL THEN
    v_hilang := array_append(v_hilang, 'fungsi sinkron_sequence_setelah_restore() [migrasi 22]'::text);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'jawaban' AND column_name = 'revisi'
  ) THEN
    v_hilang := array_append(v_hilang, 'kolom jawaban.revisi [migrasi 20]'::text);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'siswa_ujian' AND column_name = 'pg_selesai_offline'
  ) THEN
    v_hilang := array_append(v_hilang, 'kolom siswa_ujian.pg_selesai_offline [migrasi 20]'::text);
  END IF;

  IF array_length(v_hilang, 1) IS NOT NULL THEN
    RAISE EXCEPTION
      'Migrasi 23 DIBATALKAN. Prasyarat belum terpasang: %. Jalankan migrasi 20, 21, dan 22 dulu (berurutan), lalu ulangi migrasi ini.',
      array_to_string(v_hilang, '; ');
  END IF;
END $$;

-- ── B. ENABLE RLS di semua tabel schema public ───────────────────────────────
-- service_role memakai BYPASSRLS, jadi aplikasi tidak terpengaruh.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r', 'p')   -- tabel biasa & partitioned
  LOOP
    BEGIN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', r.relname);
    EXCEPTION WHEN insufficient_privilege THEN
      -- Tabel milik extension/role lain: lewati, jangan gagalkan migrasi.
      RAISE NOTICE 'Lewati tabel % (bukan milik role ini)', r.relname;
    END;
  END LOOP;
END $$;

-- ── C. Hapus policy untuk anon/authenticated/public ──────────────────────────
DO $$
DECLARE
  p record;
BEGIN
  FOR p IN
    SELECT schemaname, tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND roles && ARRAY['anon', 'authenticated', 'public']::name[]
  LOOP
    EXECUTE format('DROP POLICY %I ON %I.%I', p.policyname, p.schemaname, p.tablename);
    RAISE NOTICE 'Policy dihapus: %.% (%)', p.schemaname, p.tablename, p.policyname;
  END LOOP;
END $$;

-- ── D. Cabut hak anon/authenticated ──────────────────────────────────────────
REVOKE ALL ON ALL TABLES    IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO service_role;

-- ── E. Default privileges: objek BARU tidak otomatis terbuka ─────────────────
-- Default privileges berlaku per-role pembuat objek. Di Supabase objek dibuat
-- oleh `postgres` (SQL Editor) atau `supabase_admin` (dashboard/migrasi CLI).
--
-- PENTING: EXECUTE pada fungsi baru diberikan ke PUBLIC secara bawaan
-- (default GLOBAL PostgreSQL). Varian `IN SCHEMA public ... REVOKE` TIDAK
-- bisa mencabut default global itu — hanya menambah/mengurangi di atasnya.
-- Karena itu pencabutan dari PUBLIC harus memakai bentuk TANPA `IN SCHEMA`.
-- (Hasilnya berlaku untuk fungsi baru buatan role tsb di schema mana pun;
-- service_role diberi EXECUTE eksplisit di schema public di bawah.)
DO $$
DECLARE
  v_role text;
BEGIN
  FOREACH v_role IN ARRAY ARRAY['postgres', 'supabase_admin']
  LOOP
    BEGIN
      -- global: cabut EXECUTE bawaan PUBLIC pada fungsi baru
      EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC', v_role);
      -- schema public: cabut grant otomatis ke anon/authenticated
      EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated', v_role);
      EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated', v_role);
      EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM anon, authenticated', v_role);
      -- service_role tetap otomatis dapat akses objek baru di public
      EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public GRANT ALL ON TABLES TO service_role', v_role);
      EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role', v_role);
      EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO service_role', v_role);
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'Default privileges untuk role % dilewati: %', v_role, SQLERRM;
    END;
  END LOOP;
END $$;

-- ── F. Kunci search_path fungsi SECURITY DEFINER yang belum punya ────────────
ALTER FUNCTION public.increment_jumlah_peserta(text) SET search_path = public;

-- ── G. POSTFLIGHT: verifikasi; kalau gagal, rollback semuanya ────────────────
DO $$
DECLARE
  v_masalah text[] := ARRAY[]::text[];
  r record;
BEGIN
  -- Fungsi buatan aplikasi (milik role yang menjalankan migrasi ini) tidak
  -- boleh bisa dieksekusi anon/authenticated.
  FOR r IN
    SELECT p.proname, p.oid
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prokind = 'f'
      AND pg_get_userbyid(p.proowner) = current_user
      AND (has_function_privilege('anon', p.oid, 'EXECUTE')
           OR has_function_privilege('authenticated', p.oid, 'EXECUTE'))
  LOOP
    v_masalah := v_masalah || ('fungsi ' || r.proname || ' masih bisa dieksekusi anon/authenticated');
  END LOOP;

  -- Tabel milik role ini: RLS harus aktif & anon/authenticated tanpa hak.
  FOR r IN
    SELECT c.relname, c.oid, c.relrowsecurity
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r', 'p')
      AND pg_get_userbyid(c.relowner) = current_user
  LOOP
    IF NOT r.relrowsecurity THEN
      v_masalah := v_masalah || ('tabel ' || r.relname || ' RLS belum aktif');
    END IF;
    IF has_table_privilege('anon', r.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
       OR has_table_privilege('authenticated', r.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE') THEN
      v_masalah := v_masalah || ('tabel ' || r.relname || ' masih punya hak anon/authenticated');
    END IF;
  END LOOP;

  IF array_length(v_masalah, 1) IS NOT NULL THEN
    RAISE EXCEPTION 'Migrasi 23 DIBATALKAN (postflight gagal): %', array_to_string(v_masalah, '; ');
  END IF;

  RAISE NOTICE 'Migrasi 23 sukses: RLS aktif di semua tabel, anon/authenticated tanpa hak.';
END $$;

COMMIT;

-- =============================================================================
-- UJI DARI LUAR (jalankan dari terminal, BUKAN di SQL Editor).
-- Ganti <URL> dan <ANON_KEY> dengan nilai project. Semua HARUS ditolak
-- (HTTP 401/403/404 atau array kosong), TIDAK BOLEH sukses:
--
--   # 1. Fungsi berbahaya
--   curl -s -X POST "<URL>/rest/v1/rpc/truncate_tabel_besar" \
--     -H "apikey: <ANON_KEY>" -H "Authorization: Bearer <ANON_KEY>" \
--     -H "Content-Type: application/json" -d '{"nama_tabel":"log_aktivitas"}'
--
--   # 2. Tulis jawaban siswa lain
--   curl -s -X POST "<URL>/rest/v1/rpc/sync_jawaban_revisi" \
--     -H "apikey: <ANON_KEY>" -H "Authorization: Bearer <ANON_KEY>" \
--     -H "Content-Type: application/json" -d '{"p_records":[]}'
--
--   # 3. Baca tabel essay
--   curl -s "<URL>/rest/v1/jawaban_essay?select=*&limit=1" \
--     -H "apikey: <ANON_KEY>" -H "Authorization: Bearer <ANON_KEY>"
--
--   # 4. Baca data siswa
--   curl -s "<URL>/rest/v1/siswa_ujian?select=*&limit=1" \
--     -H "apikey: <ANON_KEY>" -H "Authorization: Bearer <ANON_KEY>"
--
-- Uji uji fungsional aplikasi setelahnya (login siswa, mulai ujian, sync
-- jawaban, selesai, monitoring pengawas, backup) untuk memastikan tidak ada
-- yang bergantung pada hak anon.
-- =============================================================================
