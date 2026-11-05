-- 60_riwayat_buka_kunci.sql
--
-- Riwayat "Izinkan ujian lagi": pengawas membuka kunci permanen siswa
-- (status TERKUNCI) pada sesi yang masih berjalan. Satu baris per kejadian.
-- Dibaca guru pengampu (halaman Penilaian) dan wali kelas. Baris TIDAK pernah
-- dihapus oleh aplikasi, jadi riwayat tetap ada sampai nilai terkirim dan
-- sesudahnya.
--
-- Idempotent. Jalankan di database dulu, baru deploy kodenya.

create table if not exists public.riwayat_buka_kunci (
  id                   bigserial primary key,
  yayasan_id           text not null default 'YYS_AWAL',
  sesi_id              text not null,
  nis                  text not null,
  kelas                text,
  mapel_id             text,
  dibuka_oleh          text not null,             -- username pengawas / admin
  alasan               text,
  dibuka_pada          timestamptz not null default now(),
  buka_ke              integer not null default 1, -- kejadian ke-berapa untuk siswa+sesi ini
  jumlah_pelanggaran   integer not null default 0, -- pelanggaran yang menyebabkan kunci
  rincian_pelanggaran  jsonb not null default '[]'::jsonb, -- salinan (jenis, level, waktu)
  sisa_detik           integer not null default 0, -- sisa waktu saat dibuka (= sanksi)
  nilai_nol_dihapus    boolean not null default false
);

create index if not exists idx_riwayat_buka_kunci_sesi_nis
  on public.riwayat_buka_kunci (sesi_id, nis);
create index if not exists idx_riwayat_buka_kunci_yayasan
  on public.riwayat_buka_kunci (yayasan_id, dibuka_pada desc);

-- Pola wajib repo: RLS aktif tanpa policy + cabut hak (hanya service-role dari server).
alter table public.riwayat_buka_kunci enable row level security;
revoke all on public.riwayat_buka_kunci from public, anon, authenticated;
