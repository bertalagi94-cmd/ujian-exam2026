# Perbaikan masuk ujian serentak + loadtest.html

Ekstrak zip ini di ROOT repo (folder yang berisi package.json) dan pilih "timpa".
Isi zip sudah mencakup semua perubahan dari `perbaikan-loadtest-validasi.patch`
sebelumnya — JANGAN terapkan patch itu lagi.

## File
| File | Status | Isi |
|---|---|---|
| `public/loadtest.html` | timpa | `POST /api/admin/siswa` dikecualikan dari cek "struktur respons berubah" (hilang 501 salah deteksi); tabel ramp-up diberi keterangan bahwa hanya mengukur login |
| `src/lib/batas-konkurensi.ts` | **baru** | pembatas konkurensi FIFO dengan antrean terbatas |
| `src/lib/reset-amplop-server.ts` | timpa | antrean masuk-ujian per instance, single-flight derivasi kunci, masuk-ulang yang sudah di-cache tidak antre |
| `src/app/api/siswa/ujian/validasi/route.ts` | timpa | antrean penuh -> `valid:false` + pesan "coba lagi" (belum ada tulisan DB), `maxDuration = 30`, log `[validasi][lambat]` |
| `src/app/api/siswa/ujian/cek-sesi/route.ts` | timpa | lookup "dipantau" paralel, heartbeat ditulis lewat `after()` |
| `src/lib/cache.ts` | timpa | `cachedFetch` berbagi satu pengambilan saat banyak request bersamaan |

## Pengaturan opsional (Vercel -> Environment Variables)
- `RESET_PBKDF2_KONKURENSI` (1..4, bawaan = jumlah CPU terlihat, maks 4)
- `RESET_PBKDF2_ANTREAN_MAKS` (0..500, bawaan 25 siswa per instance)

## Yang TIDAK diubah (sengaja)
- Iterasi PBKDF2 (600.000), cara kode reset diturunkan, dan format amplop.
- Jalur submit (`selesai`) dan `sync`: sudah memakai RPC atomik
  `finalisasi_pg_atomik`, cek device_id, dan respons idempoten. Tidak ada
  perubahan karena tidak ditemukan masalah di kode; verifikasinya lewat load test.

## Cara memeriksa setelah deploy
1. Jalankan load test. Cari di log Vercel: `[validasi][lambat]` (derivasi >500 ms)
   dan `[validasi][antre-penuh]` (siswa diminta mencoba lagi).
2. Kalau sering `antre-penuh`: naikkan `RESET_PBKDF2_ANTREAN_MAKS` atau
   beri tahu siswa masuk bergelombang per kelas.
3. Bersihkan akun siswa LOADTEST_* setelah tes.
