-- =============================================================================
-- Migrasi 54: PENGERASAN HAK AKSES untuk objek yang dibuat SETELAH migrasi 23
--
-- LATAR BELAKANG
--   Migrasi 23 mencabut hak anon/authenticated pada semua tabel & fungsi yang
--   ada saat itu, dan mengubah default privileges supaya objek baru tidak
--   otomatis terbuka. Dua objek yang dibuat sesudahnya tidak menyertakan
--   REVOKE eksplisit (padahal migrasi 23 mewajibkannya untuk objek baru):
--
--     * fungsi sync_jawaban_essay_revisi(jsonb)   (migrasi 35)
--         Padanan essay dari sync_jawaban_revisi() yang justru dicatat sebagai
--         temuan di migrasi 23: sesi_id & nis dibaca dari payload.
--     * tabel izin_layar_pantau                   (migrasi 44)
--         Sudah ENABLE RLS, tetapi tanpa REVOKE.
--
--   Fungsinya bukan SECURITY DEFINER dan RLS aktif, jadi risiko nyata kecil
--   selama default privileges migrasi 23 berlaku untuk role yang menjalankan
--   migrasi. Migrasi ini menutup ketergantungan itu: hasilnya sama di semua
--   kondisi, dan aman dijalankan berulang (idempotent).
--
-- Jalankan di Supabase SQL Editor. Tidak mengubah data maupun perilaku aplikasi
-- (aplikasi hanya memakai service_role).
-- =============================================================================

BEGIN;

DO $$
BEGIN
  IF to_regprocedure('public.sync_jawaban_essay_revisi(jsonb)') IS NOT NULL THEN
    REVOKE ALL ON FUNCTION public.sync_jawaban_essay_revisi(jsonb) FROM PUBLIC;
    REVOKE ALL ON FUNCTION public.sync_jawaban_essay_revisi(jsonb) FROM anon, authenticated;
    GRANT EXECUTE ON FUNCTION public.sync_jawaban_essay_revisi(jsonb) TO service_role;
  ELSE
    RAISE NOTICE 'Fungsi sync_jawaban_essay_revisi(jsonb) tidak ada (migrasi 35 belum dijalankan?), dilewati';
  END IF;

  IF to_regclass('public.izin_layar_pantau') IS NOT NULL THEN
    EXECUTE 'REVOKE ALL ON TABLE public.izin_layar_pantau FROM anon, authenticated';
    EXECUTE 'ALTER TABLE public.izin_layar_pantau ENABLE ROW LEVEL SECURITY';
  ELSE
    RAISE NOTICE 'Tabel izin_layar_pantau tidak ada (migrasi 44 belum dijalankan?), dilewati';
  END IF;
END $$;

-- ── POSTFLIGHT: batalkan seluruh migrasi kalau masih ada yang terbuka ────────
DO $$
BEGIN
  IF to_regprocedure('public.sync_jawaban_essay_revisi(jsonb)') IS NOT NULL
     AND (has_function_privilege('anon', 'public.sync_jawaban_essay_revisi(jsonb)', 'EXECUTE')
       OR has_function_privilege('authenticated', 'public.sync_jawaban_essay_revisi(jsonb)', 'EXECUTE')) THEN
    RAISE EXCEPTION 'Migrasi 54 DIBATALKAN: sync_jawaban_essay_revisi masih bisa dieksekusi anon/authenticated.';
  END IF;

  IF to_regclass('public.izin_layar_pantau') IS NOT NULL
     AND (has_table_privilege('anon', 'public.izin_layar_pantau', 'SELECT')
       OR has_table_privilege('authenticated', 'public.izin_layar_pantau', 'SELECT')) THEN
    RAISE EXCEPTION 'Migrasi 54 DIBATALKAN: izin_layar_pantau masih bisa dibaca anon/authenticated.';
  END IF;
END $$;

COMMIT;

-- UJI DARI LUAR (opsional, ganti URL & anon key):
--   curl -s -X POST "$SUPABASE_URL/rest/v1/rpc/sync_jawaban_essay_revisi" \
--     -H "apikey: $ANON_KEY" -H "Content-Type: application/json" -d '{"p_records":[]}'
--   -> harus berupa error "permission denied for function", bukan hasil kosong.
