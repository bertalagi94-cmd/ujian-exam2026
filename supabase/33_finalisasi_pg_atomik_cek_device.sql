-- =============================================================================
-- Migrasi 33: finalisasi_pg_atomik mengecek device_id DI DALAM transaksi
--
-- LATAR BELAKANG (audit, race condition device takeover):
-- POST /api/siswa/ujian/selesai sudah mengecek device_id SEBELUM memanggil
-- finalisasi_pg_atomik() (lihat selesai/route.ts). Tapi pengecekan itu
-- adalah query TERPISAH, di LUAR transaksi atomik migrasi 21/28. Ada celah:
--
--   Device A: cek device_id = A  -> lolos
--   Device B: ambil alih (device_id di DB berubah jadi B)
--   Device A: lanjut memanggil finalisasi_pg_atomik() -- TIDAK tahu device_id
--             sudah berubah, karena RPC ini tidak menerima/mengecek device_id
--             sama sekali -> PG tetap difinalisasi oleh device yang sudah
--             tidak sah lagi.
--
-- Sama seperti migrasi 28 menutup celah RESET/TERKUNCI dengan cek ULANG di
-- dalam transaksi (setelah FOR UPDATE mengunci baris siswa_ujian), migrasi
-- ini menambahkan cek ULANG device_id di titik yang sama.
--
-- FIX: tambah parameter p_device_id. Setelah baris siswa_ujian dikunci
-- (FOR UPDATE), device_id di DB dibandingkan dengan p_device_id:
--   - Kalau device_id di DB kosong (belum pernah ada device terdaftar,
--     kasus lama), tidak diblokir -- sama seperti pola guard device_id di
--     /sync dan endpoint lain (hanya menolak kalau ADA device_id terdaftar
--     dan berbeda).
--   - Kalau device_id di DB terisi dan BEDA dengan p_device_id -> transaksi
--     ditolak dengan hasil 'DEVICE_LAIN', SEBELUM nilai ditulis.
--
-- Aman dijalankan berulang (CREATE OR REPLACE). Menambah 1 parameter baru
-- dengan urutan di akhir (p_device_id opsional lewat DEFAULT NULL) supaya
-- kompatibel selama masa transisi deploy; setelah selesai/route.ts diperbarui
-- untuk selalu mengirim p_device_id, backend WAJIB mengirimnya (frontend
-- sudah selalu mengirim deviceId ke endpoint /selesai).
-- =============================================================================

CREATE OR REPLACE FUNCTION finalisasi_pg_atomik(
  p_sesi_id      TEXT,
  p_nis          TEXT,
  p_nilai        JSONB,
  p_essay_aktif  BOOLEAN,
  p_klaim_offline JSONB DEFAULT NULL,
  p_device_id    TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_sesi_status   TEXT;
  v_siswa_status  TEXT;
  v_siswa_device  TEXT;
  v_nilai_id      TEXT;
BEGIN
  -- 1) Kunci baris sesi (shared) + cek status di DALAM transaksi.
  SELECT status INTO v_sesi_status
  FROM sesi_ujian
  WHERE id = p_sesi_id
  FOR SHARE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('hasil', 'SESI_TIDAK_ADA');
  END IF;

  IF v_sesi_status <> 'BERJALAN' THEN
    RETURN jsonb_build_object('hasil', 'SESI_DITUTUP');
  END IF;

  -- 2) Kunci baris siswa (exclusive) -> serialisasi request ganda siswa ini.
  SELECT status, device_id INTO v_siswa_status, v_siswa_device
  FROM siswa_ujian
  WHERE sesi_id = p_sesi_id AND nis = p_nis
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('hasil', 'SISWA_TIDAK_TERDAFTAR');
  END IF;

  IF v_siswa_status = 'RESET' THEN
    RETURN jsonb_build_object('hasil', 'SISWA_RESET');
  END IF;

  IF v_siswa_status = 'TERKUNCI' THEN
    RETURN jsonb_build_object('hasil', 'SISWA_TERKUNCI');
  END IF;

  -- FIX migrasi 33: cek ULANG device_id di sini, SETELAH baris dikunci FOR
  -- UPDATE -- ini titik yang sama tempat migrasi 28 menutup race RESET/
  -- TERKUNCI. Kalau device lain sempat mengambil alih tepat sebelum baris
  -- ini dikunci, request device lama ditolak di sini, bukan lolos menulis
  -- nilai.
  IF v_siswa_device IS NOT NULL AND v_siswa_device <> p_device_id THEN
    RETURN jsonb_build_object('hasil', 'DEVICE_LAIN');
  END IF;

  -- 3) Simpan nilai. Kalau sudah ada (request lain menang duluan), biarkan.
  INSERT INTO nilai (id, sesi_id, nis, mapel_id, kelas, benar, total, nilai, grade, lulus, kkm, "timestamp", catatan_guru)
  VALUES (
    p_nilai->>'id',
    p_sesi_id,
    p_nis,
    p_nilai->>'mapel_id',
    p_nilai->>'kelas',
    COALESCE((p_nilai->>'benar')::int, 0),
    COALESCE((p_nilai->>'total')::int, 0),
    COALESCE((p_nilai->>'nilai')::numeric, 0),
    p_nilai->>'grade',
    COALESCE((p_nilai->>'lulus')::boolean, FALSE),
    COALESCE((p_nilai->>'kkm')::int, 75),
    COALESCE((p_nilai->>'timestamp')::timestamptz, NOW()),
    -- Hanya terisi untuk submit yang datang setelah batas waktu (lihat selesai/route.ts).
    p_nilai->>'catatan_guru'
  )
  ON CONFLICT (sesi_id, nis) DO NOTHING;

  -- 4) Update status siswa.
  IF p_essay_aktif THEN
    -- Sesi punya essay: JANGAN tandai SELESAI. status_essay hanya dimajukan
    -- kalau MASIH di keadaan awal (jangan mundurkan MENGERJAKAN/SUDAH_KIRIM
    -- kalau essay/mulai sempat berjalan duluan lewat jalur darurat offline).
    UPDATE siswa_ujian
    SET status_essay = 'BELUM_MULAI'
    WHERE sesi_id = p_sesi_id
      AND nis = p_nis
      AND (status_essay IS NULL OR status_essay = 'BELUM_MULAI');
  ELSE
    UPDATE siswa_ujian
    SET status = 'SELESAI',
        waktu_selesai = NOW()
    WHERE sesi_id = p_sesi_id AND nis = p_nis;
  END IF;

  -- 5) Jejak audit klaim "PG selesai offline" (tidak memengaruhi nilai/status).
  --    Ditulis TERPISAH dari langkah 4 supaya audit tetap tercatat walau
  --    status_essay sudah maju (di kode lama audit ikut terlewat).
  IF p_klaim_offline IS NOT NULL THEN
    UPDATE siswa_ujian
    SET pg_selesai_offline     = TRUE,
        pg_waktu_selesai_klaim = (p_klaim_offline->>'waktu_klaim')::timestamptz,
        pg_offline_audit       = p_klaim_offline->'audit'
    WHERE sesi_id = p_sesi_id AND nis = p_nis;
  END IF;

  -- 6) Kembalikan id nilai yang SEBENARNYA tersimpan (bisa milik request lain).
  SELECT id INTO v_nilai_id
  FROM nilai
  WHERE sesi_id = p_sesi_id AND nis = p_nis;

  RETURN jsonb_build_object('hasil', 'OK', 'nilai_id', v_nilai_id);
END;
$$;

-- Signature fungsi berubah (parameter baru p_device_id) -- Postgres/PostgREST
-- akan mendaftarkan overload baru di samping yang lama sampai yang lama
-- di-drop. Drop dulu signature lama supaya tidak ambigu untuk PostgREST.
DROP FUNCTION IF EXISTS finalisasi_pg_atomik(TEXT, TEXT, JSONB, BOOLEAN, JSONB);

-- Fungsi ini MENULIS nilai: jangan bisa dipanggil lewat anon key publik.
-- Hanya service role (createAdminClient di API route) yang boleh menjalankan.
REVOKE ALL ON FUNCTION finalisasi_pg_atomik(TEXT, TEXT, JSONB, BOOLEAN, JSONB, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION finalisasi_pg_atomik(TEXT, TEXT, JSONB, BOOLEAN, JSONB, TEXT) TO service_role;
