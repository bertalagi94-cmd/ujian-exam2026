# Monitor Vercel di Panel Developer (7 Nov 2026)

Tujuan: dari akun developer, Bapak bisa melihat dengan bahasa mudah apakah aplikasi
masih **AMAN**, mulai **WASPADA**, atau **BAHAYA** (hampir terkunci karena kuota
Vercel penuh). Sebelumnya hanya Supabase/server yang dipantau.

Tidak perlu migrasi SQL. Logika ujian, penilaian, dan anti-curang tidak diubah.

## Yang tampil di Panel Developer → tab "Monitor Server"

1. **Ringkasan aplikasi** (paling atas): gabungan 3 hal, masing-masing dengan kalimat
   sederhana dan penanda hijau/kuning/merah:
   Hosting Vercel, Server & database Supabase, Penyimpanan Supabase.
2. **Kesehatan Vercel**: meter pemakaian CPU server, memori, jumlah panggilan ke server,
   dan transfer data, lengkap dengan persen terpakai, sisa jatah, dan "sisa jatah cukup
   untuk berapa hari lagi sepadat hari tersibuk". Juga status versi (deploy) terakhir
   dan lokasi server (harus Singapura / sin1).
3. Bagian lama (status server, penyimpanan Supabase, per endpoint, riwayat) tetap ada di bawahnya.

## File

| File | Isi |
|---|---|
| `src/lib/status-vercel.ts` | Logika murni: baca data tagihan, hitung persen dan hari tersibuk, tentukan AMAN/WASPADA/BAHAYA |
| `src/app/api/developer/vercel/route.ts` | API khusus developer. Memanggil API Vercel dari server, cache 90 detik |
| `src/app/developer/KesehatanVercel.tsx` | Tampilan "Ringkasan aplikasi" dan "Kesehatan Vercel" |
| `src/app/developer/page.tsx` | Menyambungkan keduanya ke tab Monitor Server |

## Cara memasang (wajib, sekali saja)

Tanpa langkah ini kartu hanya menampilkan petunjuk "Belum terhubung ke Vercel".

1. vercel.com → foto profil → **Account Settings → Tokens → Create Token**.
   Pilih akun/tim yang memiliki project ujian. Salin token (hanya tampil sekali).
2. Vercel → Project → **Settings → Environment Variables**, tambahkan:

| Variabel | Isi |
|---|---|
| `VERCEL_API_TOKEN` | token dari langkah 1 (rahasia, hanya dibaca server, tidak pernah dikirim ke browser) |
| `VERCEL_TEAM_ID` | hanya jika project ada di dalam Team: id berawalan `team_` (Team Settings → General). Akun pribadi: kosongkan |
| `VERCEL_PROJECT_ID` | otomatis terisi bila **"Automatically expose System Environment Variables"** aktif di halaman yang sama. Kalau tidak, isi manual (Project Settings → General → Project ID) |
| `VERCEL_PAKET` | (opsional) `hobby` (bawaan) atau `pro`. Hanya mengubah kalimat akibat bila jatah habis |

3. **Redeploy**, lalu buka Panel Developer → Monitor Server.

### Batas (kuota) paket

Batas tidak bisa dibaca dari API Vercel, jadi dipakai angka bawaan paket **Hobby**
(menurut dokumentasi Vercel per September 2026). Kalau paket Bapak berbeda, isi env berikut:

| Variabel | Bawaan (Hobby) |
|---|---|
| `VERCEL_KUOTA_CPU_JAM` | 4 (jam Active CPU) |
| `VERCEL_KUOTA_MEMORI_GBJAM` | 360 (GB-jam Provisioned Memory) |
| `VERCEL_KUOTA_INVOCATION` | 1000000 (panggilan fungsi) |
| `VERCEL_KUOTA_TRANSFER_GB` | 100 (Fast Data Transfer) |
| `VERCEL_KUOTA_ORIGIN_GB` | 10 (Fast Origin Transfer) |
| `VERCEL_PERIODE_MULAI` | (opsional) `YYYY-MM-DD` awal siklus tagihan. Kosong = 30 hari terakhir |
| `VERCEL_REGION_DIHARAPKAN` | `sin1` |

Pada paket Hobby, jika batas terlampaui Vercel menghentikan fitur/aplikasi sementara
(sekitar 30 hari). Itulah yang dimaksud "terkunci" pada kartu ini.

## Cara membaca status

Setiap meter dinilai dengan DUA ukuran; yang lebih buruk yang dipakai:

1. **Persen jatah terpakai** dalam periode.
2. **Sisa jatah cukup untuk berapa hari lagi sepadat hari tersibuk.** Hari tersibuk =
   pemakaian harian tertinggi dalam periode (biasanya hari ujian terpadat).

Ukuran kedua dipilih karena ujian datang bergelombang: satu hari ujian padat tidak
dianggap terjadi setiap hari, tetapi tetap ketahuan kalau sisa jatah tidak cukup untuk
hari padat berikutnya.

| Status | Arti | Kapan muncul |
|---|---|---|
| AMAN (hijau) | Semua jatah longgar | Semua meter di bawah 70% dan sisa jatah cukup untuk 3 hari tersibuk atau lebih |
| WASPADA (kuning) | Masih jalan, perlu dipantau | Satu meter 70-89%, atau sisa jatah cukup kurang dari 3 hari tersibuk, atau deploy terakhir gagal |
| BAHAYA (merah) | Hampir terkunci | Satu meter 90% atau lebih, atau satu hari sepadat hari tersibuk lagi sudah bisa menghabiskan sisa jatah |

Contoh: jatah CPU 4 jam, hari ujian terpadat memakai 1,2 jam. Setelah hari itu, terpakai
30% (hijau menurut persen) tetapi sisa 2,8 jam hanya cukup untuk 2 hari seberat itu, jadi
statusnya WASPADA. Ini peringatan dini sebelum ujian berikutnya, bukan alarm palsu.

Catatan: deploy yang gagal **tidak** menghentikan aplikasi; aplikasi tetap memakai versi
sebelumnya (karena itu hanya WASPADA).

## Batasan yang perlu diketahui

- Data pemakaian berasal dari API tagihan Vercel dengan ketelitian **per hari** dan bisa
  tertunda beberapa jam. Cocok untuk melihat tren dan sisa jatah, **bukan** grafik CPU per menit.
- CPU/memori **per menit (real-time)** hanya tersedia di Vercel lewat fitur *Observability Plus*
  (paket Pro/Enterprise), jadi tidak dipakai di sini.
- Kartu menyediakan **"Rincian mentah dari Vercel"** agar angka bisa dicocokkan dengan
  Vercel → Usage. Bila ada meter yang bertuliskan "Belum ada data", biasanya belum ada
  pemakaian pada layanan itu atau nama layanannya berbeda; cek rincian mentah.
- "Hari tersibuk" dihitung dari periode yang dibaca (30 hari terakhir, atau sejak
  `VERCEL_PERIODE_MULAI`). Satu hari ujian yang padat akan tetap menjadi acuan selama masih
  berada di dalam periode itu.
- Nama layanan pada data tagihan dicocokkan dengan pola: *Active CPU*, *Provisioned Memory*,
  *Function Invocations*, *Fast Data Transfer*, *Fast Origin Transfer*. Pola ini disusun dari
  dokumentasi Vercel dan belum diuji dengan data akun sungguhan. Bila ada meter yang
  "Belum ada data" padahal Vercel → Usage menunjukkan pemakaian, buka "Rincian mentah"
  dan cocokkan namanya.

## Keamanan

- Token hanya dibaca di server (`process.env`), tidak pernah dikirim ke browser maupun dimasukkan ke pesan galat.
- Rute hanya bisa diakses token developer (`requireDeveloper`), sama seperti rute developer lain.
- Hanya angka agregat sistem. Tidak ada data siswa, jawaban, atau nilai (dinding keamanan Panel Developer tetap).
- Saran: buat token khusus untuk monitor ini dengan masa berlaku terbatas, dan cabut di
  Account Settings → Tokens bila tidak dipakai lagi.

## Pembaruan (7 Nov 2026): tampilan mengikuti halaman Usage Vercel

- Meter ditambah: **Deployment Storage**, **CDN Requests** (dulu "Edge Requests", diganti nama
  Vercel pada 30 Sep 2026), dan **Functions Storage**. Urutannya sama dengan Vercel → Usage.
- Angka ditampilkan seperti di Vercel: `17m 27s / 4h`, `490,93 MB / 10 GB`, `39K / 1M`.
- Baris "Sandbox Active CPU" dan "CDN Request CPU Duration" tidak lagi ikut terhitung ke meter CPU/CDN.
- Env batas baru (opsional, bawaan = batas Hobby): `VERCEL_KUOTA_CDN_REQUESTS` (1000000),
  `VERCEL_KUOTA_DEPLOY_STORAGE_GB` (10), `VERCEL_KUOTA_FUNC_STORAGE_GB` (10).
- Bila Vercel menjawab sukses tetapi tanpa baris pemakaian (jumlahBaris = 0), kartu menampilkan
  penjelasan, bukan lagi status "AMAN" palsu.
