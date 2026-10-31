# Patch v3 — hasil audit area yang belum diperiksa

Terapkan: ekstrak di root repo, timpa file yang sama. Tidak tumpang tindih dengan patch kelas v2.
Lalu jalankan `supabase/54_hardening_fungsi_essay_revisi.sql` di SQL Editor (aman diulang).

| File | Perubahan |
|---|---|
| src/lib/sync-essay-input.ts (baru) | Normalisasi payload autosave essay |
| src/app/api/siswa/ujian/essay/jawab/route.ts | Pakai normalizer; body `null` -> 400 |
| src/app/api/siswa/ujian/essay/kirim/route.ts | `req.json()` rusak -> 400, bukan 500 |
| src/app/api/layar-pantau/stream/route.ts | Cek akun/yayasan aktif; saring event Realtime per sesi |
| src/app/api/admin/pengaturan/logo/route.ts | Batas 2 MB, tipe dicek sebelum file dibaca |
| src/app/api/admin/sekolah/logo/route.ts | Batas 2 MB, formData rusak -> 400 |
| supabase/54_hardening_fungsi_essay_revisi.sql | REVOKE anon/authenticated untuk objek pasca-migrasi 23 |
