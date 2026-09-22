-- =============================================================================
-- Migrasi 27: hapus siswa & hapus kelas yang ATOMIK dan LENGKAP
--
-- LATAR BELAKANG (temuan audit lanjutan — Batch 3, sisa 2 item + 1 gap):
-- DELETE /api/admin/siswa/[nis] dan DELETE /api/admin/kelas sebelumnya:
--   1) TIDAK PERNAH menghapus data essay — jawaban_essay, jawaban_essay_foto,
--      skor_essay_siswa, essay_amplop_offline — maupun log_reset. Semuanya
--      jadi data yatim yang tertinggal permanen setelah siswa/kelasnya
--      "dihapus" (beda dari admin/reset/route.ts yang sudah menangani semua
--      tabel ini, lihat komentar JAWABAN_ESSAY di sana).
--   2) Melakukan beberapa DELETE terpisah lewat PostgREST TANPA transaksi:
--      kalau salah satu gagal di tengah jalan (mis. gangguan DB sesaat),
--      sebagian tabel sudah terhapus dan sebagian belum — state campuran
--      tanpa jejak, response tetap terlihat sukses/gagal tanpa kejelasan
--      apa yang benar-benar sudah hilang.
--   3) File fisik foto jawaban essay (mode KERTAS lama) di Supabase Storage
--      tidak pernah dibersihkan sama sekali untuk delete siswa/kelas
--      individual — beda dari reset admin yang sudah menanganinya.
--
-- SOLUSI (pola sama seperti simpan_koreksi_essay_atomik/kunci_permanen_atomik
-- di migrasi 25 & 26): satu fungsi Postgres per operasi, semua DELETE di
-- dalamnya jadi SATU transaksi — commit bersama atau batal bersama. File
-- fisik foto essay di Storage TETAP harus dibersihkan terpisah dari sisi
-- TypeScript SEBELUM memanggil RPC ini (fungsi Postgres tidak bisa memanggil
-- Storage API) — lihat hapusFotoEssayFisik()/resolveFotoEssayStorageTarget()
-- di src/lib/backup-restore-shared.ts, dipanggil dari kedua route.ts SEBELUM
-- RPC di sini, dengan pola fail-closed: kalau penghapusan Storage gagal,
-- RPC (dan karenanya penghapusan DB) tidak dipanggil sama sekali.
--
-- CATATAN kelas: identitas kelas yang dihapus sekarang bisa dikirim sebagai
-- `p_kelas_id` (id stabil dari tabel `kelas`, direkomendasikan) atau hanya
-- `p_nama` (kompatibilitas mundur, untuk kelas yang belum punya baris di
-- tabel `kelas` sama sekali — lihat resolusi sisi TypeScript di
-- api/admin/kelas/route.ts). Keanggotaan siswa tetap dicocokkan lewat
-- `siswa.kelas` (kolom TEKS nama) karena skema saat ini belum punya kolom
-- `siswa.kelas_id` — batasan ini didokumentasikan, bukan diperbaiki di sini
-- (butuh migrasi skema lebih besar di luar cakupan perbaikan ini).
--
-- Aman dijalankan berulang (CREATE OR REPLACE).
-- =============================================================================

CREATE OR REPLACE FUNCTION hapus_siswa_atomik(p_nis TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_ada BOOLEAN;
BEGIN
  -- Kunci baris siswa lebih dulu supaya tidak ada request lain yang
  -- membaca/mengubah siswa ini di tengah proses hapus.
  SELECT TRUE INTO v_ada FROM siswa WHERE nis = p_nis FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('hasil', 'SISWA_TIDAK_ADA');
  END IF;

  DELETE FROM pelanggaran          WHERE nis = p_nis;
  DELETE FROM log_reset            WHERE nis = p_nis;
  DELETE FROM nilai                WHERE nis = p_nis;
  DELETE FROM jawaban              WHERE nis = p_nis;
  DELETE FROM jawaban_essay        WHERE nis = p_nis;
  DELETE FROM jawaban_essay_foto   WHERE nis = p_nis;
  DELETE FROM skor_essay_siswa     WHERE nis = p_nis;
  DELETE FROM essay_amplop_offline WHERE nis = p_nis;
  DELETE FROM siswa_ujian          WHERE nis = p_nis;
  DELETE FROM siswa                WHERE nis = p_nis;

  RETURN jsonb_build_object('hasil', 'OK');
END;
$$;

REVOKE ALL ON FUNCTION hapus_siswa_atomik(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION hapus_siswa_atomik(TEXT) TO service_role;


CREATE OR REPLACE FUNCTION hapus_kelas_atomik(p_nama TEXT, p_kelas_id TEXT DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_jumlah_siswa INTEGER;
BEGIN
  -- Kunci semua baris siswa di kelas ini lebih dulu.
  PERFORM 1 FROM siswa WHERE kelas = p_nama FOR UPDATE;

  SELECT COUNT(*) INTO v_jumlah_siswa FROM siswa WHERE kelas = p_nama;

  DELETE FROM pelanggaran          WHERE nis IN (SELECT nis FROM siswa WHERE kelas = p_nama);
  DELETE FROM log_reset            WHERE nis IN (SELECT nis FROM siswa WHERE kelas = p_nama);
  DELETE FROM nilai                WHERE nis IN (SELECT nis FROM siswa WHERE kelas = p_nama);
  DELETE FROM jawaban              WHERE nis IN (SELECT nis FROM siswa WHERE kelas = p_nama);
  DELETE FROM jawaban_essay        WHERE nis IN (SELECT nis FROM siswa WHERE kelas = p_nama);
  DELETE FROM jawaban_essay_foto   WHERE nis IN (SELECT nis FROM siswa WHERE kelas = p_nama);
  DELETE FROM skor_essay_siswa     WHERE nis IN (SELECT nis FROM siswa WHERE kelas = p_nama);
  DELETE FROM essay_amplop_offline WHERE nis IN (SELECT nis FROM siswa WHERE kelas = p_nama);
  DELETE FROM siswa_ujian          WHERE nis IN (SELECT nis FROM siswa WHERE kelas = p_nama);
  DELETE FROM siswa                WHERE kelas = p_nama;

  -- Baris info kelas (wali_kelas/jurusan) dihapus TERAKHIR, setelah semua
  -- siswanya sudah bersih. Kalau kelas_id dikirim (sumber kebenaran lebih
  -- kuat karena stabil terhadap rename), pakai itu; kalau tidak, jatuh ke
  -- nama seperti perilaku lama.
  IF p_kelas_id IS NOT NULL THEN
    DELETE FROM kelas WHERE id = p_kelas_id;
  ELSE
    DELETE FROM kelas WHERE nama = p_nama;
  END IF;

  RETURN jsonb_build_object('hasil', 'OK', 'jumlah_siswa', v_jumlah_siswa);
END;
$$;

REVOKE ALL ON FUNCTION hapus_kelas_atomik(TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION hapus_kelas_atomik(TEXT, TEXT) TO service_role;
