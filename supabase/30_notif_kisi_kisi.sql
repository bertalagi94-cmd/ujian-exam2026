-- =============================================================================
-- Migrasi 30: Badge notifikasi "Kisi-kisi baru" untuk Guru & Siswa
--
-- LATAR BELAKANG:
-- Sudah ada pola badge notifikasi di sidebar (lihat /api/notif dan
-- src/components/shared/Sidebar.tsx) untuk "Validasi Soal" (Admin) dan
-- "Buat Soal" (Guru, paket_soal.notif_dibaca) — tapi paket_soal cocok
-- dengan pola "boolean per baris" karena satu baris paket_soal memang
-- milik SATU guru saja.
--
-- kisi_kisi TIDAK begitu: satu baris kisi_kisi dilihat oleh BANYAK orang
-- sekaligus (semua guru satu sekolah, dan semua siswa satu kelas), jadi
-- "sudah dibaca / belum" tidak bisa disimpan sebagai satu kolom boolean di
-- tabel kisi_kisi itu sendiri — tiap pembaca butuh status baca masing-masing.
--
-- Solusi paling ringan (dibanding tabel baru per-baris-per-pembaca yang
-- terus tumbuh): simpan SATU timestamp "kisi-kisi terakhir dilihat" per
-- akun (guru/siswa). Badge = hitung baris kisi_kisi yang relevan untuk akun
-- itu dengan updated_at > timestamp tsb. Timestamp diperbarui (di-set ke
-- NOW()) setiap kali akun itu membuka menu Kisi-kisi.
-- =============================================================================

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS kisi_kisi_terakhir_dilihat TIMESTAMPTZ;

ALTER TABLE siswa
  ADD COLUMN IF NOT EXISTS kisi_kisi_terakhir_dilihat TIMESTAMPTZ;
