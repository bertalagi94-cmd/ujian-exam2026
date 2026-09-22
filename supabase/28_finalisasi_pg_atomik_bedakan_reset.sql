-- =============================================================================
-- Migrasi 28: finalisasi_pg_atomik membedakan RESET (sementara) vs TERKUNCI
--             (permanen) pada pengecekan ULANG status siswa di dalam transaksi
--
-- LATAR BELAKANG (bug ditemukan dari testing real ujian offline):
-- POST /api/siswa/ujian/selesai sudah punya DUA lapis pengecekan status siswa:
--   1) Cek AWAL (sebelum RPC) di selesai/route.ts — SUDAH diperbaiki
--      sebelumnya: RESET dibalas 403 dengan `sementara: true` (retry
--      otomatis oleh outbox), TERKUNCI dibalas 403 TANPA flag itu (permanen).
--   2) Cek ULANG di DALAM transaksi finalisasi_pg_atomik (migrasi 21) — sengaja
--      dibuat untuk menutup race antara langkah (1) dan commit nilai (mis.
--      pelanggaran/reset yang baru tersinkron TEPAT di antara keduanya).
--
-- Cek ULANG (lapis 2) ini SEBELUMNYA menyatukan RESET dan TERKUNCI jadi SATU
-- hasil 'SISWA_TERKUNCI':
--     IF v_siswa_status IN ('TERKUNCI', 'RESET') THEN
--       RETURN jsonb_build_object('hasil', 'SISWA_TERKUNCI');
--     END IF;
-- dan selesai/route.ts membalas 403 TANPA `sementara: true` untuk hasil ini,
-- apa pun status aslinya. Akibatnya: race yang PERSIS ingin dicegah cek ulang
-- ini (siswa berubah jadi RESET tepat sebelum commit) malah membuat paket
-- ujian ditandai GAGAL PERMANEN oleh cobaKirimPaketTertunda() di
-- ujian-outbox.ts, dan berhenti di-retry otomatis oleh mulaiPenjagaOutbox --
-- padahal begitu R1/pelanggaran akhirnya tersinkron dan status siswa kembali
-- AKTIF, seharusnya paket ini bisa tuntas sendiri. Inilah race window yang
-- PALING SERING kena, karena memang dirancang sempit (row lock) untuk
-- menangkap race -- lapis 1 yang sudah diperbaiki tidak menutup celah ini.
--
-- FIX: cek ulang di dalam transaksi sekarang membedakan hasilnya:
--   - 'SISWA_RESET'   -> RESET (sementara, bisa pulih sendiri)
--   - 'SISWA_TERKUNCI' -> TERKUNCI (permanen, butuh intervensi pengawas)
-- selesai/route.ts (lihat perubahan terkait) menangani 'SISWA_RESET' persis
-- seperti cek awal: 403 + `sementara: true`.
--
-- Aman dijalankan berulang (CREATE OR REPLACE). Tidak mengubah kontrak/nama
-- parameter fungsi, tidak menyentuh outbox/pelanggaran/reset sama sekali --
-- murni memperbaiki satu cabang hasil di transaksi yang sudah ada.
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

  -- FIX migrasi 28: dulu disatukan jadi 'SISWA_TERKUNCI' untuk kedua status.
  -- RESET bersifat SEMENTARA (bisa pulih sendiri begitu reset tersinkron) --
  -- dibedakan supaya pemanggil (selesai/route.ts) bisa memberi `sementara:
  -- true` dan outbox tetap retry otomatis, sama seperti cek awal di luar RPC.
  IF v_siswa_status = 'RESET' THEN
    RETURN jsonb_build_object('hasil', 'SISWA_RESET');
  END IF;

  IF v_siswa_status = 'TERKUNCI' THEN
    RETURN jsonb_build_object('hasil', 'SISWA_TERKUNCI');
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

-- Fungsi ini MENULIS nilai: jangan bisa dipanggil lewat anon key publik.
-- Hanya service role (createAdminClient di API route) yang boleh menjalankan.
REVOKE ALL ON FUNCTION finalisasi_pg_atomik(TEXT, TEXT, JSONB, BOOLEAN, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION finalisasi_pg_atomik(TEXT, TEXT, JSONB, BOOLEAN, JSONB) TO service_role;
