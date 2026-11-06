-- 61_agama_siswa_dan_mapel.sql
--
-- Agama siswa + mapel khusus agama.
--
-- Masalah: dalam satu kelas siswa bisa berbeda agama, dan Pendidikan Agama
-- diajarkan per agama (mis. PAI untuk siswa Islam, PAK untuk siswa Kristen).
-- Sebelumnya SEMUA siswa kelas dihitung peserta ujian PAI, sehingga siswa
-- Kristen tampil "belum login" di akun pengawas, ikut dihitung "belum ujian"
-- di Admin Jadwal, dan menghalangi penghapusan jadwal yang sudah selesai.
--
-- Perubahan:
--   siswa.agama  : agama siswa (kosong = belum diisi)
--   mapel.agama  : kosong = mapel umum (semua siswa kelas ikut);
--                  terisi = mapel khusus agama (hanya siswa seagama ikut)
--
-- Nilai baku: Islam, Kristen, Katolik, Hindu, Buddha, Konghucu.
--
-- Aturan di aplikasi:
--   - siswa yang agamanya BELUM diisi tetap dihitung peserta mapel agama apa
--     pun (supaya data lama tidak tiba-tiba tidak bisa ujian). Lengkapi agama
--     siswa di menu Data Siswa (form atau impor Excel).
--   - aplikasi tetap berjalan bila migrasi ini belum dijalankan (semua mapel
--     dianggap umum), tetapi fitur agama baru aktif setelah ini dijalankan.
--
-- Idempotent (aman dijalankan berulang). Jalankan di database dulu, baru deploy.

alter table public.siswa add column if not exists agama text;
alter table public.mapel add column if not exists agama text;

-- Batasi isian ke nilai baku (atau kosong). Dibuat NOT VALID lalu divalidasi
-- supaya data lama yang sudah terlanjur terisi bebas tidak membuat migrasi gagal
-- di tengah jalan; baris bermasalah (kalau ada) dilaporkan oleh query di bawah.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'siswa_agama_baku') then
    alter table public.siswa
      add constraint siswa_agama_baku
      check (agama is null or agama in ('Islam','Kristen','Katolik','Hindu','Buddha','Konghucu'))
      not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'mapel_agama_baku') then
    alter table public.mapel
      add constraint mapel_agama_baku
      check (agama is null or agama in ('Islam','Kristen','Katolik','Hindu','Buddha','Konghucu'))
      not valid;
  end if;
end $$;

-- Validasi hanya jika semua baris sudah sesuai (kolom baru kosong semua, jadi
-- pada pemasangan pertama ini selalu lolos).
do $$
begin
  if not exists (select 1 from public.siswa where agama is not null and agama not in ('Islam','Kristen','Katolik','Hindu','Buddha','Konghucu')) then
    alter table public.siswa validate constraint siswa_agama_baku;
  end if;
  if not exists (select 1 from public.mapel where agama is not null and agama not in ('Islam','Kristen','Katolik','Hindu','Buddha','Konghucu')) then
    alter table public.mapel validate constraint mapel_agama_baku;
  end if;
end $$;

-- ── (Opsional) Pemeriksaan setelah migrasi ──────────────────────────────────
-- Siswa aktif yang agamanya belum diisi (akan dihitung peserta SEMUA mapel agama):
--   select kelas, count(*) as belum_diisi
--   from siswa where status = 'AKTIF' and agama is null
--   group by kelas order by kelas;
--
-- Sebaran agama per kelas:
--   select kelas, agama, count(*) from siswa where status = 'AKTIF'
--   group by kelas, agama order by kelas, agama;
--
-- Mapel yang sudah ditandai khusus agama:
--   select nama, agama, guru_id, kelas_list from mapel where agama is not null order by nama;
