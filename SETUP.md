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
file bernomor terbesar (saat ini `18_catat_tabel_sekolah_dan_kisi_kisi.sql`
— cek folder `supabase/` untuk nomor terbaru kalau ada tambahan setelah
checklist ini dibuat).

Catatan:
- `01_schema.sql` sampai `01b_seed_master_part1.sql` s/d `04_seed_jawaban.sql`
  berisi skema dasar + data awal (termasuk 1 akun admin default — lihat
  langkah 6 di bawah).
- File `11_akses_mulai_essay.sql` dan `11_mode_jawaban_pg.sql` sama-sama
  bernomor 11 tapi saling independen (beda tabel) — urutan di antara
  keduanya tidak masalah.
- Semua file migrasi ditulis idempotent (`IF NOT EXISTS`, `CREATE OR
  REPLACE`), aman dijalankan ulang kalau ragu sudah jalan atau belum.

**Verifikasi setelah selesai** — jalankan query ini, pastikan jumlah tabel
sesuai ekspektasi (saat ini seharusnya 24 tabel):
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
| `CRON_SECRET` | nilai bebas Anda sendiri, untuk otentikasi cron job internal |
| `FONNTE_TOKEN` | token akun Fonnte Anda (notifikasi WhatsApp) |
| `ADMIN_WA_NUMBER` | nomor WhatsApp admin tujuan notifikasi |

Redeploy project setelah env var diisi.

---

## 5. Verifikasi RLS (keamanan)

Jalankan di SQL Editor, pastikan `rls_aktif = true` untuk ketiganya dan
baris ke-2 kosong (tidak ada policy longgar):
```sql
select relname as tabel, relrowsecurity as rls_aktif
from pg_class
where relname in ('jawaban', 'siswa_ujian', 'pelanggaran');

select tablename, policyname, roles, cmd
from pg_policies
where tablename in ('jawaban', 'siswa_ujian', 'pelanggaran');
```

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
