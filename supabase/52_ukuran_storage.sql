-- =============================================================================
-- Migrasi 52: Fungsi pembaca ukuran Storage & Database (untuk Panel Developer)
--
-- Dipakai oleh GET /api/developer/penyimpanan untuk menampilkan berapa besar
-- file di Supabase Storage dan ukuran database. HANYA membaca ukuran/jumlah
-- (tidak ada nama file, isi file, atau data siswa yang dikembalikan).
--
-- storage.objects tidak bisa dibaca lewat API tabel biasa, jadi dibungkus
-- fungsi SECURITY DEFINER yang hanya bisa dipanggil service_role.
-- Aman dijalankan ulang (CREATE OR REPLACE).
-- =============================================================================

CREATE OR REPLACE FUNCTION ukuran_storage_per_folder()
RETURNS TABLE (bucket_id TEXT, folder TEXT, jumlah_file BIGINT, ukuran_byte BIGINT)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, storage
AS $$
  SELECT
    o.bucket_id::text,
    CASE WHEN position('/' IN o.name) > 0 THEN split_part(o.name, '/', 1) ELSE '' END,
    count(*)::bigint,
    COALESCE(sum((o.metadata->>'size')::bigint), 0)::bigint
  FROM storage.objects o
  GROUP BY 1, 2
$$;

CREATE OR REPLACE FUNCTION ukuran_database()
RETURNS BIGINT
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT pg_database_size(current_database())::bigint
$$;

-- Tutup untuk selain service_role (pola sama dengan migrasi 23).
REVOKE ALL ON FUNCTION ukuran_storage_per_folder() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION ukuran_database()           FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION ukuran_storage_per_folder() TO service_role;
GRANT EXECUTE ON FUNCTION ukuran_database()           TO service_role;
