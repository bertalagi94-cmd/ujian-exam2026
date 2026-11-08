-- 65_ruang_khusus.sql
--
-- RUANG KHUSUS: siswa yang tidak punya HP dikumpulkan di satu lab komputer
-- (bisa dari beberapa kelas) dan diawasi SATU pengawas ruang khusus.
--
-- Rancangan (disepakati): siswa yang sudah diproses LEPAS dari sesi kelasnya
-- dan mengikuti sesi milik ruang khusus -- token, tutup sesi, akses essay,
-- reset, pelanggaran. Karena soal dan nilai terikat mapel+kelas, di dalam
-- sistem satu ruang = satu sesi_ujian per jadwal yang dipakai siswanya, semua
-- bertanda ruang_khusus_id yang sama. Pengguna hanya melihat satu ruang.
--
-- Isi migrasi ini:
--   1. Tabel ruang_khusus          : satu baris per ruang (pengawas, kode ruang).
--   2. Tabel ruang_khusus_siswa    : siswa yang diproses ke ruang, per jadwal.
--   3. Kolom sesi_ujian.ruang_khusus_id (NULL = sesi kelas biasa).
--   4. Penjaga "satu sesi BERJALAN per jadwal" DIPECAH:
--        - sesi kelas  : satu per jadwal           (nama index tetap)
--        - sesi ruang  : satu per jadwal PER RUANG
--      Tanpa ini, sesi ruang khusus ditolak database selama sesi kelas jalan.
--
-- Catatan nama index: uq_sesi_berjalan_per_jadwal SENGAJA dipertahankan untuk
-- sesi kelas. Migrasi 37 memakai CREATE UNIQUE INDEX IF NOT EXISTS dengan nama
-- itu, jadi kalau file 37 dijalankan ulang di kemudian hari, ia melihat nama
-- itu sudah ada dan TIDAK membuat ulang index lama yang melarang sesi ruang.
--
-- Idempotent. Satu transaksi: pergantian index tidak meninggalkan jeda tanpa
-- penjaga. Jalankan di database dulu, baru deploy kodenya.

BEGIN;

-- ── 1. Tabel ruang_khusus ────────────────────────────────────────────────────
create table if not exists public.ruang_khusus (
  id            text primary key,
  yayasan_id    text not null default 'YYS_AWAL',
  nama          text,                                   -- label bebas, mis. "Lab 1"
  pengawas      text not null,                          -- username guru pengawas ruang
  kode_ruang    text not null,                          -- token satu-untuk-semua siswa ruang (7 karakter)
  jadwal_ids    text[] not null default '{}',           -- jadwal yang dipilih admin
  status        text not null default 'MENUNGGU'
                check (status in ('MENUNGGU', 'BERJALAN', 'SELESAI', 'DIBATALKAN')),
  dibuat_oleh   text,                                   -- username admin
  created_at    timestamptz not null default now(),
  waktu_mulai   timestamptz,
  waktu_selesai timestamptz
);

-- Satu kode ruang aktif hanya milik satu ruang di satu yayasan.
create unique index if not exists uq_ruang_khusus_kode_aktif
  on public.ruang_khusus (yayasan_id, kode_ruang)
  where status in ('MENUNGGU', 'BERJALAN');

create index if not exists idx_ruang_khusus_pengawas
  on public.ruang_khusus (yayasan_id, pengawas, status);

-- ── 2. Tabel ruang_khusus_siswa ──────────────────────────────────────────────
create table if not exists public.ruang_khusus_siswa (
  id           bigserial primary key,
  yayasan_id   text not null default 'YYS_AWAL',
  ruang_id     text not null,
  nis          text not null,
  jadwal_id    text not null,                           -- jadwal yang berlaku untuk siswa ini
  sesi_id      text,                                    -- sesi ruang untuk jadwal itu (diisi saat Mulai sesi)
  status       text not null default 'DIPROSES'
               check (status in ('DIPROSES', 'DILEPAS')),
  diproses_oleh text,
  diproses_pada timestamptz not null default now(),
  dilepas_oleh  text,
  dilepas_pada  timestamptz
);

-- PENJAGA BALAPAN: satu siswa hanya boleh punya SATU penempatan aktif per
-- jadwal. Dua pengawas ruang yang mencentang siswa yang sama pada saat yang
-- sama tidak bisa sama-sama berhasil.
create unique index if not exists uq_ruang_khusus_siswa_aktif
  on public.ruang_khusus_siswa (nis, jadwal_id)
  where status = 'DIPROSES';

create index if not exists idx_ruang_khusus_siswa_ruang
  on public.ruang_khusus_siswa (ruang_id, status);
create index if not exists idx_ruang_khusus_siswa_jadwal
  on public.ruang_khusus_siswa (jadwal_id, status);

-- ── 3. Kolom penanda sesi ruang khusus ───────────────────────────────────────
-- NULL = sesi kelas biasa (semua sesi lama otomatis NULL). Sengaja TANPA
-- foreign key: backup/restore memulihkan tabel satu per satu.
alter table public.sesi_ujian
  add column if not exists ruang_khusus_id text;

create index if not exists idx_sesi_ujian_ruang_khusus
  on public.sesi_ujian (ruang_khusus_id)
  where ruang_khusus_id is not null;

-- ── 4. Pecah penjaga satu-sesi-BERJALAN-per-jadwal ───────────────────────────
-- Hanya dikerjakan bila index yang ada belum mengenal ruang_khusus_id, supaya
-- menjalankan file ini dua kali tidak menjatuhkan index yang sudah benar.
do $$
begin
  if not exists (
    select 1 from pg_indexes
    where schemaname = 'public'
      and indexname = 'uq_sesi_berjalan_per_jadwal'
      and indexdef like '%ruang_khusus_id%'
  ) then
    drop index if exists public.uq_sesi_berjalan_per_jadwal;
    create unique index uq_sesi_berjalan_per_jadwal
      on public.sesi_ujian using btree (jadwal_id)
      where (status = 'BERJALAN'::text and ruang_khusus_id is null);
  end if;
end $$;

-- Sesi ruang: satu per jadwal PER RUANG. Dua ruang berbeda boleh sama-sama
-- punya sesi BERJALAN untuk jadwal yang sama (siswa lab dari kelas yang sama
-- bisa tersebar di dua lab).
create unique index if not exists uq_sesi_berjalan_per_jadwal_ruang
  on public.sesi_ujian using btree (jadwal_id, ruang_khusus_id)
  where (status = 'BERJALAN'::text and ruang_khusus_id is not null);

-- ── 5. Pola wajib repo: RLS aktif tanpa policy + cabut hak ───────────────────
alter table public.ruang_khusus enable row level security;
revoke all on public.ruang_khusus from public, anon, authenticated;
alter table public.ruang_khusus_siswa enable row level security;
revoke all on public.ruang_khusus_siswa from public, anon, authenticated;

-- ── POSTFLIGHT ───────────────────────────────────────────────────────────────
do $$
begin
  if not exists (
    select 1 from pg_indexes
    where schemaname = 'public'
      and indexname = 'uq_sesi_berjalan_per_jadwal'
      and indexdef like '%ruang_khusus_id IS NULL%'
  ) then
    raise exception 'Postflight gagal: uq_sesi_berjalan_per_jadwal belum membatasi sesi kelas (ruang_khusus_id IS NULL)';
  end if;
  if not exists (
    select 1 from pg_indexes
    where schemaname = 'public' and indexname = 'uq_sesi_berjalan_per_jadwal_ruang'
  ) then
    raise exception 'Postflight gagal: uq_sesi_berjalan_per_jadwal_ruang tidak terbentuk';
  end if;
end $$;

COMMIT;

-- Verifikasi manual (opsional):
--   select indexname, indexdef from pg_indexes
--   where tablename = 'sesi_ujian' and indexname like 'uq_sesi_berjalan%';
