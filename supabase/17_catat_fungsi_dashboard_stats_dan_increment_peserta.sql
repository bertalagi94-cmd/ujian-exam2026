-- =============================================================================
-- Migrasi 17: Catat fungsi get_dashboard_stats & increment_jumlah_peserta
--
-- LATAR BELAKANG (temuan audit — lihat percakapan pengembangan):
-- src/app/api/admin/dashboard/route.ts memanggil db.rpc('get_dashboard_stats')
-- untuk menghitung rata-rata nilai & rata-rata per mapel lewat AVG/GROUP BY
-- di level PostgreSQL. Komentar di file itu sendiri sudah mengakui fungsi ini
-- "tidak ada di repo ini (dibuat langsung di Supabase)".
--
-- src/app/api/siswa/ujian/validasi/route.ts memanggil
-- db.rpc('increment_jumlah_peserta', { sesi_id_param: sesi.id }) setiap kali
-- siswa baru mulai ujian, untuk menaikkan kolom sesi_ujian.jumlah_peserta
-- (kolom ini sendiri SUDAH terdokumentasi di 01_schema.sql — hanya fungsi
-- increment-nya yang tidak).
--
-- Sama seperti migrasi 16: kedua fungsi ini TERNYATA sudah aktif berjalan di
-- database production, dibuat langsung lewat SQL Editor Supabase, tidak
-- pernah disalin ke file migrasi mana pun di repo ini.
--
-- DAMPAK sebelum migrasi ini: kalau database dibuat ulang dari nol dengan
-- menjalankan seluruh file migrasi 01-16, dashboard Admin (kartu ringkasan
-- rata-rata nilai & nilai per mapel) akan error "function does not exist",
-- dan penghitung jumlah peserta ujian per sesi (dipakai di halaman
-- Monitoring, Laporan Lengkap, Analisis Ujian, dsb.) akan diam-diam tetap 0
-- terus walau siswa sudah mulai ujian — tidak ada error yang terlihat siswa,
-- tapi datanya salah di semua laporan yang bergantung pada jumlah_peserta.
--
-- Isi migrasi ini disalin PERSIS (bukan ditulis ulang dari tebakan) dari
-- hasil pg_get_functiondef() pada database production yang sama. Aman
-- dijalankan berkali-kali: CREATE OR REPLACE FUNCTION menimpa definisi yang
-- sama (no-op kalau tidak berubah).
-- =============================================================================

-- ── Statistik dashboard Admin (rata-rata nilai & rata-rata per mapel) ──────
CREATE OR REPLACE FUNCTION public.get_dashboard_stats()
 RETURNS json
 LANGUAGE sql
 STABLE
AS $function$
  WITH nilai_efektif AS (
    SELECT
      n.mapel_id,
      CASE
        WHEN COALESCE((su.info_json->>'essay_aktif')::boolean, false)
             AND n.dirilis IS TRUE
             AND n.nilai_total IS NOT NULL
        THEN n.nilai_total
        ELSE n.nilai
      END AS nilai_pakai
    FROM nilai n
    LEFT JOIN sesi_ujian su ON su.id = n.sesi_id
  )
  SELECT json_build_object(
    'rata_rata_nilai', ROUND(AVG(nilai_pakai)::numeric, 0),
    'nilai_per_mapel', (
      SELECT json_agg(x ORDER BY x.total DESC) FROM (
        SELECT mapel_id, ROUND(AVG(nilai_pakai)::numeric, 0) AS rata, COUNT(*) AS total
        FROM nilai_efektif
        GROUP BY mapel_id
        ORDER BY total DESC
        LIMIT 10
      ) x
    )
  )
  FROM nilai_efektif;
$function$;

-- ── Penambah jumlah_peserta di sesi_ujian saat siswa mulai ujian ───────────
CREATE OR REPLACE FUNCTION public.increment_jumlah_peserta(sesi_id_param text)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
AS $function$
  UPDATE sesi_ujian
    SET jumlah_peserta = COALESCE(jumlah_peserta, 0) + 1
    WHERE id = sesi_id_param;
$function$;
