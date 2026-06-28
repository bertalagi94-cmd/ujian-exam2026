# SmartExam CBT — MTS Alkhairaat Tatakalai

Sistem ujian CBT (Computer Based Test) modern berbasis **Next.js 14 + Supabase + Vercel**.

---

## 🗂️ Struktur Project

```
smartexam/
├── src/
│   ├── app/
│   │   ├── login/page.tsx          ← Halaman login (semua role)
│   │   ├── admin/                  ← Dashboard Admin
│   │   │   ├── page.tsx            ← Dashboard
│   │   │   ├── siswa/page.tsx      ← Manajemen Siswa
│   │   │   ├── users/page.tsx      ← Manajemen Guru/Staff
│   │   │   ├── kelas/page.tsx      ← Manajemen Kelas
│   │   │   ├── mapel/page.tsx      ← Manajemen Mapel
│   │   │   ├── jadwal/page.tsx     ← Jadwal Ujian
│   │   │   ├── soal/page.tsx       ← Validasi Soal
│   │   │   ├── nilai/page.tsx      ← Rekap Nilai
│   │   │   └── pengaturan/page.tsx ← Pengaturan Sistem
│   │   ├── guru/                   ← Dashboard Guru
│   │   │   ├── page.tsx            ← Dashboard
│   │   │   ├── soal/page.tsx       ← Bank Soal (CRUD)
│   │   │   ├── paket/page.tsx      ← Paket Soal
│   │   │   └── nilai/page.tsx      ← Rekap Nilai Mapel
│   │   ├── siswa/                  ← Dashboard Siswa
│   │   │   ├── page.tsx            ← Beranda
│   │   │   ├── ujian/page.tsx      ← Halaman Ujian (real-time)
│   │   │   ├── nilai/page.tsx      ← Riwayat Nilai
│   │   │   └── jadwal/page.tsx     ← Jadwal Ujian
│   │   ├── pengawas/               ← Dashboard Pengawas
│   │   │   └── page.tsx            ← Buka/tutup sesi
│   │   ├── kepsek/                 ← Dashboard Kepala Sekolah
│   │   │   └── page.tsx            ← Overview akademik
│   │   └── api/                    ← Semua backend API routes
│   ├── components/
│   │   ├── ui/index.tsx            ← Komponen UI reusable
│   │   └── shared/Sidebar.tsx      ← Sidebar per role
│   ├── lib/
│   │   ├── supabase.ts             ← Supabase client
│   │   ├── auth.ts                 ← JWT utilities
│   │   └── utils.ts                ← Helper functions
│   ├── types/index.ts              ← TypeScript types
│   └── styles/globals.css          ← Global CSS + Tailwind
├── supabase/
│   ├── 01_schema.sql               ← DDL: buat semua tabel
│   ├── 01b_seed_master_part1.sql   ← Seed: pengaturan, users, kelas, mapel
│   ├── 02_seed_master.sql          ← Seed: siswa, jadwal, paket, soal
│   ├── 03_seed_transaksi.sql       ← Seed: nilai, siswa_ujian, log
│   └── 04_seed_jawaban.sql         ← Seed: 33.196 jawaban (import terpisah)
├── scripts/
│   └── import-data.js              ← Script import otomatis dari Excel
├── .env.local.example              ← Template environment variables
└── .gitignore
```

---

## 🚀 Panduan Deploy Lengkap (Step by Step)

### LANGKAH 1 — Persiapan Akun

1. **GitHub**: Buat repo baru bernama `smartexam` (Private)
2. **Supabase**: Daftar di [supabase.com](https://supabase.com) → New Project
   - Pilih region terdekat (Singapore)
   - Catat: Project URL, anon key, service_role key
3. **Vercel**: Daftar di [vercel.com](https://vercel.com) → Connect GitHub

---

### LANGKAH 2 — Setup Database Supabase

Buka **Supabase Dashboard → SQL Editor** dan jalankan file SQL ini **secara berurutan**:

```
1. supabase/01_schema.sql          ← Buat semua tabel
2. supabase/01b_seed_master_part1.sql
3. supabase/02_seed_master.sql
4. supabase/03_seed_transaksi.sql
5. supabase/04_seed_jawaban.sql    ← Opsional, atau pakai script import
```

> ⚠️ File 04 berisi 33.000+ record. Jika timeout di SQL Editor, gunakan script import di bawah.

---

### LANGKAH 3 — Import Data dengan Script (Rekomendasi)

Script ini lebih cepat dan reliable untuk data besar:

```bash
# Install dependencies
npm install xlsx bcryptjs @supabase/supabase-js

# Set environment variables
export SUPABASE_URL="https://xxxxx.supabase.co"
export SUPABASE_SERVICE_ROLE_KEY="eyJhbGc..."
export EXCEL_PATH="/path/to/aplikasi_baru__2_.xlsx"

# Jalankan import
node scripts/import-data.js
```

Script ini akan mengimport:
- ✅ 14 pengaturan sistem
- ✅ 31 users (guru, admin, pengawas)
- ✅ 7 kelas
- ✅ 41 mata pelajaran
- ✅ 78 relasi kelas-mapel
- ✅ 122 siswa (dengan password di-hash)
- ✅ 36 jadwal ujian
- ✅ 70 paket soal
- ✅ 1.824 soal
- ✅ 944 nilai
- ✅ 783 siswa ujian
- ✅ 33.196 jawaban
- ✅ 504 log aktivitas

---

### LANGKAH 4 — Setup Project Lokal

```bash
# Clone atau copy project ini
git clone https://github.com/USERNAME/smartexam.git
cd smartexam

# Install dependencies
npm install

# Copy dan isi environment variables
cp .env.local.example .env.local
```

Edit `.env.local`:
```env
NEXT_PUBLIC_SUPABASE_URL=https://XXXXX.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGc...
SUPABASE_SERVICE_ROLE_KEY=eyJhbGc...
JWT_SECRET=buat_random_string_32_karakter_minimal
```

Cara generate JWT_SECRET:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

```bash
# Jalankan development server
npm run dev
# Buka http://localhost:3000
```

---

### LANGKAH 5 — Push ke GitHub

```bash
git add .
git commit -m "feat: SmartExam CBT v2.0 - Next.js + Supabase"
git push origin main
```

> ⚠️ Pastikan `.env.local` ada di `.gitignore` dan TIDAK ikut ter-push!

---

### LANGKAH 6 — Deploy ke Vercel

1. Buka [vercel.com](https://vercel.com) → **New Project**
2. Import repo `smartexam` dari GitHub
3. Di bagian **Environment Variables**, tambahkan semua variabel dari `.env.local`:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `JWT_SECRET`
4. Klik **Deploy**
5. Tunggu ~2-3 menit → aplikasi live!

---

### LANGKAH 7 — Setup Domain (Opsional)

Di Vercel Dashboard → Project → Settings → Domains:
- Tambahkan domain kustom, misalnya: `cbtedu.mtsalkhairaat.sch.id`
- Ikuti instruksi DNS yang diberikan Vercel

---

## 🔐 Akun Default Setelah Import

| Role | Username | Password Default |
|------|----------|-----------------|
| Admin | (dari Excel) | (password asli dari Excel) |
| Guru | (dari Excel) | (password asli dari Excel) |
| Pengawas | (dari Excel) | (password asli dari Excel) |
| Siswa | NIS siswa | Password dari Excel |

> 💡 Jika password lupa, admin bisa reset via halaman Manajemen Siswa/Users.

---

## 🎨 Fitur Utama

### Admin
- Dashboard statistik real-time
- CRUD Siswa, Guru, Kelas, Mapel, Jadwal
- Validasi paket soal (Setujui/Tolak)
- Rekap nilai dengan filter dan export CSV
- Pengaturan sistem

### Guru
- Dashboard dengan statistik soal
- Bank soal (CRUD, filter, cari)
- Manajemen paket soal (Buat, Kirim, Tarik)
- Rekap nilai mapel yang diajar

### Pengawas
- Lihat jadwal ujian hari ini
- Buka sesi ujian (generate kode 6 digit otomatis)
- Tutup sesi ujian
- Monitor peserta real-time

### Siswa
- Dashboard dengan nilai terbaru dan jadwal
- Masuk ujian dengan kode sesi
- Interface ujian dengan timer countdown
- Auto-save jawaban setiap 30 detik
- Anti-nyontek (deteksi pindah tab)
- Hasil nilai langsung setelah submit

### Kepala Sekolah
- Overview akademik (rata-rata per kelas dan mapel)
- Rekap nilai keseluruhan

---

## 🛠️ Teknologi

| Teknologi | Kegunaan |
|-----------|----------|
| Next.js 14 | Full-stack React framework |
| TypeScript | Type safety |
| Tailwind CSS | Styling dengan design system custom |
| Supabase | Database PostgreSQL + Auth + Storage |
| bcryptjs | Hashing password |
| JSON Web Token | Autentikasi sesi |
| Vercel | Hosting dan deployment |

---

## 📞 Bantuan

Jika ada masalah saat setup atau deployment, periksa:
1. Semua environment variables sudah diisi dengan benar
2. Schema SQL sudah dijalankan di Supabase
3. Data sudah berhasil diimport (cek tabel di Supabase)
4. Tidak ada error di Vercel deployment logs

---

*SmartExam CBT v2.0 — MTS Alkhairaat Tatakalai*
