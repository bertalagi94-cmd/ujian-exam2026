-- Izin akses Layar Pantau untuk akun GURU.
-- Guru harus meminta izin; admin menyetujui/menolak/mencabut dari menu
-- "Izin Layar Pantau". KEPSEK dan ADMIN tidak perlu izin.
-- Aman dijalankan berulang kali.

create table if not exists public.izin_layar_pantau (
  id               text primary key,
  yayasan_id       text not null default 'YYS_AWAL',
  username         text not null,
  nama             text,
  status           text not null default 'MENUNGGU'
                   check (status in ('MENUNGGU','DISETUJUI','DITOLAK','DICABUT')),
  diminta_pada     timestamptz not null default now(),
  diputuskan_oleh  text,
  diputuskan_pada  timestamptz,
  berlaku_sampai   timestamptz
);

create index if not exists idx_izin_pantau_user
  on public.izin_layar_pantau (yayasan_id, username, diminta_pada desc);
create index if not exists idx_izin_pantau_status
  on public.izin_layar_pantau (yayasan_id, status);

-- Hanya diakses lewat service-role dari server (RLS aktif tanpa policy).
alter table public.izin_layar_pantau enable row level security;
