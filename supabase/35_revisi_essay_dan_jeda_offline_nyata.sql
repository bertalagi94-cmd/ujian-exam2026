-- =============================================================================
-- Migrasi: (A) nomor revisi untuk jawaban_essay — padanan PERSIS
-- sync_jawaban_revisi() di 20_pg_offline_dan_revisi_jawaban.sql, supaya essay
-- tidak lagi memakai perbandingan jam client-vs-server-menerima-request yang
-- terbukti tidak setara (lihat komentar panjang di migrasi 20 & di
-- src/lib/jawaban-merge.ts — masalahnya identik untuk essay).
--
-- (B) Migrasi ini TIDAK menambah kolom apa pun untuk "jeda offline nyata"
-- (poin #4 dari audit) — infrastrukturnya SUDAH ADA: siswa_ujian.last_heartbeat
-- (lihat 01_schema.sql baris 193, diperbarui server-side tiap poll cek-sesi di
-- src/app/api/siswa/ujian/cek-sesi/route.ts). Perubahan untuk poin itu murni
-- di kode aplikasi (src/lib/deadline-pg.ts + sync/route.ts), tidak perlu
-- skema baru.
--
-- Aman dijalankan berulang (IF NOT EXISTS / OR REPLACE).
-- Kompatibel mundur: sebelum migrasi ini dijalankan, essay/jawab/route.ts
-- FAIL CLOSED kalau RPC ini tidak ada (sama seperti kebijakan sync PG di
-- migrasi 20/34) — bukan diam-diam jatuh ke upsert lama tanpa proteksi revisi.
-- =============================================================================

-- ── 1. Nomor revisi per jawaban essay, dibuat di CLIENT saat siswa mengetik.
-- Naik monoton per (sesi,nis,soal_essay), sama seperti kolom `jawaban.revisi`.
ALTER TABLE jawaban_essay
  ADD COLUMN IF NOT EXISTS revisi INTEGER NOT NULL DEFAULT 0;

-- ── 2. Fungsi atomik, padanan sync_jawaban_revisi() tapi untuk jawaban_essay.
-- p_records: jsonb array, tiap elemen:
--   { "sesi_id": "...", "nis": "...", "soal_essay_id": "...", "jawaban_teks": "...", "revisi": 3 }
CREATE OR REPLACE FUNCTION sync_jawaban_essay_revisi(p_records JSONB)
RETURNS TABLE(
  out_soal_essay_id TEXT,
  out_jawaban_teks TEXT,
  out_revisi INTEGER,
  out_accepted BOOLEAN
) AS $$
BEGIN
  RETURN QUERY
  WITH input AS (
    SELECT
      (r->>'sesi_id')::text       AS sesi_id,
      (r->>'nis')::text           AS nis,
      (r->>'soal_essay_id')::text AS soal_essay_id,
      (r->>'jawaban_teks')::text  AS jawaban_teks,
      COALESCE((r->>'revisi')::int, 0) AS revisi
    FROM jsonb_array_elements(p_records) AS r
  ),
  upserted AS (
    INSERT INTO jawaban_essay (sesi_id, nis, soal_essay_id, jawaban_teks, revisi, updated_at)
    SELECT sesi_id, nis, soal_essay_id, jawaban_teks, revisi, NOW()
    FROM input
    ON CONFLICT (sesi_id, nis, soal_essay_id) DO UPDATE
      SET jawaban_teks = EXCLUDED.jawaban_teks,
          revisi       = EXCLUDED.revisi,
          updated_at   = NOW()
      -- Inti perbaikan (sama seperti migrasi 20 untuk PG): request lama yang
      -- terlambat sampai (revisi kecil) TIDAK diizinkan menimpa jawaban yang
      -- revisinya sudah lebih tinggi di server.
      WHERE EXCLUDED.revisi > jawaban_essay.revisi
    RETURNING sesi_id, nis, soal_essay_id, jawaban_teks, revisi
  )
  SELECT
    i.soal_essay_id,
    COALESCE(u.jawaban_teks, j.jawaban_teks, i.jawaban_teks),
    COALESCE(u.revisi, j.revisi, i.revisi),
    (u.soal_essay_id IS NOT NULL) AS accepted
  FROM input i
  LEFT JOIN upserted u
    ON u.sesi_id = i.sesi_id AND u.nis = i.nis AND u.soal_essay_id = i.soal_essay_id
  LEFT JOIN jawaban_essay j
    ON j.sesi_id = i.sesi_id AND j.nis = i.nis AND j.soal_essay_id = i.soal_essay_id
   AND u.soal_essay_id IS NULL;
END;
$$ LANGUAGE plpgsql;

-- ── 3. Index pendukung ───────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_jawaban_essay_sesi_nis_revisi ON jawaban_essay(sesi_id, nis, revisi);
