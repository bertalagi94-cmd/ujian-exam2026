# Multi-Yayasan: satu database, banyak sekolah

## Istilah
- **Yayasan** = pemilik data (tenant). Punya **Kode Sekolah** (mis. `AGRABIL`) untuk login.
- **Sekolah** (tabel lama) = **jenjang** di dalam yayasan (SMP, SMA, dst).
- **Kode Registrasi** = kode sekali pakai (berlaku 14 hari) dari developer ke sekolah baru. Database hanya menyimpan hash-nya.

## Alur
1. Developer buka `/developer` → **Daftarkan** (Kode Sekolah + nama) → **Buat kode**.
2. Developer kirim Kode Registrasi + tautan `/registrasi` ke sekolah.
3. Sekolah mengisi admin + jenjang di `/registrasi` → yayasan menjadi AKTIF.
4. Semua pengguna sekolah itu login dengan Kode Sekolah + username/NIS + password.

## Setup (sekali)
1. Jalankan `supabase/39_multi_yayasan.sql` di SQL Editor (setelah migrasi 23). Semua data lama otomatis jadi yayasan `YYS_AWAL` (kode `UTAMA`; boleh diganti lewat SQL: `update yayasan set kode='AGRABIL' where id='YYS_AWAL'`).
2. Env Vercel: `DEVELOPER_USERNAMES=admin` (username admin yayasan awal yang jadi developer, pisahkan koma). Kosong = tidak ada yang bisa masuk `/developer`.
3. Deploy, lalu **login ulang** (token lama belum memuat yayasan; tetap diterima selama saklar mati).

## STATUS: Fase 1 selesai, Fase 2 belum
`MULTI_YAYASAN_ENABLED` (default mati) mengunci `/api/public/registrasi`. **Jangan diaktifkan dulu.** Alasannya: 123 route API lama masih memakai `createAdminClient()` polos, jadi yayasan baru akan melihat data yayasan lain.

### Fase 2 (wajib sebelum saklar dinyalakan)
1. Ganti tiap route ke `tenantDb(yayasanIdDari(user))` dari `src/lib/tenant.ts` (otomatis menambah `yayasan_id` pada select/update/delete/insert). Kerjakan per folder: siswa → kelas/mapel → jadwal → sesi/ujian → nilai → soal/paket → pengaturan.
2. RPC (19 fungsi) tidak otomatis ter-scope: pastikan id yang dikirim berasal dari query ber-scope.
3. Tabel tanpa `yayasan_id` (jawaban, siswa_ujian, pelanggaran, jawaban_essay*, log_reset, essay_amplop_offline, metrik_sistem): tambah kolom atau pastikan selalu diakses lewat `sesi_id` ber-scope.
4. Ganti PK global: `siswa(nis)`, `users(username)`, `pengaturan(key)` → per yayasan (index unik `(yayasan_id, ...)` sudah disiapkan). Lalu hapus `DEFAULT 'YYS_AWAL'` dan `SET NOT NULL` pada `yayasan_id`. Ini juga memperbaiki `kepsek-scope.ts` yang masih mengenali kelas lewat nama.
5. Pengaturan (nama sekolah, logo, dll.) dan cache `pengaturan:all` harus per yayasan; endpoint publik/login perlu tahu yayasan dari Kode Sekolah.
6. Backup/restore/reset admin (`/api/admin/backup|restore|reset`) saat ini menyapu SEMUA tabel: harus dibatasi per yayasan atau hanya developer.
7. Uji dengan 2 yayasan: pastikan akun yayasan B tidak bisa membaca/mengubah data A di setiap endpoint, baru nyalakan `MULTI_YAYASAN_ENABLED=true`.
