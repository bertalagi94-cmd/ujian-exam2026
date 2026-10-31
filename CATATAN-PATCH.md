# Patch: kelas otomatis saat import siswa

Ekstrak zip ini di root repo (folder yang berisi `package.json`), timpa file yang sama.

## File
- `src/lib/kelas-sync.ts` (BARU)
- `src/app/api/admin/siswa/route.ts` (POST tambah siswa manual)
- `src/app/api/admin/siswa/import/route.ts` (import dari halaman Siswa)
- `src/app/api/admin/import/route.ts` (import dari halaman Import)

## Perubahan perilaku
1. Import Excel sekarang membuat baris di tabel `kelas` untuk nama kelas yang belum ada.
2. Pencocokan nama kelas tidak peduli huruf besar/kecil dan spasi ganda ("x  a" = "X A").
   Kalau kelas sudah ada, siswa memakai ejaan yang tersimpan di tabel `kelas`.
   Kalau belum ada, kelas baru dibuat dengan huruf besar (sama seperti tambah siswa manual).
3. `sekolah_id` kelas baru diisi otomatis kalau yayasan hanya punya SATU sekolah.
   Kalau lebih dari satu sekolah, dibiarkan kosong dan admin diberi peringatan
   (import halaman Siswa: kotak peringatan; tambah manual: field `peringatan` di respons).
4. Baris dengan kolom kelas kosong tetap tersimpan seperti sebelumnya dan tidak membuat kelas.

## Yang tidak berubah
- Kelas lama yang `sekolah_id`-nya kosong tidak diubah otomatis (sudah dibereskan lewat SQL).
- Import di halaman Import (`admin/import`) belum menampilkan peringatan multi-sekolah
  karena halamannya tidak menangani event 'warning'. Kelas tetap dibuat, hanya tanpa pesan.

## Verifikasi
- `npx tsc --noEmit` lolos tanpa error.
- Helper diuji dengan database tiruan: kelas lama dipakai ulang, kelas baru dibuat sekali,
  `sekolah_id` terisi untuk yayasan 1 sekolah dan kosong untuk yayasan multi-sekolah.
