-- Migrasi 59: menghapus fitur "Akun Tester"
--
-- Tab/kotak centang Akun Tester dan celah login saat maintenance sudah dihapus
-- dari aplikasi. Akun yang dulu bertanda tester (is_tester = 'YES') sebelumnya
-- disembunyikan dari daftar admin; migrasi ini menjadikan semuanya akun biasa
-- supaya tidak ada akun "tak terlihat". Kolom is_tester sengaja TIDAK dihapus
-- (dipakai backup/restore dan beberapa query statistik lama).
--
-- Aman dijalankan berulang. Jalankan SEBELUM atau SESUDAH deploy; urutan bebas.
--
-- (Opsional) lihat dulu berapa akun yang terdampak:
--   select count(*) from users where is_tester is distinct from 'NO';
--   select count(*) from siswa where is_tester is distinct from 'NO';

UPDATE users SET is_tester = 'NO' WHERE is_tester IS DISTINCT FROM 'NO';
UPDATE siswa SET is_tester = 'NO' WHERE is_tester IS DISTINCT FROM 'NO';
