# Perbaikan login saat server padat (3 Nov 2026)

Untuk Supabase gratis + Vercel Hobby. Timpa file berikut (path sama persis dengan di dalam zip):

| File | Perubahan |
|---|---|
| `src/lib/login-beban.ts` | **BARU.** Gerbang antrean login, penulisan batch `last_login` + `log_aktivitas`, helper batas waktu. |
| `src/app/api/auth/login/route.ts` | Memakai gerbang antrean, timeout query 10 dtk, penulisan login digabung (setelah respons), jawaban `503 sementara:true` saat sibuk. |
| `src/app/login/page.tsx` | Login otomatis mengulang saat server sibuk + pesan "Mohon bersabar sebentar, server sedang penuh". |
| `vercel.json` | `maxDuration` 30 dtk untuk `/api/auth/login`. |

## Apa yang sebenarnya terjadi di log
Error `Gagal catat log_aktivitas (LOGIN)` / `Gagal update last_login (siswa)` berasal dari route **login**
(bukan `/selesai`; Vercel menempelkan lognya ke request lain di instance yang sama). Penulisan itu
fire-and-forget per login, timeout 30 dtk bersamaan saat database jenuh.

## Perubahan di server (login/route.ts + login-beban.ts)
1. **Gerbang antrean** (default 20 login bersamaan/instance). Selebihnya mengantre dan tetap diproses;
   baru dijawab 503 sementara bila menunggu > 6 dtk atau antrean > 300.
2. **Timeout query login 10 dtk** (sebelumnya 30 dtk) -> gagal cepat, lalu klien mengulang.
3. **Penulisan digabung**: 51 login simulasi = 3 query (sebelumnya 102). `last_login` memakai
   `UPDATE ... WHERE nis IN (...)`, `log_aktivitas` satu INSERT multi-baris, ditulis lewat `after()`.
4. `last_login` dilewati bila terakhir diperbarui < 5 menit lalu.
5. Jatah percobaan login (10x / 5 menit) **dikembalikan** bila penolakan karena server sibuk, jadi
   percobaan ulang otomatis tidak membuat pengguna terkunci.
6. Error timeout/jaringan database -> 503 sementara (bukan 500 final).

## Perubahan di halaman login
- Pengguna klik Masuk -> proses terus berjalan. Setelah 4 detik tampil: **"Mohon bersabar sebentar,
  server sedang penuh..."**; setelah 20 detik pesan antrean masih padat. Tombol menjadi "Menunggu server...".
- Mengulang otomatis (jeda 1,5 dtk bertambah, maks 8 dtk, + acak 0-1 dtk) sampai total 90 dtk.
- TIDAK diulang untuk: password salah, akun dikunci/nonaktif, maintenance, terlalu banyak percobaan.
- Klik ganda diabaikan; panel login desktop tidak menutup sendiri saat proses berjalan.

## Env opsional (Vercel -> Settings -> Environment Variables)
| Env | Default | Fungsi |
|---|---|---|
| `LOGIN_MAKS_BERSAMAAN` | 20 | Login diproses bersamaan per instance |
| `LOGIN_MAKS_TUNGGU_MS` | 6000 | Maks menunggu giliran |
| `LOGIN_MAKS_ANTREAN` | 300 | Panjang antrean per instance |
| `LOGIN_DB_TIMEOUT_MS` | 10000 | Timeout query login |
| `LOGIN_LAST_LOGIN_JEDA_MS` | 300000 | Jeda minimal tulis ulang last_login |
| `LOGIN_BATCH_JEDA_MS` | 400 | Lama mengumpulkan sebelum ditulis |
| `SUPABASE_FETCH_TIMEOUT_MS` | 30000 | Timeout umum Supabase (boleh diturunkan ke 15000) |

## Yang tidak bisa diselesaikan oleh kode
- Supabase gratis = compute kecil bersama. Kode ini mengurangi beban dan merapikan antrean, tetapi
  ratusan login dalam hitungan detik tetap membuat antrean. Atur agar siswa login 5-10 menit sebelum ujian.
- Proyek Supabase gratis di-pause setelah ~7 hari tanpa aktivitas: buka dashboard / lakukan request
  sehari sebelum ujian.
- Vercel Hobby: batas fungsi serentak dan CPU terbatas; bcrypt (bcryptjs) memakan CPU per login.

## Verifikasi
`npx tsc --noEmit` lulus. Simulasi: 12 login serentak dengan batas 3 -> maks 3 berjalan, antrean
tertahan lalu diproses, kelebihan dijawab sibuk; 51 login -> 3 query database.
