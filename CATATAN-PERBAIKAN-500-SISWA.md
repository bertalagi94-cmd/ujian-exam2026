# Perbaikan beban 500 siswa (3 Nov 2026)

Ekstrak zip ini di root repo (folder yang berisi package.json), timpa file yang sama.

| File | Perubahan |
|---|---|
| `src/app/api/siswa/ujian/validasi/route.ts` | `increment_jumlah_peserta` sekarang benar-benar dijalankan (lewat `after()`); sebelumnya tanpa await sehingga tidak pernah terkirim. |
| `src/app/api/siswa/ujian/selesai/route.ts` | Tambah `export const maxDuration = 30`. |
| `src/app/siswa/ujian/page.tsx` | Masuk ujian mengulang otomatis (maks 8x, jeda acak 2,5-6 dtk) saat server menjawab `coba_lagi`. |

Logika bisnis tidak berubah. `npx tsc --noEmit` lulus.
