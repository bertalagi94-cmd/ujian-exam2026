-- =============================================================================
-- Migrasi 38: Durasi essay ditetapkan ADMIN di jadwal (guru hanya mengusulkan)
--
-- Latar belakang:
--   Admin membuat jadwal per mapel dan menentukan durasi (durasi PG). Di sisi
--   lain guru menentukan durasi essay di paket essay. Admin tidak punya
--   kendali atas angka kedua, padahal total waktu siswa = PG + Essay.
--
-- Aturan baru:
--   - paket_essay.durasi_menit            = USULAN guru (nama kolom tidak diubah)
--   - jadwal.essay_durasi_menit (kolom lama dari migrasi 07, tidak terpakai
--     sejak durasi pindah ke paket essay) = KEPUTUSAN admin. NULL berarti
--     "ikuti usulan guru".
--   - Saat sesi dibuka, nilai admin dipakai kalau ada, kalau tidak usulan guru
--     (lihat src/lib/gabungKirim.ts dan src/lib/durasi-ujian.ts).
--
-- Yang dilakukan migrasi ini:
--   1. Membersihkan sisa nilai lama di jadwal.essay_durasi_menit. Kolom itu
--      dulu diisi sebelum durasi pindah ke paket essay, jadi isinya bisa
--      usang. Tanpa dibersihkan, nilai usang itu akan tiba-tiba menimpa usulan
--      guru. Pembersihan HANYA berjalan sekali (ditandai lewat COMMENT kolom),
--      jadi menjalankan ulang migrasi tidak menghapus nilai yang sudah diisi
--      admin sesudahnya.
--   2. Memasang CHECK sederhana (kosong, atau 1..600 menit). Batas min/maks
--      yang sebenarnya (Pengaturan > Ujian) divalidasi di API.
--
-- Sesi yang SUDAH berjalan tidak terpengaruh: durasi essay sudah disalin ke
-- sesi_ujian.info_json saat sesi dibuka.
--
-- Aman dijalankan berulang (idempotent).
-- =============================================================================

DO $$
DECLARE
  penanda CONSTANT TEXT := 'Durasi essay ditetapkan admin (menit). NULL = ikuti usulan guru (paket_essay.durasi_menit).';
  komentar_sekarang TEXT;
BEGIN
  SELECT col_description('public.jadwal'::regclass, a.attnum)
    INTO komentar_sekarang
    FROM pg_attribute a
   WHERE a.attrelid = 'public.jadwal'::regclass
     AND a.attname = 'essay_durasi_menit'
     AND NOT a.attisdropped;

  IF komentar_sekarang IS DISTINCT FROM penanda THEN
    UPDATE jadwal SET essay_durasi_menit = NULL WHERE essay_durasi_menit IS NOT NULL;
    EXECUTE format('COMMENT ON COLUMN public.jadwal.essay_durasi_menit IS %L', penanda);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.jadwal'::regclass
       AND conname = 'jadwal_essay_durasi_menit_wajar'
  ) THEN
    ALTER TABLE jadwal
      ADD CONSTRAINT jadwal_essay_durasi_menit_wajar
      CHECK (essay_durasi_menit IS NULL OR essay_durasi_menit BETWEEN 1 AND 600);
  END IF;
END $$;

COMMENT ON COLUMN paket_essay.durasi_menit IS
  'USULAN durasi essay dari guru (menit). Keputusan akhir ada di jadwal.essay_durasi_menit (admin).';
