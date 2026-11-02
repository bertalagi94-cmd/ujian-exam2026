# Paket perbaikan (diuji terhadap commit 4887b7a)

Struktur folder sama dengan repo. Cara pakai:

1. Jalankan `supabase/56_perbaikan_audit.sql` di Supabase SQL Editor DULU.
2. Timpa 5 file ini ke repo:
   - src/app/api/auth/login/route.ts
   - src/app/api/siswa/ujian/selesai/route.ts
   - src/app/api/siswa/ujian/sync/route.ts
   - src/lib/aktivitas.ts
   - src/lib/auth.ts
   (Alternatif: `git apply perbaikan.patch` dari root repo.)
3. Deploy. Uji dengan satu akun guru (wajib ganti password aktif) dan satu simulasi ujian.

Yang sudah diuji: `tsc --noEmit` lolos, `next build` lolos, dan migrasi 56 dijalankan
di PostgreSQL 16 dengan skema minimal (10 skenario, termasuk idempoten & hak akses).
Yang BELUM diuji: perilaku di Supabase/Vercel produksi dan alur dari browser siswa.
