# SETUP.md — Checklist Bangun Ulang Aplikasi dari 0

Panduan ini untuk skenario: pindah ke akun/project Supabase baru, atau
membangun ulang seluruh infrastruktur (Supabase + Vercel) dari nol.
Ikuti berurutan dari atas ke bawah.

---

## 1. Buat project Supabase baru

Buat project baru di [supabase.com](https://supabase.com), catat 3 nilai
berikut dari **Project Settings → API** (dibutuhkan di langkah 4):
- Project URL
- `anon` `public` key
- `service_role` key (⚠️ rahasia, jangan pernah expose ke client)

---

## 2. Jalankan semua file migrasi SQL, berurutan

Buka **SQL Editor** di Supabase Dashboard, jalankan seluruh isi folder
`supabase/` **sesuai urutan nomor filenya**, dari `01_schema.sql` sampai
file bernomor terbesar (saat ini `24_reset_berurutan.sql` — cek folder
`supabase/` untuk nomor terbaru kalau ada tambahan setelah checklist ini
dibuat).

⚠️ **Migrasi 23 (hardening keamanan) WAJIB dan harus dijalankan TERAKHIR.**
Ia mengaktifkan RLS di semua tabel dan mencabut semua hak `anon`/
`authenticated`; ia sengaja **menolak berjalan** kalau migrasi 20/21/22
belum terpasang. Kode aplikasi tidak punya jalur fallback — tanpa migrasi
20/21/22 sinkron jawaban dan finalisasi ujian akan mengembalikan error.

Catatan:
- `01_schema.sql` sampai `01b_seed_master_part1.sql` s/d `04_seed_jawaban.sql`
  berisi skema dasar + data awal (termasuk 1 akun admin default — lihat
  langkah 6 di bawah).
- File `11_akses_mulai_essay.sql` dan `11_mode_jawaban_pg.sql` sama-sama
  bernomor 11 tapi saling independen (beda tabel) — urutan di antara
  keduanya tidak masalah.
- Jalankan migrasi baru di database dulu, **baru** deploy kodenya.
- `24_reset_berurutan.sql` (sistem reset pelanggaran R1/R2/R3) dijalankan
  **setelah** 23. Aman: ia hanya menambah kolom + 3 fungsi dan mencabut hak
  `anon`/`authenticated` untuk fungsi-fungsinya sendiri. Kode aplikasi tidak
  punya jalur fallback (fail-closed) — tanpa migrasi ini pelanggaran tidak
  tercatat (503), kode reset tidak bisa diverifikasi (503), dan daftar siswa
  di Mode Pengawas gagal dimuat.
- Semua file migrasi ditulis idempotent (`IF NOT EXISTS`, `CREATE OR
  REPLACE`), aman dijalankan ulang kalau ragu sudah jalan atau belum.

**Verifikasi setelah selesai** — jalankan query ini, pastikan jumlah tabel
sesuai ekspektasi (jumlah bisa berubah seiring migrasi baru; bandingkan
dengan project lama Anda):
```sql
select count(*) from information_schema.tables where table_schema = 'public';
```

---

## 3. Buat Storage bucket

Buka **Storage** di Supabase Dashboard, buat bucket baru:
- Nama: **`assets`** (harus persis ini, hardcoded di banyak endpoint)
- Akses: **Public** (dipakai untuk logo sekolah, gambar soal, foto jawaban
  essay yang diakses langsung lewat URL publik — cek
  `getPublicUrl()` di kode kalau ingin verifikasi)

Tidak perlu bikin folder manual di dalamnya — aplikasi akan membuat folder
(`logo/`, `soal/`, `jawaban-essay/`, dst.) otomatis saat upload pertama.

---

## 4. Set environment variables di Vercel

Buka **Vercel → Project Settings → Environment Variables**, isi 7 variabel
berikut:

| Variabel | Sumber |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | dari langkah 1 |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | dari langkah 1 |
| `SUPABASE_SERVICE_ROLE_KEY` | dari langkah 1 (rahasia) |
| `JWT_SECRET` | nilai bebas Anda sendiri, string acak yang panjang & rahasia |
| `RESET_PELANGGARAN_SECRET` | (disarankan) string acak ≥ 16 karakter, khusus untuk menurunkan kode reset R1/R2/R3. Kalau tidak diisi, dipakai `ESSAY_DARURAT_SECRET` lalu `JWT_SECRET`. ⚠️ Jangan diganti saat ada ujian berlangsung — kode yang sudah dilihat pengawas jadi tidak cocok lagi. |
| `CRON_SECRET` | nilai bebas Anda sendiri, untuk otentikasi cron job internal |
| `FONNTE_TOKEN` | token akun Fonnte Anda (notifikasi WhatsApp) |
| `ADMIN_WA_NUMBER` | nomor WhatsApp admin tujuan notifikasi |

Redeploy project setelah env var diisi.

---

## 5. Verifikasi keamanan (RLS + hak akses)

Jalankan di SQL Editor. **Kedua query harus mengembalikan 0 baris.**
```sql
-- fungsi yang bisa dijalankan anon/authenticated (harus kosong)
select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and (has_function_privilege('anon', p.oid, 'execute')
    or has_function_privilege('authenticated', p.oid, 'execute'));

-- tabel tanpa RLS atau masih terbuka untuk anon/authenticated (harus kosong)
select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r'
  and (not c.relrowsecurity
    or has_table_privilege('anon', c.oid, 'select,insert,update,delete,truncate')
    or has_table_privilege('authenticated', c.oid, 'select,insert,update,delete,truncate'));
```

Lalu uji dari luar dengan anon key (contoh perintah `curl` ada di bagian
bawah `supabase/23_hardening_keamanan_db.sql`); semuanya harus ditolak.

---

## 6. Login pertama kali

Seed data sudah membuat 1 akun admin default (lihat
`01b_seed_master_part1.sql`, username `admin`). **Anda perlu tahu/simpan
sendiri password plaintext-nya di luar repo ini** — yang tersimpan di file
SQL cuma hash bcrypt-nya, tidak bisa dibalik ke plaintext. Kalau lupa,
password bisa direset langsung lewat SQL Editor dengan meng-hash ulang
password baru dan meng-update kolom `password_hash` di tabel `users` untuk
baris `username = 'admin'`.

Setelah berhasil login sebagai admin:
- Isi **Pengaturan → Nama Sekolah** (kosong secara default)
- Kalau pakai fitur multi-jenjang: buat data di menu **Sekolah/Jenjang**,
  lalu assign `sekolah_id` ke akun Kepsek & kelas terkait

---

## 7. Uji fungsional singkat

Sebelum dipakai sungguhan, ulangi simulasi kecil yang sudah pernah
dilakukan: buat 1 paket soal → siswa ujian → guru nilai essay, untuk
memastikan seluruh alur (termasuk fungsi RPC di migrasi 16 & 17) benar-benar
berjalan di project baru.

---

*Checklist ini dibuat dari hasil audit kode vs skema database pada
September 2026. Kalau ada perubahan skema/env var baru setelah tanggal ini,
tambahkan ke file ini juga — jangan biarkan cuma hidup di riwayat chat.*
