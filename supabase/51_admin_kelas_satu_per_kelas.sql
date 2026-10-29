-- 51_admin_kelas_satu_per_kelas.sql
--
-- Satu kelas hanya boleh punya SATU Admin Kelas. Jalankan SETELAH 50.
-- Idempotent. Kalau gagal dengan "could not create unique index", berarti
-- sudah ada kelas yang dipegang >1 guru (data uji): cek dengan
--   select kelas_id, count(*) from admin_kelas group by 1 having count(*) > 1;
-- lalu hapus penugasan gandanya lewat halaman Admin Kelas, dan jalankan ulang.

create unique index if not exists uq_admin_kelas_satu_per_kelas
  on public.admin_kelas (yayasan_id, kelas_id);
