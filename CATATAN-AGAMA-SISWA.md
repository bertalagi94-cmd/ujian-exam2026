# Agama siswa dan mapel khusus agama

Dalam satu kelas siswa bisa berbeda agama, dan Pendidikan Agama diajarkan per agama
(mis. PAI untuk siswa Islam, PAK untuk siswa Kristen). Sebelumnya semua siswa kelas
dihitung peserta ujian PAI, sehingga siswa Kristen tampil "belum login" di akun pengawas.

## Cara memasang

1. Jalankan `supabase/61_agama_siswa_dan_mapel.sql` di Supabase (SQL Editor). Aman diulang.
2. Deploy kode ini.
3. Isi agama siswa: menu **Data Siswa** (form Edit, atau kolom **Agama** di impor Excel).
   Unduh template baru dari menu itu. Isian seperti `Islam`, `Kristen`, `Kristen Protestan`,
   `Katolik`, `Hindu`, `Buddha`/`Budha`, `Konghucu`/`Khonghucu` dikenali.
4. Tandai mapel agama: menu **Mata Pelajaran**, isi **Khusus Agama**.
   Buat satu mapel per agama, mis. `PENDIDIKAN AGAMA ISLAM` (Islam) dan
   `PENDIDIKAN AGAMA KRISTEN` (Kristen), masing-masing dengan guru, paket soal, dan jadwal sendiri.
   Mapel biasa (Matematika, dll.) dibiarkan **Umum**.
5. Buat jadwal seperti biasa, satu jadwal per mapel agama untuk kelas yang sama.
   Sistem hanya mengizinkan satu sesi aktif per kelas, jadi atur PAI dan PAK di jam berbeda.

## Aturan

- Mapel Umum: semua siswa aktif kelas itu adalah peserta (sama seperti sebelumnya).
- Mapel Khusus Agama: hanya siswa seagama yang menjadi peserta.
- Siswa yang agamanya **belum diisi** tetap dihitung peserta mapel agama apa pun, supaya
  data lama tidak tiba-tiba tidak bisa ujian. Mereka masih muncul "belum login" di pengawas
  sampai agamanya dilengkapi. Tabel siswa menandainya dengan "Belum diisi".
- Siswa beda agama yang sudah telanjur login ke sesi tetap tampil di pantauan.
- Kode aman kalau SQL belum dijalankan: semua mapel dianggap umum (perilaku lama).
  Menyimpan agama sebelum SQL dijalankan menampilkan pesan agar menjalankan SQL dulu.

## Yang ikut disaring

- Mode Pengawas: daftar siswa, status belum login, kode reset, dan pengingat sesi belum ditutup.
- Periksa Essay, ujian susulan (guru dan admin).
- Admin Jadwal: daftar belum ujian dan pengecekan saat menghapus jadwal selesai.
- Rekap Nilai dan Kirim Nilai guru, Analisis Ujian (guru dan admin), Monitoring Kepala Sekolah.
- Akun siswa: jadwal dan dashboard menyembunyikan mapel agama lain; masuk ruang ujian
  mapel agama lain ditolak dengan pesan jelas.

## Berkas

- Baru: `src/lib/agama.ts`, `supabase/61_agama_siswa_dan_mapel.sql`.
- Diubah: lihat `git diff --stat` (25 berkas).
