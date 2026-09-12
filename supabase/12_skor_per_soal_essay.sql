-- =============================================================================
-- Migrasi: Skor per butir soal essay (mengembalikan penilaian berbasis rubrik)
--
-- LATAR BELAKANG: sebelumnya guru menilai essay dengan SATU angka 0-100
-- langsung untuk keseluruhan jawaban (lihat riwayat di 07_essay.sql & PUT
-- /api/guru/koreksi-essay), dan `soal_essay.bobot_maks` per soal hanya
-- ditampilkan sebagai "panduan", TIDAK dipakai menghitung nilai. Ini tidak
-- sesuai kaidah Standar Penilaian Pendidikan (instrumen uraian wajib
-- dilengkapi PEDOMAN PENSKORAN yang benar-benar dipakai menghitung skor,
-- bukan sekadar rubrik kosmetik) dan membuat nilai essay tidak bisa
-- ditelusuri/diaudit per butir soal kalau ada yang mempertanyakan.
--
-- PERBAIKAN: guru sekarang mengisi skor PER SOAL (0 s.d. bobot_maks soal
-- itu). Backend menjumlahkan semua skor lalu mengonversi ke skala 0-100
-- (nilai.nilai_essay tetap seperti sebelumnya, TIDAK ada perubahan skema di
-- situ) — supaya semua kode lain yang sudah membaca nilai.nilai_essay
-- (kirim-nilai, rekap, dsb) tidak perlu diubah sama sekali. Tabel baru ini
-- HANYA menyimpan rincian per soal sebagai jejak audit & agar form koreksi
-- bisa menampilkan kembali skor yang sudah diisi guru saat dibuka ulang.
-- =============================================================================

CREATE TABLE IF NOT EXISTS skor_essay_siswa (
  id BIGSERIAL PRIMARY KEY,
  sesi_id TEXT NOT NULL,
  nis TEXT NOT NULL,
  soal_essay_id TEXT NOT NULL,
  skor NUMERIC(5,2) NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(sesi_id, nis, soal_essay_id)
);

CREATE INDEX IF NOT EXISTS idx_skor_essay_siswa_sesi_nis ON skor_essay_siswa(sesi_id, nis);
