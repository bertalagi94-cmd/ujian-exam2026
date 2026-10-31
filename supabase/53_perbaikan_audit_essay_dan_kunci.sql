-- =============================================================================
-- Migrasi 53: perbaikan hasil audit alur essay, kode darurat, dan kunci permanen
--
-- Isi (semua aman dijalankan berulang):
--
--  1) kunci_permanen_atomik: kalau baris nilai TIDAK berubah (karena sudah
--     dikirim ke wali kelas), fungsi sekarang mengembalikan 'OK_NILAI_TETAP',
--     bukan 'OK'. Sebelumnya route admin menampilkan "nilai diset 0" padahal
--     nilainya tidak disentuh (migrasi 45 melewati baris dikirim_ke_wali).
--
--  2) simpan_koreksi_essay_atomik: tolak siswa berstatus TERKUNCI DI DALAM
--     fungsi ('SISWA_TERKUNCI'). Sebelumnya penolakan hanya ada di route, jadi
--     kalau admin mengunci siswa tepat setelah cek route tapi sebelum RPC
--     jalan, nilai "gugur total" (0) bisa tertimpa skor essay.
--     Urutan lock sengaja siswa_ujian -> nilai, sama dengan kunci_permanen_atomik
--     (siswa_ujian lalu nilai), supaya tidak ada deadlock.
--
--  3) finalisasi_essay_atomik & finalisasi_pg_atomik: cek device memakai
--     IS DISTINCT FROM, bukan <>. Dengan <>, p_device_id NULL membuat hasil
--     perbandingan NULL sehingga pengecekan device dilewati diam-diam. Route
--     saat ini sudah menolak request tanpa deviceId, jadi ini pertahanan
--     berlapis. Penggantian dilakukan dengan membaca definisi fungsi yang
--     TERPASANG di database (pg_get_functiondef), jadi tidak mengubah bagian
--     lain dari fungsi walau definisinya pernah diubah di luar repo.
--
--  4) essay_amplop_kembalikan_percobaan: mengurangi hitungan percobaan kode
--     darurat sebanyak 1 (tidak di bawah 0). Dipakai /essay/mulai supaya
--     HANYA tebakan salah yang tersisa di hitungan; kode benar dan percobaan
--     ulang setelah error server tidak lagi menghabiskan jatah.
-- =============================================================================


-- ── 1) kunci_permanen_atomik ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION kunci_permanen_atomik(
  p_sesi_id      TEXT,
  p_nis          TEXT,
  p_nilai_id_baru TEXT,   -- id siap pakai (generateId('NIL')) kalau nilai perlu dibuat; diabaikan kalau nilai sudah ada
  p_reset_oleh   TEXT,
  p_catatan      TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_siswa_ujian_ada BOOLEAN;
  v_nilai_id        TEXT;
  v_mapel_id        TEXT;
  v_kelas           TEXT;
  v_kkm             INTEGER;
  v_baris_nilai     INTEGER;
  v_hasil           TEXT := 'OK';
BEGIN
  -- 1) Kunci baris siswa_ujian (exclusive) & set TERKUNCI.
  SELECT TRUE INTO v_siswa_ujian_ada
  FROM siswa_ujian
  WHERE sesi_id = p_sesi_id AND nis = p_nis
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('hasil', 'SISWA_UJIAN_TIDAK_ADA');
  END IF;

  UPDATE siswa_ujian
  SET status = 'TERKUNCI'
  WHERE sesi_id = p_sesi_id AND nis = p_nis;

  -- 2) Kalau nilai belum ada, buat baris nilai 0. Status TETAP 'TERKUNCI'.
  SELECT id INTO v_nilai_id
  FROM nilai
  WHERE sesi_id = p_sesi_id AND nis = p_nis
  FOR UPDATE;

  IF v_nilai_id IS NULL THEN
    SELECT mapel_id, kelas INTO v_mapel_id, v_kelas
    FROM sesi_ujian WHERE id = p_sesi_id;

    IF v_mapel_id IS NULL THEN
      RETURN jsonb_build_object('hasil', 'SESI_TIDAK_ADA');
    END IF;

    SELECT kkm INTO v_kkm FROM mapel WHERE id = v_mapel_id;

    INSERT INTO nilai (id, sesi_id, nis, mapel_id, kelas, benar, total, nilai, grade, lulus, kkm, "timestamp")
    VALUES (p_nilai_id_baru, p_sesi_id, p_nis, v_mapel_id, v_kelas, 0, 0, 0, 'E', FALSE, COALESCE(v_kkm, 75), NOW())
    ON CONFLICT (sesi_id, nis) DO NOTHING;

    UPDATE siswa_ujian
    SET waktu_selesai = NOW()
    WHERE sesi_id = p_sesi_id AND nis = p_nis;
  ELSE
    UPDATE nilai
    SET nilai = 0, grade = 'E', lulus = FALSE,
        nilai_essay = 0, nilai_total = 0,
        catatan_guru = 'Dikunci permanen oleh ADMIN. Nilai akhir ditetapkan 0 sesuai aturan (terkunci = gugur).'
    WHERE id = v_nilai_id AND COALESCE(dikirim_ke_wali, FALSE) = FALSE;

    GET DIAGNOSTICS v_baris_nilai = ROW_COUNT;
    IF v_baris_nilai = 0 THEN
      -- Nilai sudah dikirim ke wali kelas -> sengaja tidak diubah. Status
      -- siswa tetap TERKUNCI, tetapi pemanggil harus tahu nilainya TIDAK 0.
      v_hasil := 'OK_NILAI_TETAP';
    END IF;
  END IF;

  -- 3) Tandai semua pelanggaran siswa ini di sesi ini sudah ditindaklanjuti.
  UPDATE pelanggaran
  SET status = 'SUDAH_DITINDAKLANJUTI'
  WHERE sesi_id = p_sesi_id AND nis = p_nis;

  -- 4) Jejak audit.
  INSERT INTO log_reset (nis, reset_oleh, alasan, password_baru, digunakan)
  VALUES (
    p_nis,
    p_reset_oleh,
    'sesi:' || p_sesi_id || ' — Dikunci permanen oleh ADMIN'
      || CASE WHEN v_hasil = 'OK_NILAI_TETAP' THEN ' (nilai TIDAK diubah: sudah dikirim ke wali kelas)' ELSE '' END
      || COALESCE(': ' || p_catatan, ''),
    '-',
    TRUE
  );

  RETURN jsonb_build_object('hasil', v_hasil);
END;
$$;

REVOKE ALL ON FUNCTION kunci_permanen_atomik(TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION kunci_permanen_atomik(TEXT, TEXT, TEXT, TEXT, TEXT) TO service_role;


-- ── 2) simpan_koreksi_essay_atomik ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION simpan_koreksi_essay_atomik(
  p_sesi_id             TEXT,
  p_nis                 TEXT,
  p_nilai_essay         NUMERIC,
  p_nilai_total         NUMERIC,
  p_lulus               BOOLEAN,
  p_dinilai_oleh        TEXT,
  p_status_essay_update TEXT DEFAULT NULL,
  p_skor_per_soal       JSONB DEFAULT NULL  -- array of {"soal_essay_id": ..., "skor": ...}
)
RETURNS JSONB
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_nilai_id         TEXT;
  v_dirilis_lama     BOOLEAN;
  v_dikirim_ke_wali  BOOLEAN;
  v_status_siswa     TEXT;
  v_skor_item        JSONB;
BEGIN
  -- 0) Cek status siswa DI DALAM transaksi. FOR SHARE pada siswa_ujian: kalau
  --    admin sedang mengunci siswa ini (kunci_permanen_atomik memegang
  --    FOR UPDATE), koreksi menunggu sampai commit lalu melihat TERKUNCI;
  --    kalau koreksi lebih dulu, penguncian menunggu koreksi selesai dan
  --    sesudahnya menolkan nilai lagi. Urutan lock: siswa_ujian -> nilai.
  SELECT status INTO v_status_siswa
  FROM siswa_ujian
  WHERE sesi_id = p_sesi_id AND nis = p_nis
  FOR SHARE;

  IF FOUND AND v_status_siswa = 'TERKUNCI' THEN
    RETURN jsonb_build_object('hasil', 'SISWA_TERKUNCI');
  END IF;

  -- 1) Kunci baris nilai (exclusive).
  SELECT id, dirilis, dikirim_ke_wali INTO v_nilai_id, v_dirilis_lama, v_dikirim_ke_wali
  FROM nilai
  WHERE sesi_id = p_sesi_id AND nis = p_nis
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('hasil', 'NILAI_TIDAK_ADA');
  END IF;

  IF v_dikirim_ke_wali IS TRUE THEN
    RETURN jsonb_build_object('hasil', 'SUDAH_DIKIRIM_WALI', 'nilai_id', v_nilai_id);
  END IF;

  -- 2) Update nilai gabungan. `dirilis` SELALU ditarik ke false.
  UPDATE nilai
  SET nilai_essay = p_nilai_essay,
      nilai_total = p_nilai_total,
      lulus = p_lulus,
      dinilai_pada = NOW(),
      dinilai_oleh = p_dinilai_oleh,
      dirilis = FALSE,
      dirilis_pada = NULL
  WHERE id = v_nilai_id;

  -- 3) Rincian skor per soal (jejak audit rubrik).
  IF p_skor_per_soal IS NOT NULL AND jsonb_array_length(p_skor_per_soal) > 0 THEN
    FOR v_skor_item IN SELECT * FROM jsonb_array_elements(p_skor_per_soal)
    LOOP
      INSERT INTO skor_essay_siswa (sesi_id, nis, soal_essay_id, skor, updated_at)
      VALUES (
        p_sesi_id,
        p_nis,
        v_skor_item->>'soal_essay_id',
        (v_skor_item->>'skor')::numeric,
        NOW()
      )
      ON CONFLICT (sesi_id, nis, soal_essay_id)
      DO UPDATE SET skor = EXCLUDED.skor, updated_at = EXCLUDED.updated_at;
    END LOOP;
  END IF;

  -- 4) Update status_essay siswa kalau diminta (mis. 'TIDAK_MENGERJAKAN').
  IF p_status_essay_update IS NOT NULL THEN
    UPDATE siswa_ujian
    SET status_essay = p_status_essay_update
    WHERE sesi_id = p_sesi_id AND nis = p_nis;
  END IF;

  RETURN jsonb_build_object(
    'hasil', 'OK',
    'nilai_id', v_nilai_id,
    'sudah_pernah_dirilis', COALESCE(v_dirilis_lama, FALSE)
  );
END;
$$;

REVOKE ALL ON FUNCTION simpan_koreksi_essay_atomik(TEXT, TEXT, NUMERIC, NUMERIC, BOOLEAN, TEXT, TEXT, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION simpan_koreksi_essay_atomik(TEXT, TEXT, NUMERIC, NUMERIC, BOOLEAN, TEXT, TEXT, JSONB) TO service_role;


-- ── 3) IS DISTINCT FROM pada cek device di dua fungsi finalisasi ────────────
-- Mengambil definisi yang sedang terpasang, mengganti "<> p_device_id" dengan
-- "IS DISTINCT FROM p_device_id", lalu memasang ulang. Hak akses (ACL) tidak
-- berubah karena memakai CREATE OR REPLACE. Kalau teks yang dicari tidak ada
-- (sudah diganti, atau fungsi belum terpasang), dilewati dengan NOTICE.
DO $$
DECLARE
  r       RECORD;
  v_def   TEXT;
  v_baru  TEXT;
BEGIN
  FOR r IN
    SELECT p.oid, p.proname
    FROM pg_proc p
    WHERE p.pronamespace = 'public'::regnamespace
      AND p.proname IN ('finalisasi_essay_atomik', 'finalisasi_pg_atomik')
  LOOP
    v_def  := pg_get_functiondef(r.oid);
    v_baru := replace(v_def, '<> p_device_id', 'IS DISTINCT FROM p_device_id');
    IF v_baru = v_def THEN
      RAISE NOTICE 'Migrasi 53: % sudah tidak memakai "<> p_device_id" (dilewati).', r.proname;
    ELSE
      EXECUTE v_baru;
      RAISE NOTICE 'Migrasi 53: % diperbarui memakai IS DISTINCT FROM.', r.proname;
    END IF;
  END LOOP;
END;
$$;


-- ── 4) Pengembalian hitungan percobaan kode darurat ─────────────────────────
CREATE OR REPLACE FUNCTION essay_amplop_kembalikan_percobaan(p_sesi_id TEXT, p_nis TEXT)
RETURNS INTEGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_hasil INTEGER;
BEGIN
  UPDATE essay_amplop_offline
     SET percobaan_server = GREATEST(percobaan_server - 1, 0)
   WHERE sesi_id = p_sesi_id AND nis = p_nis
  RETURNING percobaan_server INTO v_hasil;
  RETURN v_hasil;
END;
$$;

REVOKE ALL ON FUNCTION essay_amplop_kembalikan_percobaan(TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION essay_amplop_kembalikan_percobaan(TEXT, TEXT) TO service_role;
