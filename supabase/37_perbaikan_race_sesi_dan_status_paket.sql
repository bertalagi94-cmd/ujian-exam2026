-- =============================================================================
-- Migrasi 37: Perbaikan celah race condition (hasil audit)
--
-- Isi (urut sesuai temuan audit):
--
--   1. SESI GANDA. Pembuatan sesi_ujian BERJALAN ada di 3 route
--      (guru/mode-pengawas, guru/susulan, admin/susulan), semuanya "cek lalu
--      insert" tanpa penjaga di database. Dua request yang nyaris bersamaan
--      (dua tab/perangkat, atau pengawas + admin) bisa membuat dua sesi
--      BERJALAN untuk jadwal yang sama dengan dua kode berbeda -> siswa
--      terbelah. Perbaikan: partial unique index satu sesi BERJALAN per
--      jadwal. Route menangkap error 23505 dan mengembalikan sesi yang sudah
--      ada (lihat src/lib/sesi-unik.ts).
--
--   2. STATUS ASAL PAKET. set_status_paket_soal / set_status_paket_essay
--      tidak memeriksa status asal. Halaman admin yang belum di-refresh bisa
--      menyetujui paket yang baru ditarik guru (DRAFT -> DISETUJUI).
--      Perbaikan: transisi yang sah saja yang diterima:
--         SETUJUI / TOLAK  : hanya dari MENUNGGU
--         BATAL_SETUJUI    : hanya dari DISETUJUI (hasilnya DRAFT)
--      Permintaan yang status tujuannya SAMA dengan status sekarang dianggap
--      berhasil tanpa mengubah apa pun (klik ganda aman). Transisi tidak sah
--      ditolak dengan SQLSTATE 'PT409' (PostgREST memetakannya ke HTTP 409).
--
--   4. PAKET GANDA. POST /api/guru/paket dan /api/guru/soal/impor mengecek
--      "sudah ada paket guru+mapel+kelas ini?" lalu insert, tanpa penjaga.
--      Perbaikan: fungsi buat_paket_soal_atomik() memakai advisory lock per
--      guru+mapel+kelas, sehingga cek dan insert menjadi satu langkah
--      serial. Sengaja TIDAK memakai unique index: route duplicate
--      (guru/paket/[id]/duplicate) dan jalur approve/demote memang mengizinkan
--      beberapa baris dengan kombinasi yang sama pada status tertentu, jadi
--      unique index bisa memutus alur yang sah dan bisa gagal dibuat kalau
--      data produksi sudah punya baris ganda.
--
--   (Temuan 3 -- soal ke paket MENUNGGU -- diperbaiki di sisi API saja,
--    lihat src/app/api/guru/soal/route.ts. Tidak butuh perubahan database.)
--
-- Aman dijalankan berulang (idempotent). Seluruhnya satu transaksi: kalau
-- preflight gagal, tidak ada yang berubah.
-- =============================================================================

BEGIN;

-- ── PREFLIGHT: jangan lanjut kalau sudah ada sesi BERJALAN ganda ─────────────
-- Unique index tidak bisa dibuat selama data ganda masih ada. Kalau error di
-- sini, tutup salah satu sesi ganda (Admin -> tutup paksa, atau Mode
-- Pengawas), lalu jalankan ulang file ini.
DO $$
DECLARE
  v_ganda text;
BEGIN
  SELECT string_agg(t.jadwal_id || ' (' || t.n || ' sesi)', ', ')
    INTO v_ganda
  FROM (
    SELECT jadwal_id, count(*) AS n
    FROM public.sesi_ujian
    WHERE status = 'BERJALAN' AND jadwal_id IS NOT NULL
    GROUP BY jadwal_id
    HAVING count(*) > 1
  ) t;

  IF v_ganda IS NOT NULL THEN
    RAISE EXCEPTION
      'Migrasi 37 dibatalkan: ada jadwal dengan lebih dari satu sesi BERJALAN: %. Tutup sesi ganda tersebut lalu jalankan ulang.',
      v_ganda;
  END IF;
END $$;

-- ── 1. Satu sesi BERJALAN per jadwal ─────────────────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS uq_sesi_berjalan_per_jadwal
  ON public.sesi_ujian USING btree (jadwal_id)
  WHERE (status = 'BERJALAN'::text);

-- ── 2a. set_status_paket_soal dengan pemeriksaan status asal ─────────────────
CREATE OR REPLACE FUNCTION public.set_status_paket_soal(p_paket_id text, p_new_status text, p_catatan text DEFAULT NULL::text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_mapel_id TEXT;
  v_kelas_id TEXT;
  v_status_awal TEXT;
  v_demoted_ids TEXT[];
BEGIN
  IF p_new_status NOT IN ('DISETUJUI', 'DITOLAK', 'DRAFT') THEN
    RAISE EXCEPTION 'set_status_paket_soal: status "%" tidak valid', p_new_status;
  END IF;

  SELECT mapel_id, kelas_id, status INTO v_mapel_id, v_kelas_id, v_status_awal
  FROM paket_soal WHERE id = p_paket_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'set_status_paket_soal: paket_soal % tidak ditemukan', p_paket_id;
  END IF;

  -- Klik ganda / permintaan ulang: statusnya sudah sesuai tujuan -> tidak
  -- ada yang perlu diubah.
  IF v_status_awal = p_new_status THEN
    RETURN 0;
  END IF;

  -- Pemeriksaan status asal (dilakukan SETELAH baris dikunci FOR UPDATE,
  -- jadi hasilnya pasti terhadap status terbaru, bukan status di layar admin).
  IF p_new_status IN ('DISETUJUI', 'DITOLAK') AND v_status_awal IS DISTINCT FROM 'MENUNGGU' THEN
    RAISE EXCEPTION 'Status paket sudah berubah (sekarang: %). Hanya paket berstatus MENUNGGU yang bisa disetujui atau ditolak. Muat ulang halaman.', COALESCE(v_status_awal, 'kosong')
      USING ERRCODE = 'PT409';
  END IF;

  IF p_new_status = 'DRAFT' AND v_status_awal IS DISTINCT FROM 'DISETUJUI' THEN
    RAISE EXCEPTION 'Status paket sudah berubah (sekarang: %). Hanya paket berstatus DISETUJUI yang bisa dibatalkan persetujuannya. Muat ulang halaman.', COALESCE(v_status_awal, 'kosong')
      USING ERRCODE = 'PT409';
  END IF;

  IF p_new_status = 'DISETUJUI' THEN
    -- Kunci semua paket lain di mapel+kelas yang sama supaya approval dua
    -- paket berbeda untuk kombinasi yang sama tidak bisa lolos bersamaan.
    PERFORM 1 FROM paket_soal
      WHERE mapel_id = v_mapel_id AND kelas_id = v_kelas_id
      FOR UPDATE;

    SELECT ARRAY_AGG(id) INTO v_demoted_ids
    FROM paket_soal
    WHERE mapel_id = v_mapel_id AND kelas_id = v_kelas_id
      AND status = 'DISETUJUI' AND id <> p_paket_id;

    IF v_demoted_ids IS NOT NULL THEN
      UPDATE paket_soal
      SET status = 'DRAFT', notif_dibaca = false,
          catatan = 'Otomatis dikembalikan ke draft karena paket lain untuk mapel+kelas ini disetujui.'
      WHERE id = ANY(v_demoted_ids);

      UPDATE soal SET status = 'DRAFT'
      WHERE paket_id = ANY(v_demoted_ids) AND status = 'DISETUJUI';
    END IF;
  END IF;

  UPDATE paket_soal
  SET status = p_new_status, catatan = p_catatan, notif_dibaca = false
  WHERE id = p_paket_id;

  UPDATE soal SET status = p_new_status WHERE paket_id = p_paket_id;

  RETURN COALESCE(array_length(v_demoted_ids, 1), 0);
END;
$function$;

-- ── 2b. set_status_paket_essay: pola yang sama ───────────────────────────────
CREATE OR REPLACE FUNCTION public.set_status_paket_essay(p_paket_id text, p_new_status text, p_catatan text DEFAULT NULL::text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_mapel_id TEXT;
  v_kelas_id TEXT;
  v_status_awal TEXT;
  v_demoted_ids TEXT[];
BEGIN
  IF p_new_status NOT IN ('DISETUJUI', 'DITOLAK', 'DRAFT') THEN
    RAISE EXCEPTION 'set_status_paket_essay: status "%" tidak valid', p_new_status;
  END IF;

  SELECT mapel_id, kelas_id, status INTO v_mapel_id, v_kelas_id, v_status_awal
  FROM paket_essay WHERE id = p_paket_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'set_status_paket_essay: paket_essay % tidak ditemukan', p_paket_id;
  END IF;

  IF v_status_awal = p_new_status THEN
    RETURN 0;
  END IF;

  IF p_new_status IN ('DISETUJUI', 'DITOLAK') AND v_status_awal IS DISTINCT FROM 'MENUNGGU' THEN
    RAISE EXCEPTION 'Status paket sudah berubah (sekarang: %). Hanya paket berstatus MENUNGGU yang bisa disetujui atau ditolak. Muat ulang halaman.', COALESCE(v_status_awal, 'kosong')
      USING ERRCODE = 'PT409';
  END IF;

  IF p_new_status = 'DRAFT' AND v_status_awal IS DISTINCT FROM 'DISETUJUI' THEN
    RAISE EXCEPTION 'Status paket sudah berubah (sekarang: %). Hanya paket berstatus DISETUJUI yang bisa dibatalkan persetujuannya. Muat ulang halaman.', COALESCE(v_status_awal, 'kosong')
      USING ERRCODE = 'PT409';
  END IF;

  IF p_new_status = 'DISETUJUI' THEN
    PERFORM 1 FROM paket_essay
      WHERE mapel_id = v_mapel_id AND kelas_id = v_kelas_id
      FOR UPDATE;

    SELECT ARRAY_AGG(id) INTO v_demoted_ids
    FROM paket_essay
    WHERE mapel_id = v_mapel_id AND kelas_id = v_kelas_id
      AND status = 'DISETUJUI' AND id <> p_paket_id;

    IF v_demoted_ids IS NOT NULL THEN
      UPDATE paket_essay
      SET status = 'DRAFT', notif_dibaca = false,
          catatan = 'Otomatis dikembalikan ke draft karena paket lain untuk mapel+kelas ini disetujui.'
      WHERE id = ANY(v_demoted_ids);

      UPDATE soal_essay SET status = 'DRAFT'
      WHERE paket_essay_id = ANY(v_demoted_ids) AND status = 'DISETUJUI';
    END IF;
  END IF;

  UPDATE paket_essay
  SET status = p_new_status, catatan = p_catatan, notif_dibaca = false
  WHERE id = p_paket_id;

  UPDATE soal_essay SET status = p_new_status WHERE paket_essay_id = p_paket_id;

  RETURN COALESCE(array_length(v_demoted_ids, 1), 0);
END;
$function$;

-- ── 4. Buat paket_soal secara atomik (anti paket ganda) ─────────────────────
-- Mengembalikan true kalau paket dibuat, false kalau guru ini SUDAH punya
-- paket (status apa pun) untuk mapel+kelas tersebut -- sama persis dengan
-- aturan pengecekan lama di route, hanya saja sekarang tidak bisa disela.
CREATE OR REPLACE FUNCTION public.buat_paket_soal_atomik(
  p_id text,
  p_mapel_id text,
  p_kelas_id text,
  p_guru_id text,
  p_acak text DEFAULT 'YA',
  p_mode_jawaban text DEFAULT 'DIGITAL'
)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Lock bertahan sampai transaksi pemanggilan selesai (otomatis dilepas).
  PERFORM pg_advisory_xact_lock(
    hashtextextended('paket_soal:' || p_guru_id || ':' || p_mapel_id || ':' || p_kelas_id, 0)
  );

  IF EXISTS (
    SELECT 1 FROM paket_soal
    WHERE guru_id = p_guru_id AND mapel_id = p_mapel_id AND kelas_id = p_kelas_id
  ) THEN
    RETURN false;
  END IF;

  INSERT INTO paket_soal (id, mapel_id, kelas_id, guru_id, status, jumlah_soal, acak, mode_jawaban)
  VALUES (p_id, p_mapel_id, p_kelas_id, p_guru_id, 'DRAFT', 0, p_acak, p_mode_jawaban);

  RETURN true;
END;
$function$;

-- ── Hak akses: hanya service_role (pola migrasi 19/21/23) ───────────────────
REVOKE ALL ON FUNCTION public.set_status_paket_soal(text, text, text)  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.set_status_paket_essay(text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.buat_paket_soal_atomik(text, text, text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_status_paket_soal(text, text, text)  TO service_role;
GRANT EXECUTE ON FUNCTION public.set_status_paket_essay(text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.buat_paket_soal_atomik(text, text, text, text, text, text) TO service_role;

-- ── POSTFLIGHT: pastikan hasilnya benar, kalau tidak batalkan semuanya ──────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public' AND indexname = 'uq_sesi_berjalan_per_jadwal'
  ) THEN
    RAISE EXCEPTION 'Postflight gagal: index uq_sesi_berjalan_per_jadwal tidak terbentuk';
  END IF;

  IF to_regprocedure('public.buat_paket_soal_atomik(text,text,text,text,text,text)') IS NULL THEN
    RAISE EXCEPTION 'Postflight gagal: fungsi buat_paket_soal_atomik tidak terbentuk';
  END IF;

  IF has_function_privilege('anon', 'public.buat_paket_soal_atomik(text,text,text,text,text,text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.buat_paket_soal_atomik(text,text,text,text,text,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Postflight gagal: buat_paket_soal_atomik masih bisa dieksekusi anon/authenticated';
  END IF;
END $$;

COMMIT;

-- =============================================================================
-- VERIFIKASI (jalankan manual setelah sukses):
--
--   select indexname, indexdef from pg_indexes
--   where tablename = 'sesi_ujian' and indexname = 'uq_sesi_berjalan_per_jadwal';
--
--   select proname, prosecdef from pg_proc
--   where proname in ('set_status_paket_soal','set_status_paket_essay','buat_paket_soal_atomik');
-- =============================================================================
