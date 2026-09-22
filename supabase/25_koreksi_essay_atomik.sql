-- =============================================================================
-- Migrasi 25: koreksi nilai essay yang ATOMIK (nilai + skor per soal +
-- status_essay dalam 1 transaksi)
--
-- LATAR BELAKANG (temuan audit lanjutan — Batch 2 item #9):
-- PUT /api/guru/koreksi-essay sebelumnya melakukan langkah-langkah ini
-- sebagai query TERPISAH lewat PostgREST:
--
--   1) UPDATE nilai (nilai_essay, nilai_total, lulus, dinilai_pada, dirilis=false)
--   2) UPSERT skor_essay_siswa (rincian skor per soal — jejak audit rubrik)
--   3) UPDATE siswa_ujian.status_essay (kalau ada, mis. 'TIDAK_MENGERJAKAN')
--
-- Akibatnya kalau langkah 1 berhasil tapi langkah 2 gagal (mis. gangguan DB
-- sesaat), guru menerima error TAPI nilai.nilai_essay/nilai_total di database
-- SUDAH terlanjur berubah, sementara rincian skor per soal (skor_essay_siswa)
-- tidak tersimpan — jejak audit rubrik jadi tidak lengkap/tidak konsisten
-- dengan nilai gabungan yang tersimpan. Langkah 3 (status_essay) juga bisa
-- terlewat kalau langkah 1/2 gagal duluan.
--
-- SOLUSI: satu fungsi Postgres yang menjalankan ketiganya dalam satu
-- transaksi — commit bersama atau batal bersama. Pola & gaya sama persis
-- dengan finalisasi_pg_atomik() (lihat 21_finalisasi_pg_atomik.sql).
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
  v_nilai_id       TEXT;
  v_dirilis_lama   BOOLEAN;
  v_skor_item      JSONB;
BEGIN
  -- 1) Kunci baris nilai (exclusive) -> serialisasi kalau guru menyimpan dua
  --    kali nyaris bersamaan (klik ganda), dan baca dirilis LAMA untuk
  --    dikembalikan ke caller (dipakai untuk pesan "perlu rilis ulang").
  SELECT id, dirilis INTO v_nilai_id, v_dirilis_lama
  FROM nilai
  WHERE sesi_id = p_sesi_id AND nis = p_nis
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('hasil', 'NILAI_TIDAK_ADA');
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
