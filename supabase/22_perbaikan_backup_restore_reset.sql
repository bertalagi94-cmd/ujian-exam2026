-- =============================================================================
-- Migrasi 22: perbaikan backup / restore / reset
--
-- WAJIB dijalankan SEBELUM memakai kode baru admin/backup, admin/restore, dan
-- admin/reset. Restore versi baru menolak berjalan kalau fungsi
-- `sinkron_sequence_setelah_restore` belum ada (supaya tidak berakhir di
-- kondisi rusak yang dijelaskan di bawah).
--
-- Aman dijalankan berulang (CREATE OR REPLACE).
--
-- ── MASALAH 1: sequence BIGSERIAL tidak disinkronkan setelah restore ─────────
-- Enam tabel memakai kolom `id BIGSERIAL`: siswa_ujian, jawaban, jawaban_essay,
-- jawaban_essay_foto, skor_essay_siswa, log_reset.
--   - Reset memakai `TRUNCATE ... RESTART IDENTITY` → sequence kembali ke 1.
--   - Restore meng-INSERT baris dengan `id` eksplisit dari file backup
--     (mis. 1..33196) — dan INSERT dengan id eksplisit TIDAK menggeser sequence.
--   - Akibatnya INSERT berikutnya tanpa id (mis. fungsi sync_jawaban_revisi:
--     `INSERT INTO jawaban (sesi_id, nis, ...)`) mengambil nextval() = 1 dan
--     menabrak primary key yang sudah terisi → "duplicate key value violates
--     unique constraint" → jawaban siswa gagal tersimpan di ujian pertama
--     setelah restore. Hal yang sama terjadi kalau restore dilakukan ke
--     project Supabase yang baru/kosong.
-- Fungsi di bawah menyetel ulang tiap sequence ke MAX(id)+1.
--
-- ── MASALAH 2: skor_essay_siswa tidak masuk whitelist truncate ───────────────
-- Tabel ini sebelumnya tidak ikut ter-reset sama sekali. Sekarang reset dan
-- restore memakai TRUNCATE untuknya (jumlah barisnya sebanding jawaban_essay),
-- jadi whitelist di truncate_tabel_besar harus ikut diperbarui. Daftar ini
-- HARUS sinkron dengan TRUNCATE_TABLES di src/lib/backup-restore-shared.ts.
-- =============================================================================

-- ── 1. Sinkronisasi sequence ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION sinkron_sequence_setelah_restore()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  t    text;
  seq  text;
  maks bigint;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'siswa_ujian',
    'jawaban',
    'jawaban_essay',
    'jawaban_essay_foto',
    'skor_essay_siswa',
    'log_reset'
  ]
  LOOP
    -- Lewati kalau tabelnya tidak ada di database ini (mis. migrasi essay
    -- belum dijalankan) — bukan error.
    IF to_regclass(format('public.%I', t)) IS NULL THEN
      CONTINUE;
    END IF;

    seq := pg_get_serial_sequence(format('public.%I', t), 'id');
    IF seq IS NULL THEN
      CONTINUE;
    END IF;

    EXECUTE format('SELECT COALESCE(MAX(id), 0) FROM public.%I', t) INTO maks;

    -- is_called = false → nextval() berikutnya mengembalikan tepat maks + 1
    PERFORM setval(seq, maks + 1, false);
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION sinkron_sequence_setelah_restore() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION sinkron_sequence_setelah_restore() TO service_role;

-- ── 2. Whitelist truncate_tabel_besar (tambah skor_essay_siswa) ──────────────
CREATE OR REPLACE FUNCTION truncate_tabel_besar(nama_tabel TEXT)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF nama_tabel NOT IN (
    'jawaban',
    'jawaban_essay',
    'jawaban_essay_foto',
    'skor_essay_siswa',
    'siswa_ujian',
    'nilai',
    'pelanggaran',
    'log_reset',
    'log_aktivitas'
  ) THEN
    RAISE EXCEPTION 'truncate_tabel_besar: tabel "%" tidak diizinkan', nama_tabel;
  END IF;

  EXECUTE format('TRUNCATE TABLE %I RESTART IDENTITY', nama_tabel);
END;
$$;

REVOKE ALL ON FUNCTION truncate_tabel_besar(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION truncate_tabel_besar(TEXT) TO service_role;

-- ── 3. Sinkronkan sekali sekarang (aman: hanya menyetel ke MAX(id)+1) ────────
SELECT sinkron_sequence_setelah_restore();
