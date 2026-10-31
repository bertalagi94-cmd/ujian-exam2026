# Perbaikan tahap 2 (pembanding health + pencatatan metrik)

Ekstrak di ROOT repo (folder berisi package.json), pilih "timpa". Hanya 2 file.
`public/loadtest.html` di zip ini sudah memuat SEMUA perubahan tahap 1 juga,
jadi cukup timpa dengan yang ini.

| File | Perubahan |
|---|---|
| `public/loadtest.html` | Setelah polling cek-sesi, tes memanggil `GET /api/siswa/ujian/health` (tanpa auth & tanpa DB) dengan jumlah dan pola yang sama sebagai PEMBANDING. Laporan punya bagian "Pembanding Jaringan" berisi rata-rata/P95/terlama kedua endpoint + kesimpulan INDIKASI (jaringan/browser vs server/DB). Tidak dihitung sebagai bug. |
| `src/lib/metrik.ts` | Penulisan `metrik_sistem` memakai `after()` (bukan promise menggantung), supaya tidak memicu error ETIMEDOUT "Gagal catat metrik_sistem" di request lain. Tidak menambah latensi respons. |

## Cara membaca hasil pembanding
- health rata² >= sekitar 60% dari cek-sesi: lambat ada di browser/jaringan penguji (atau platform), bukan di kode/DB aplikasi.
- health <= sekitar 40% dari cek-sesi: selisih berasal dari server/database; periksa Supabase -> Reports -> Database.
- Di antaranya: belum pasti; ulangi tes. Ambang ini heuristik, bukan bukti.

## Verifikasi
`tsc --noEmit` seluruh proyek: lolos. Sintaks JS loadtest.html: lolos. Belum dijalankan ke produksi.
Tes akan berjalan sekitar 30 detik lebih lama (3 putaran x jendela 10 detik) pada pola Realistis.
