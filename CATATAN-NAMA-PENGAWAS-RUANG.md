# Perbaikan: nama pengawas di layar essay siswa ruang khusus

Masalah: layar info essay dan isi amplop offline mengambil nama dari `jadwal.pengawas`
(guru kelas). Untuk sesi ruang khusus (lab), siswa jadi diarahkan ke orang yang salah
saat butuh kode darurat essay.

Perbaikan: nama pengawas mengikuti pengawas SESI, dengan aturan yang sama seperti
`verifySesiOwnership`: bila `info_json.dibuka_oleh_admin` dan `info_json.pengawas_susulan`
terisi (sesi ruang khusus dan sesi susulan admin), pakai orang itu; selain itu pakai
`jadwal.pengawas`.

File:
- src/lib/nama-pengawas-sesi.ts (baru)
- src/app/api/siswa/ujian/essay/info/route.ts
- src/app/api/siswa/ujian/essay/amplop/route.ts

Tidak menyentuh penilaian, sync, kode darurat, maupun alur offline. Hanya teks nama yang tampil.
Catatan: amplop yang SUDAH terunduh di perangkat siswa sebelum patch ini tetap memuat nama lama.
