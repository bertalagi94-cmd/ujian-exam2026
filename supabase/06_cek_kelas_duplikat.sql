-- supabase/06_cek_kelas_duplikat.sql
--
-- Terkait FIX BUG #4 (soal lintas kelas). Root cause di aplikasi sudah
-- ditutup di src/app/api/siswa/ujian/validasi/route.ts (server sekarang
-- menolak membuka ujian kalau paketData tidak ditemukan, bukan lagi
-- fallback ke query tanpa scope kelas). Tapi salah satu skenario yang
-- membuat paketData jadi null adalah `kelas.nama` yang tidak unik —
-- lookup `.eq('nama', ...).maybeSingle()` di validasi/route.ts dan
-- selesai/route.ts akan gagal (>1 baris ditemukan) kalau ada 2 baris kelas
-- dengan nama sama (misalnya dari re-run script import).
--
-- LANGKAH 1 — jalankan dulu query ini untuk MELIHAT apakah ada duplikat:
select nama, count(*) as jumlah_baris, array_agg(id) as id_list
from kelas
group by nama
having count(*) > 1;

-- Kalau hasilnya KOSONG, aman lanjut ke LANGKAH 2 di bawah.
-- Kalau hasilnya TIDAK kosong: sebelum menambah constraint, tentukan dulu
-- baris `kelas.id` mana yang "benar" untuk tiap nama yang duplikat (cek mana
-- yang direferensikan oleh siswa.kelas, jadwal.kelas, paket_soal.kelas_id
-- paling banyak), lalu migrasikan/hapus baris duplikatnya secara manual.
-- Ini keputusan data, bukan sesuatu yang aman dilakukan otomatis lewat
-- migration generik seperti ini.

-- LANGKAH 2 — setelah dipastikan tidak ada duplikat, cegah duplikat baru:
-- (aman dijalankan berkali-kali)
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'kelas_nama_unique'
  ) then
    alter table kelas add constraint kelas_nama_unique unique (nama);
  end if;
end $$;
