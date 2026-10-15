-- 43a: diagnosis tabel pengaturan (hanya membaca, aman dijalankan kapan saja)
-- 1) Kunci/constraint yang ada
select conname, contype, pg_get_constraintdef(oid) as definisi
from pg_constraint where conrelid = 'pengaturan'::regclass;
-- 2) Indeks yang ada
select indexname, indexdef from pg_indexes where tablename = 'pengaturan';
-- 3) Apakah kolom yayasan_id ada dan apakah ada yang NULL
select count(*) filter (where yayasan_id is null) as baris_tanpa_yayasan, count(*) as total from pengaturan;
