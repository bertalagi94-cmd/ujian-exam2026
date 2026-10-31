# Patch v2: kelas selalu konsisten (kumulatif, menggantikan patch-kelas-otomatis.zip)

Ekstrak di root repo (folder yang berisi `package.json`), timpa file yang sama.
Kalau sudah menerapkan patch sebelumnya, cukup terapkan zip ini saja.

## File
- `src/lib/kelas-sync.ts` (BARU)
- `src/app/api/admin/siswa/route.ts` (tambah siswa manual)
- `src/app/api/admin/siswa/[nis]/route.ts` (edit siswa)  <- BARU di v2
- `src/app/api/admin/siswa/import/route.ts` (import halaman Siswa)
- `src/app/api/admin/import/route.ts` (import halaman Import)

## Perubahan perilaku
1. Semua jalur yang menulis `siswa.kelas` (tambah manual, EDIT, dua import) sekarang:
   - merapikan nama (trim, spasi ganda jadi satu),
   - mencocokkan tanpa peduli huruf besar/kecil dengan kelas yang sudah ada dan memakai
     ejaan yang tersimpan di tabel `kelas`,
   - membuat baris `kelas` kalau belum ada (huruf besar),
   - mengisi `sekolah_id` otomatis kalau yayasan hanya punya satu sekolah. Kalau lebih dari
     satu sekolah, dikosongkan dan admin diberi peringatan.
2. Edit siswa: kolom kelas yang kosong tetap berarti "tidak diubah" seperti sebelumnya.
   Respons bisa memuat field `peringatan` (belum ditampilkan UI, aman diabaikan).

## Yang sengaja TIDAK diubah
- `siswa/ujian/validasi` tetap membandingkan kelas persis. Kalau kelas tidak punya paket soal,
  rute itu sudah berhenti dengan pesan jelas. Melonggarkan perbandingan di satu tempat saja
  tidak menolong karena jadwal/dashboard siswa juga memakai `.eq('kelas', ...)`.
- Penghapusan cache dashboard di reset/restore (kunci lama): rute itu ditolak saat
  MULTI_YAYASAN_ENABLED=true, jadi tidak berdampak di setup ini.

## Catatan
- `user.kelas` siswa berasal dari token login. Kalau admin memindahkan siswa ke kelas lain,
  siswa itu perlu login ulang agar token memuat kelas baru.
- `npx tsc --noEmit` lolos tanpa error.
