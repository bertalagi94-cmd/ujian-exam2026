# Perbaikan hemat CPU: Layar Pantau (7 Nov 2026)

Tujuan: menurunkan Fluid Active CPU saat ratusan siswa ujian dan guru/kepsek/admin
membuka Layar Pantau. Logika penilaian, rumus nilai, otorisasi, dan format data ke
browser TIDAK diubah. Tidak perlu migrasi SQL. `npx tsc --noEmit` lulus.

## Masalah
Tiap koneksi stream (tiap penonton, tiap tab) membuka channel Realtime sendiri,
lalu pada SETIAP event jawaban dari SEMUA kelas menarik ulang seluruh baris
`jawaban` dan menilainya dengan loop JavaScript. Biaya CPU = penonton x event.

## File
| File | Perubahan |
|---|---|
| `src/lib/leaderboard-live.ts` | Cache hasil papan per sesi + gabung hitungan yang sedang berjalan (20 penonton = 1 hitungan). Papan "kotor" (ada event) dihitung ulang paling cepat tiap 1,5 dtk. Kunci soal per paket (60 dtk) dan nama siswa (10 mnt) di-cache. Hasil dengan query error TIDAK di-cache. Tanda tangan fungsi dan bentuk hasil tidak berubah. |
| `src/lib/layar-pantau-hub.ts` (BARU) | Satu channel Realtime per instance, dibagi semua penonton. Ditutup 5 dtk setelah penonton terakhir pergi. |
| `src/app/api/layar-pantau/stream/route.ts` | Memakai hub. Debounce 250 ms diganti throttle: jeda minimal 2 dtk antar recompute per koneksi, event terakhir dari satu burst tetap ikut terhitung. |

`api/layar-pantau/data/route.ts` tidak diubah, tetapi otomatis ikut hemat karena
memakai `computeLiveLeaderboardUntukSesi` yang sama.

## Perubahan perilaku
- Papan live tampil sekitar 1-2,5 dtk setelah jawaban masuk (dulu sekitar 0,3 dtk).
- Penonton fallback (browser tanpa EventSource, polling 3 dtk) bisa tertinggal
  sampai 5 dtk, karena tidak ada event Realtime yang menandai papan kotor.
- Nama siswa yang diubah admin bisa baru tampil di papan setelah maksimal 10 menit
  (atau saat instance baru). Kunci soal yang diubah di tengah ujian: maksimal 60 dtk.

## Pengaturan opsional (Environment Variables Vercel, semua milidetik)
`LEADERBOARD_TTL_BERSIH_MS` (5000), `LEADERBOARD_JEDA_MIN_MS` (1500),
`LEADERBOARD_TTL_KUNCI_MS` (60000), `LEADERBOARD_TTL_NAMA_MS` (600000).
Isi 0 pada TTL kunci/nama untuk mematikan cache itu.

## Cara memverifikasi
1. Deploy, buka Layar Pantau di beberapa tab saat ada ujian/uji coba.
2. Vercel > Observability > Functions: bandingkan CPU `/api/layar-pantau/stream`
   sebelum dan sesudah.
3. Pantau Vercel > Usage > Fluid Active CPU.

## Membatalkan
Kembalikan `leaderboard-live.ts` dan `stream/route.ts` dari git, lalu hapus
`layar-pantau-hub.ts`.
