# Unduh Soal PDF & Word (dengan kop sekolah)

Di menu Guru → Buat Soal, setiap paket soal (PG dan Essay) kini punya tombol **Unduh**:
Unduh PDF, Unduh Word (.docx), dan (khusus PG) centang "Sertakan kunci jawaban".

Isi file: kop (logo, nama sekolah, NPSN, alamat, garis ganda), judul naskah + tahun pelajaran,
kotak identitas (Mata Pelajaran, Kelas, Guru, Jumlah Soal, Waktu), petunjuk, soal + opsi + gambar,
nomor halaman, header halaman lanjutan, dan kunci jawaban opsional.

## Cara pasang
1. `npm install docx`   (menambah dependensi; ikut memperbarui package.json & package-lock.json)
2. Salin ke repo (file baru):
   - src/lib/ekspor-soal.ts
   - src/components/shared/TombolUnduhSoal.tsx
   - public/fonts/*.ttf  (DejaVu Serif, agar simbol √ ≤ ≥ π ² tampil di PDF)
3. Dua file lama diubah sedikit (lihat perubahan-file-lama.patch):
   - src/app/guru/paket/page.tsx  (import + 2 tombol)
   - src/app/api/public/pengaturan/route.ts  (menambah alamatSekolah & npsnSekolah untuk kop)
   Boleh `git apply perubahan-file-lama.patch`, atau salin file-nya jika repo Anda belum berubah.
4. Tidak ada migrasi SQL dan tidak ada route API baru.

## Catatan
- Kop memakai data Pengaturan (nama sekolah, logo, tahun ajaran) dan Informasi Sekolah (alamat, NPSN).
  Bila alamat/NPSN belum diisi admin, barisnya otomatis tidak muncul.
- Gambar soal (webp/png/jpg) dikonversi di browser; jika gagal dimuat, soal tetap tercetak tanpa gambar itu.
- Sudah diuji: `tsc --noEmit` bersih, PDF & Word dibuat dan dirender ulang (lihat contoh-hasil/).
  Belum diuji: tombol di browser sungguhan dengan data/logo asli sekolah Anda.
