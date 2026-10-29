-- 50_admin_kelas.sql
--
-- Admin Kelas: guru (role tetap GURU) yang ditunjuk Super Admin (ADMIN) untuk
-- memvalidasi paket soal PG & Essay pada kelas-kelas tertentu. Role akun TIDAK
-- berubah, jadi semua endpoint /api/admin/* tetap menolaknya. Hak tambahan
-- hanya berlaku lewat endpoint /api/guru/admin-kelas/* yang memeriksa tabel ini.
--
-- Idempotent. Jalankan di database dulu, baru deploy kodenya.

create table if not exists public.admin_kelas (
  yayasan_id       text not null default 'YYS_AWAL',
  username         text not null references public.users(username) on delete cascade,
  kelas_id         text not null references public.kelas(id) on delete cascade,
  ditugaskan_oleh  text,
  created_at       timestamptz not null default now(),
  primary key (yayasan_id, username, kelas_id)
);

create index if not exists idx_admin_kelas_user  on public.admin_kelas (yayasan_id, username);
create index if not exists idx_admin_kelas_kelas on public.admin_kelas (yayasan_id, kelas_id);

-- Pola wajib repo: RLS aktif tanpa policy + cabut hak (hanya service-role dari server).
alter table public.admin_kelas enable row level security;
revoke all on public.admin_kelas from public, anon, authenticated;
