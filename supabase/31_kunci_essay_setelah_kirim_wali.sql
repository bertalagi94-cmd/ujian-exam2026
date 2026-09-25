-- =============================================================================
-- Migrasi 31: kunci nilai essay dari edit guru begitu sudah dikirim ke wali kelas
--
-- BUG DESAIN (menu Penilaian guru): setelah nilai dikirim ke wali kelas
-- (nilai.dikirim_ke_wali = TRUE), guru SEHARUSNYA tidak boleh lagi mengubah
-- nilai essay siswa lewat menu "Periksa Essay" — wali kelas sudah menerima
-- nilai final tersebut, jadi mengubahnya diam-diam di belakang akan membuat
-- nilai yang dipegang wali kelas berbeda dari yang sebenarnya ada di sistem.
--
-- SEBELUMNYA: PUT /api/guru/koreksi-essay -> simpan_koreksi_essay_atomik()
-- TIDAK PERNAH mengecek kolom dikirim_ke_wali sama sekali, jadi guru bisa
-- terus mengetik skor baru dan menekan Simpan kapan pun, bahkan jauh setelah
-- nilai itu terkirim ke wali kelas.
--
-- FIX: tambahkan pengecekan dikirim_ke_wali DI DALAM fungsi (bukan cuma di
-- route.ts) supaya aturan ini tidak bisa dilewati lewat jalur lain yang
-- mungkin memanggil fungsi ini di masa depan. Kalau baris nilai sudah
-- dikirim ke wali, fungsi berhenti dan mengembalikan hasil
-- 'SUDAH_DIKIRIM_WALI' tanpa mengubah apa pun (nilai, skor per soal, maupun
-- status_essay) — route.ts lalu menerjemahkan ini jadi pesan error yang jelas
-- untuk guru.
--
-- Aman dijalankan berulang (CREATE OR REPLACE).
-- =============================================================================

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
  v_skor_item        JSONB;
BEGIN
  -- 1) Kunci baris nilai (exclusive) -> serialisasi kalau guru menyimpan dua
  --    kali nyaris bersamaan (klik ganda), dan baca dirilis LAMA + status
  --    dikirim_ke_wali untuk menentukan apakah koreksi masih diizinkan.
  SELECT id, dirilis, dikirim_ke_wali INTO v_nilai_id, v_dirilis_lama, v_dikirim_ke_wali
  FROM nilai
  WHERE sesi_id = p_sesi_id AND nis = p_nis
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('hasil', 'NILAI_TIDAK_ADA');
  END IF;

  -- FIX (kunci nilai essay setelah kirim ke wali kelas): tolak koreksi tanpa
  -- mengubah apa pun kalau nilai ini sudah terkirim ke wali kelas.
  IF v_dikirim_ke_wali IS TRUE THEN
    RETURN jsonb_build_object('hasil', 'SUDAH_DIKIRIM_WALI', 'nilai_id', v_nilai_id);
  END IF;

  -- 2) Update nilai gabungan. `dirilis` SELALU ditarik ke false di sini —
  --    guru wajib menekan Rilis lagi sebelum nilai terbaru tampil ke siswa.
  UPDATE nilai
  SET nilai_essay = p_nilai_essay,
      nilai_total = p_nilai_total,
      lulus = p_lulus,
      dinilai_pada = NOW(),
      dinilai_oleh = p_dinilai_oleh,
      dirilis = FALSE,
      dirilis_pada = NULL
  WHERE id = v_nilai_id;

  -- 3) Simpan rincian skor per soal (jejak audit rubrik) — kosong/null kalau
  --    "tidak mengerjakan" (tidak ada skor untuk kasus itu, sesuai perilaku
  --    lama di route.ts).
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

-- Fungsi ini MENULIS nilai siswa: jangan bisa dipanggil lewat anon key publik.
-- Hanya service role (createAdminClient di API route) yang boleh menjalankan.
REVOKE ALL ON FUNCTION simpan_koreksi_essay_atomik(TEXT, TEXT, NUMERIC, NUMERIC, BOOLEAN, TEXT, TEXT, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION simpan_koreksi_essay_atomik(TEXT, TEXT, NUMERIC, NUMERIC, BOOLEAN, TEXT, TEXT, JSONB) TO service_role;
