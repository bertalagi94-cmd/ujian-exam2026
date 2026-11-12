-- Query diagnosis simulasi 12 Nov 2026 (jalankan di Supabase SQL Editor).
-- 13.20 WITA = timestamptz '2026-11-12 13:20:00+08'

-- A. Pelanggaran per menit (apakah ada lonjakan 13.44?)
select date_trunc('minute', p.created_at at time zone 'Asia/Makassar') as menit_wita,
       p.jenis, count(*) as kejadian, count(distinct p.nis) as siswa, count(distinct p.sesi_id) as sesi
from public.pelanggaran p
where p.created_at >= timestamptz '2026-11-12 13:20:00+08'
group by 1, 2 order by 1, 2;

-- B. Pelanggaran terhadap waktu sejak ujian dimulai
select p.jenis,
  count(*) filter (where p.created_at - su.waktu_mulai_awal < interval '30 seconds') as dalam_30_dtk,
  count(*) filter (where p.created_at - su.waktu_mulai_awal >= interval '30 seconds'
                     and p.created_at - su.waktu_mulai_awal < interval '3 minutes') as dalam_3_menit,
  count(*) filter (where p.created_at - su.waktu_mulai_awal >= interval '3 minutes') as lebih_lama,
  count(*) as total
from public.pelanggaran p
join public.siswa_ujian su on su.sesi_id = p.sesi_id and su.nis = p.nis
where su.waktu_mulai_awal >= timestamptz '2026-11-12 13:20:00+08'
group by p.jenis order by total desc;

-- C. Jawaban susulan setelah penutupan
select aksi, count(*) as kejadian, count(distinct user_id) as siswa,
       min(created_at at time zone 'Asia/Makassar') as pertama,
       max(created_at at time zone 'Asia/Makassar') as terakhir
from public.log_aktivitas
where created_at >= timestamptz '2026-11-12 13:20:00+08'
  and aksi in ('SYNC_TERLAMBAT', 'SYNC_SETELAH_TUTUP')
group by aksi;

-- D. Apakah fungsi RPC masih bisa dipanggil publik di produksi?
select p.proname,
       has_function_privilege('anon', p.oid, 'execute') as anon_bisa,
       has_function_privilege('authenticated', p.oid, 'execute') as auth_bisa
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname like '%atomik';

-- E. Jalankan beberapa kali berselang 10 detik SAAT beban puncak
select state, wait_event_type, wait_event, count(*) as jumlah
from pg_stat_activity where datname = current_database()
group by 1, 2, 3 order by jumlah desc;

-- F. Query paling berat (kumulatif)
select left(query, 100) as query, calls,
       round(total_exec_time::numeric) as total_ms,
       round(mean_exec_time::numeric, 1) as rata_ms,
       round(max_exec_time::numeric) as max_ms
from pg_stat_statements order by total_exec_time desc limit 15;

-- G. (Setelah patch ini, simulasi berikutnya) Pelanggaran per jenis dan per perangkat.
-- detail berakhiran: [APK lock:aktif vis:visible model:XXX] | kejadian=ISO tunda=Ns
select p.jenis,
       case when p.detail like '%[APK %' then 'APK' when p.detail like '%[WEB %' then 'WEB' else '?' end as perangkat,
       count(*) as kejadian, count(distinct p.nis) as siswa
from public.pelanggaran p
where p.created_at >= timestamptz '2026-11-12 00:00:00+08'
group by 1, 2 order by kejadian desc;

-- H. Siapa menutup sesi (aksi baru dari patch ini)
select created_at at time zone 'Asia/Makassar' as waktu_wita, user_id, aksi, detail
from public.log_aktivitas
where aksi in ('TUTUP_SESI', 'TUTUP_SESI_RINCIAN')
order by created_at desc limit 50;
