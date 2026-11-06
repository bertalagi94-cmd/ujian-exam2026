-- 62_mapel_agama_banyak.sql
--
-- Satu mapel khusus agama boleh untuk LEBIH DARI SATU agama.
--
-- Contoh: banyak sekolah menggabungkan siswa Kristen dan Katolik dalam satu
-- kelas Pendidikan Agama. Sekarang kolom mapel.agama boleh berisi beberapa
-- agama dipisah koma, tanpa spasi, mis. 'Kristen,Katolik'. Data lama yang
-- berisi satu agama ('Islam', dst.) tetap valid dan tidak perlu diubah.
--
-- Perubahan: constraint lama mapel_agama_baku (hanya boleh SATU nilai baku)
-- diganti mapel_agama_baku_banyak (setiap nilai di antara koma harus baku).
-- siswa.agama TIDAK berubah (satu siswa tetap satu agama).
--
-- Idempotent (aman dijalankan berulang). Jalankan di database dulu, baru deploy.
-- Prasyarat: 61_agama_siswa_dan_mapel.sql sudah dijalankan.

do $$
begin
  if exists (select 1 from pg_constraint where conname = 'mapel_agama_baku') then
    alter table public.mapel drop constraint mapel_agama_baku;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'mapel_agama_baku_banyak') then
    alter table public.mapel
      add constraint mapel_agama_baku_banyak
      check (
        agama is null
        or string_to_array(agama, ',') <@ array['Islam','Kristen','Katolik','Hindu','Buddha','Konghucu']::text[]
      )
      not valid;
  end if;
end $$;

-- Validasi hanya jika semua baris yang ada sudah sesuai.
do $$
begin
  if not exists (
    select 1 from public.mapel
    where agama is not null
      and not (string_to_array(agama, ',') <@ array['Islam','Kristen','Katolik','Hindu','Buddha','Konghucu']::text[])
  ) then
    alter table public.mapel validate constraint mapel_agama_baku_banyak;
  end if;
end $$;

-- ── (Opsional) Pemeriksaan setelah migrasi ──────────────────────────────────
-- Mapel yang melayani lebih dari satu agama:
--   select nama, agama, guru_id, kelas_list from mapel where agama like '%,%' order by nama;
