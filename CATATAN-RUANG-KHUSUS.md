# Ruang Khusus (lab komputer untuk siswa tanpa HP)

## Cara pasang (urutan penting)
1. Jalankan `supabase/65_ruang_khusus.sql` di database (SQL editor). Aman dijalankan dua kali.
2. Ekstrak zip ini di folder utama proyek (yang berisi `src` dan `supabase`), timpa file yang sama.
3. Deploy. Uji di staging dulu (lihat daftar uji di bawah).

## Cara kerja
- Admin: menu **Ruang Khusus** -> pilih tanggal, jadwal yang belum selesai (yang berjalan boleh), dan satu guru. Sistem mengecek guru bebas (tumpang tindih jam dengan jadwal mengawas, ruang khusus lain, susulan).
- Guru yang ditunjuk: menu **Pengawas Ruang Khusus** -> cari & centang siswa -> **Proses** -> **Mulai sesi** -> pantau di Mode Pengawas biasa.
- Siswa lab memakai SATU kode ruang. Sistem mengarahkan tiap siswa ke sesi sesuai kelas+mapelnya.
- Siswa yang diproses lepas dari sesi kelas. Pengawas kelas melihat status "Ujian di ruang khusus" lalu "Selesai", tanpa pelanggaran/reset.
- Menutup sesi kelas TIDAK memengaruhi siswa lab. Status jadwal baru SELESAI bila tidak ada sesi lain yang BERJALAN.

## Daftar uji staging (wajib sebelum ujian sungguhan)
1. Kelas + ruang khusus berjalan bersamaan pada jadwal yang sama; kode kelas dan kode ruang masing-masing hanya bisa dipakai siswanya.
2. Siswa yang sudah diproses mengetik kode KELAS -> ditolak dengan pesan ruang khusus.
3. Pengawas kelas menutup sesi lebih dulu -> siswa lab yang belum masuk TIDAK melihat "ujian ditutup", ujian lab tetap jalan.
4. Proses siswa yang sudah/sedang ujian, beda agama, atau kelasnya tak punya mapel -> diabaikan dengan alasan.
5. Dua guru mencentang siswa yang sama bersamaan -> hanya satu yang berhasil.
6. Lepas siswa sebelum masuk -> boleh; sesudah masuk -> ditolak.
7. Tutup sesi ruang -> siswa yang tak pernah masuk dilepas, ruang menjadi SELESAI, mereka bisa ikut susulan.
8. Periksa Essay: sesi kelas dan sesi ruang tampil sebagai dua entri; ubah bobot PG:Essay -> berlaku di keduanya.
9. Layar Pantau: pengawas kelas tidak melihat papan sesi ruang; pengawas ruang melihat sesinya.
10. Backup lalu restore -> data ruang khusus ikut kembali.
11. Essay ruang: satu tombol menyalakan semua sesi ruang yang punya essay; sesi tanpa essay/soal disetujui dilaporkan "dilewati".
12. Kode darurat essay: kode di halaman ruang = kode di tiap kartu Mode Pengawas; siswa offline dari dua kelas berbeda di ruang yang sama bisa membuka essay dengan kode itu; sesi KELAS biasa tetap memakai kodenya sendiri seperti sebelumnya.

## Batasan yang diketahui
- Essay: pengawas ruang punya satu tombol "Buka/Tutup Mulai Essay" untuk seluruh ruang (menyalakan semua sesi ruang yang punya essay dan soal essay disetujui; yang dilewati dilaporkan) dan SATU kode darurat essay untuk seluruh ruang. Kartu per jadwal di Mode Pengawas tetap bisa dipakai dan menampilkan kode yang sama.
- Analisis Ujian masih per sesi: siswa lab dianalisis terpisah dari kelas.
- Halaman ujian siswa belum menampilkan label khusus "ujian di ruang khusus"; siswa hanya mendapat pesan dari validasi token.
- Tabel `riwayat_buka_kunci` (migrasi 60) tidak masuk daftar backup (celah lama, tidak diubah di sini).
