-- =============================================================================
-- Migrasi 21: finalisasi PG yang ATOMIK (nilai + status siswa dalam 1 transaksi)
--
-- LATAR BELAKANG (temuan audit):
-- POST /api/siswa/ujian/selesai sebelumnya melakukan langkah-langkah ini
-- sebagai query TERPISAH lewat PostgREST:
--
--   1) SELECT sesi_ujian.status         -> cek 'BERJALAN'
--   2) UPSERT nilai
--   3) UPDATE siswa_ujian (SELESAI / status_essay = BELUM_MULAI)
--
-- Akibatnya:
--   a) Pengawas bisa menutup sesi TEPAT di antara langkah 1 dan 2. Siswa tetap
--      menulis nilai walau sesi sudah SELESAI (bersaing dengan
--      finalisasiNilaiPaksa).
--   b) Langkah 2 berhasil tapi langkah 3 gagal (atau sebaliknya) -> nilai ada
--      tapi status siswa_ujian tetap AKTIF. Percobaan ulang siswa kemudian
--      masuk ke early-return "nilai sudah ada" yang TIDAK pernah memperbaiki
--      status, sehingga siswa menggantung selamanya.
--
-- SOLUSI: satu fungsi Postgres yang menjalankan semuanya dalam satu transaksi:
--   - SELECT ... FOR SHARE pada baris sesi_ujian.
--       * Banyak siswa bisa submit bersamaan (FOR SHARE tidak saling blok).
--       * UPDATE status sesi oleh pengawas (tutup / tutup-paksa) butuh lock
--         eksklusif, jadi MENUNGGU sampai submit yang sedang berjalan selesai
--         commit; submit yang datang SETELAH penutupan melihat status
--         'SELESAI' dan ditolak. Tidak ada lagi celah di antara cek & tulis.
--   - SELECT ... FOR UPDATE pada baris siswa_ujian -> dua request bersamaan
--     dari siswa yang sama (double klik / retry jaringan) diserialkan.
--   - Cek ulang status siswa (TERKUNCI/RESET) DI DALAM transaksi.
--   - INSERT nilai ON CONFLICT DO NOTHING + UPDATE siswa_ujian: semuanya
--     commit bersama atau batal bersama.
--
-- PERHITUNGAN nilai tetap dilakukan di aplikasi (penilaian-ujian.ts) dan
-- dikirim sebagai p_nilai; fungsi ini hanya menjamin PENULISANNYA atomik.
--
-- PRASYARAT: migrasi 20 (kolom pg_selesai_offline, pg_waktu_selesai_klaim,
-- pg_offline_audit di siswa_ujian) sudah dijalankan.
--
-- Aman dijalankan berulang (CREATE OR REPLACE). Kompatibel mundur: kalau
-- migrasi ini BELUM dijalankan tapi kode sudah di-deploy, selesai/route.ts
-- otomatis jatuh ke jalur lama (lihat komentar FALLBACK di sana).
-- =============================================================================

CREATE OR REPLACE FUNCTION finalisasi_pg_atomik(
  p_sesi_id      TEXT,
  p_nis          TEXT,
  p_nilai        JSONB,
  p_essay_aktif  BOOLEAN,
  p_klaim_offline JSONB DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_sesi_status   TEXT;
  v_siswa_status  TEXT;
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
  SELECT status INTO v_siswa_status
  FROM siswa_ujian
  WHERE sesi_id = p_sesi_id AND nis = p_nis
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('hasil', 'SISWA_TIDAK_TERDAFTAR');
  END IF;

  IF v_siswa_status IN ('TERKUNCI', 'RESET') THEN
    RETURN jsonb_build_object('hasil', 'SISWA_TERKUNCI');
  END IF;

  -- 3) Simpan nilai. Kalau sudah ada (request lain menang duluan), biarkan.
  INSERT INTO nilai (id, sesi_id, nis, mapel_id, kelas, benar, total, nilai, grade, lulus, kkm, "timestamp")
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
    COALESCE((p_nilai->>'timestamp')::timestamptz, NOW())
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

-- Fungsi ini MENULIS nilai: jangan bisa dipanggil lewat anon key publik.
-- Hanya service role (createAdminClient di API route) yang boleh menjalankan.
REVOKE ALL ON FUNCTION finalisasi_pg_atomik(TEXT, TEXT, JSONB, BOOLEAN, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION finalisasi_pg_atomik(TEXT, TEXT, JSONB, BOOLEAN, JSONB) TO service_role;
