-- 66_guru_bk.sql
--
-- GURU BK (Bimbingan dan Konseling): role akun baru 'BK' dengan menu sendiri
-- (/bk) yang hanya-lihat, dibatasi ke KELAS BINAAN masing-masing. Satu guru BK
-- membina beberapa kelas; satu kelas hanya dibina satu guru BK.
--
-- Isi migrasi ini:
--   1. Tabel bk_kelas: penugasan guru BK -> kelas binaan (diatur Admin).
--   2. Penjaga satu kelas = satu guru BK.
--
-- Kolom users.role adalah TEXT bebas (tidak ada CHECK constraint, lihat catatan
-- di 01_schema.sql), jadi nilai 'BK' tidak butuh perubahan skema pada users.
-- Baris di bawah hanya berjaga-jaga kalau database Anda ternyata masih
-- memiliki constraint lama.
--
-- Idempotent. Jalankan di database dulu, baru deploy kodenya.

begin;

alter table public.users drop constraint if exists users_role_check;

create table if not exists public.bk_kelas (
  yayasan_id       text not null default 'YYS_AWAL',
  username         text not null references public.users(username) on delete cascade,
  kelas_id         text not null references public.kelas(id) on delete cascade,
  ditugaskan_oleh  text,
  created_at       timestamptz not null default now(),
  primary key (yayasan_id, username, kelas_id)
);

create index if not exists idx_bk_kelas_user  on public.bk_kelas (yayasan_id, username);

-- Satu kelas hanya boleh punya SATU guru BK (sama seperti Admin Kelas, migrasi 51).
-- Kalau di sekolah Anda satu kelas bisa dibina dua guru BK, hapus index ini.
create unique index if not exists uq_bk_kelas_satu_per_kelas
  on public.bk_kelas (yayasan_id, kelas_id);

-- Pola wajib repo: RLS aktif tanpa policy + cabut hak (hanya service-role dari server).
alter table public.bk_kelas enable row level security;
revoke all on public.bk_kelas from public, anon, authenticated;

commit;
