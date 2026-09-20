-- =============================================================================
-- Migrasi: revisi per-jawaban (ganti timestamp-merge yang tidak setara) +
-- dukungan PG offline -> Essay.
--
-- Latar belakang: mergeJawabanDenganWaktu() di client membandingkan
-- Date.now() (waktu siswa mengubah jawaban) dengan jawaban.updated_at
-- (waktu SERVER menerima request). Dua jam yang berbeda sumber ini bisa
-- membuat jawaban lama yang terlambat sync terlihat "lebih baru" daripada
-- jawaban lokal yang sebenarnya baru. Solusinya: nomor revisi yang naik
-- monoton per jawaban, dibuat di client, tidak bergantung jam wall-clock.
--
-- Aman dijalankan berulang (IF NOT EXISTS / OR REPLACE / ON CONFLICT).
-- Kompatibel mundur: kalau migrasi ini belum dijalankan tapi kode sudah
-- di-deploy, route sync/route.ts jatuh ke jalur upsert lama (lihat komentar
-- FALLBACK di sana).
-- =============================================================================

-- ── 1. Nomor revisi per jawaban, dibuat di CLIENT saat siswa mengubah pilihan.
-- Naik monoton per (sesi,nis,soal): 1, 2, 3, ... Tidak pernah dibandingkan
-- dengan jam manapun, jadi tidak terpengaruh jam laptop siswa berbeda dengan
-- jam server, maupun request lama yang terlambat sampai.
ALTER TABLE jawaban
  ADD COLUMN IF NOT EXISTS revisi INTEGER NOT NULL DEFAULT 0;

-- ── 2. Fungsi atomik: terima banyak baris jawaban sekaligus, hanya terapkan
-- baris yang revisinya lebih besar dari yang tersimpan. Mengembalikan status
-- SETIAP baris yang diminta (diterima atau tidak) berikut state server yang
-- berlaku saat ini, supaya client tahu persis mana yang perlu di-resync
-- (biasanya tidak perlu -- kalau ditolak berarti server sudah punya revisi
-- >= punya client) dan mana yang perlu menimpa state lokal.
--
-- p_records: jsonb array, tiap elemen:
--   { "sesi_id": "...", "nis": "...", "soal_id": "...", "jawaban": "...", "revisi": 3 }
CREATE OR REPLACE FUNCTION sync_jawaban_revisi(p_records JSONB)
RETURNS TABLE(
  out_soal_id TEXT,
  out_jawaban TEXT,
  out_revisi INTEGER,
  out_accepted BOOLEAN
) AS $$
BEGIN
  RETURN QUERY
  WITH input AS (
    SELECT
      (r->>'sesi_id')::text AS sesi_id,
      (r->>'nis')::text     AS nis,
      (r->>'soal_id')::text AS soal_id,
      (r->>'jawaban')::text AS jawaban,
      COALESCE((r->>'revisi')::int, 0) AS revisi
    FROM jsonb_array_elements(p_records) AS r
  ),
  upserted AS (
    INSERT INTO jawaban (sesi_id, nis, soal_id, jawaban, revisi, updated_at, sync_status, local_timestamp)
    SELECT sesi_id, nis, soal_id, jawaban, revisi, NOW(), 'SYNCED',
           (EXTRACT(EPOCH FROM NOW()) * 1000)::bigint
    FROM input
    ON CONFLICT (sesi_id, nis, soal_id) DO UPDATE
      SET jawaban         = EXCLUDED.jawaban,
          revisi          = EXCLUDED.revisi,
          updated_at      = NOW(),
          sync_status     = 'SYNCED',
          local_timestamp = EXCLUDED.local_timestamp
      -- Inti perbaikan: request lama yang terlambat sampai (revisi kecil)
      -- TIDAK diizinkan menimpa jawaban yang revisinya sudah lebih tinggi
      -- di server -- tidak peduli urutan kedatangan request atau jam siapa
      -- yang benar.
      WHERE EXCLUDED.revisi > jawaban.revisi
    RETURNING sesi_id, nis, soal_id, jawaban, revisi
  )
  SELECT
    i.soal_id,
    COALESCE(u.jawaban, j.jawaban, i.jawaban),
    COALESCE(u.revisi, j.revisi, i.revisi),
    (u.soal_id IS NOT NULL) AS accepted
  FROM input i
  LEFT JOIN upserted u
    ON u.sesi_id = i.sesi_id AND u.nis = i.nis AND u.soal_id = i.soal_id
  LEFT JOIN jawaban j
    ON j.sesi_id = i.sesi_id AND j.nis = i.nis AND j.soal_id = i.soal_id
   AND u.soal_id IS NULL;
END;
$$ LANGUAGE plpgsql;

-- ── 3. Dukungan PG offline -> Essay ─────────────────────────────────────────
-- Jejak audit untuk klaim "PG selesai offline" (siswa klik selesai saat
-- device tidak bisa mencapai server; waktu selesai yang dikirim balik saat
-- online lagi tidak otomatis dipercaya mentah-mentah -- lihat
-- src/lib/klaim-offline.ts untuk validasi rentang & jedanya).
ALTER TABLE siswa_ujian
  ADD COLUMN IF NOT EXISTS pg_selesai_offline BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS pg_waktu_selesai_klaim TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS pg_offline_audit JSONB;

-- Catatan penting (lihat 07_essay.sql baris 58): status_essay masih
-- DEFAULT 'BELUM_MULAI'. Ini berarti guard "PG harus final dulu" TIDAK
-- boleh mengandalkan status_essay saja untuk membedakan "siswa belum mulai
-- PG" vs "siswa sudah selesai PG tapi belum masuk essay" -- keduanya sama2
-- BELUM_MULAI. Guard yang benar ada di kolom nilai (lihat essay/mulai/route.ts:
-- baris nilai untuk sesi+nis ini harus ADA dulu) -- lihat komentar di sana.

-- ── 4. Index pendukung query klaim offline / rekap ──────────────────────────
CREATE INDEX IF NOT EXISTS idx_jawaban_sesi_nis_revisi ON jawaban(sesi_id, nis, revisi);
