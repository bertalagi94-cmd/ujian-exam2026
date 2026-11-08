# Hemat Vercel tahap 2 (9 Nov 2026)

Lanjutan `CATATAN-HEMAT-VERCEL.md`. Tujuan: mengurangi invocation dan CPU fungsi Vercel
untuk ujian serentak. Logika ujian, penilaian, anti-curang, dan format data TIDAK diubah.
Tidak perlu migrasi SQL. `npx tsc --noEmit` lulus.

| File | Perubahan |
|---|---|
| `src/app/siswa/ujian/page.tsx` | Polling `cek-sesi` 20 dtk menjadi 30 dtk. Polling `amplop` essay jadi bertahap (20 dtk, 60 dtk, 180 dtk) saat server menjawab "belum" atau 5xx. `cek-sesi` dan `sync` yang gagal karena jaringan memicu pemeriksaan jaringan langsung. |
| `src/lib/status-jaringan.ts` | `KONTAK_SEGAR_MS` 15 dtk menjadi 35 dtk. Fungsi baru `periksaJaringanSekarang()` (ping paksa, dibatasi satu pemeriksaan berjalan + jarak minimum 2 dtk). |

## Mengapa dua perubahan pertama harus berpasangan
Denyut `/health` dilewati kalau ada request sukses dalam `KONTAK_SEGAR_MS` terakhir.
Kalau `cek-sesi` diperlambat tetapi ambang itu tetap 15 dtk, `/health` malah lebih sering
terkirim (sekitar 120 per siswa per jam), dan penghematannya hilang. Aturan: `KONTAK_SEGAR_MS`
harus lebih besar dari jeda `cek-sesi`. Kalau jeda `cek-sesi` dinaikkan lagi, naikkan keduanya.

## Perkiraan dampak (600 siswa, 60 menit, 50 soal)
Angka di bawah adalah estimasi dari kode, bukan hasil ukur.

| | Sebelum | Sesudah |
|---|---|---|
| Request per siswa | sekitar 286 | sekitar 186 |
| Request per sesi | sekitar 171.600 | sekitar 111.600 (-35%) |
| Active CPU per sesi | sekitar 0,65 jam | sekitar 0,53 jam (-18%) |
| Sesi sampai 1 juta invocation (Hobby) | sekitar 5,8 | sekitar 9,0 |

## Perubahan perilaku yang perlu diketahui
- Siswa tahu sesi ditutup/dikunci/di-reset pengawas paling lambat ~30 dtk (dulu ~20 dtk).
  Integritas tidak berubah: `sync` dan `selesai` tetap menolak di server untuk sesi ditutup,
  siswa terkunci, atau perangkat berganti.
- `last_heartbeat` ditulis tiap ~30 dtk (dulu ~20 dtk). Ambang "siswa terputus" di panel
  pengawas (45 dtk, `ModePengawasTab.tsx`) masih di atas jeda itu. JANGAN menaikkan jeda
  `cek-sesi` ke 45 dtk atau lebih tanpa menaikkan ambang itu.
- `last_heartbeat` juga dipakai sebagai bukti "perangkat masih online" di `deadline-pg.ts`
  dan `essay-waktu.ts`. Jaraknya hanya bergeser 20 menjadi 30 dtk, tetapi uji skenario siswa
  offline lalu submit sebelum dipakai di ujian sebenarnya.
- Putus jaringan tetap terdeteksi cepat: event `offline` browser langsung, atau
  `cek-sesi`/`sync` gagal -> `periksaJaringanSekarang()` -> denyut 3 dtk -> OFFLINE sekitar 3-4 dtk.
  Kasus "Wi-Fi tersambung tapi internet mati" kini terdeteksi saat request berikutnya gagal
  (paling lama ~30 dtk, atau saat siswa menjawab), bukan lewat denyut tiap 20 dtk.
- Amplop essay: bila soal essay baru siap di tengah ujian, amplop bisa terambil sampai ~3 menit
  kemudian. Hanya dibutuhkan untuk jalur essay offline setelah PG selesai.

## Yang TIDAK diubah (sengaja)
`sync` jawaban (debounce 2,5 dtk, autosync 30 dtk), PBKDF2 saat masuk ujian, login, dan
ambang panel pengawas.

## Cara memverifikasi setelah deploy
1. Vercel -> Usage: catat Function Invocations dan Active CPU.
2. Uji 30-50 siswa/guru mengerjakan ujian 10 menit. Target: sekitar 3 invocation per siswa
   per menit (dulu 4-6). Kalikan ke 600 untuk perkiraan sesi sebenarnya.
3. Pantau panel pengawas: tidak boleh ada pop-up "siswa terputus" palsu pada siswa yang sehat.
4. Matikan Wi-Fi di satu HP saat ujian: indikator jaringan harus berubah ke OFFLINE dalam beberapa detik.
