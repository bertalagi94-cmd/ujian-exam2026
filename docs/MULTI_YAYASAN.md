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

## STATUS: kode Fase 2 selesai, UJI DUA YAYASAN belum
`MULTI_YAYASAN_ENABLED` (default mati) mengunci `/api/public/registrasi` dan membuat token tanpa klaim yayasan ditolak. **Jangan dinyalakan sebelum uji dua yayasan lulus** (lihat bawah). Selama mati, seluruh aplikasi berjalan seperti satu yayasan (`YYS_AWAL`).

### Migrasi (berurutan)
| File | Isi |
|---|---|
| 39 | tabel yayasan, kode registrasi, kolom `yayasan_id` di tabel utama, fungsi registrasi atomik |
| 40 | trigger: `nilai` yang dibuat fungsi DB mendapat `yayasan_id` dari `sesi_ujian` |
| 41 | trigger `paket_soal` (dari mapel); nama kelas unik per yayasan |
| 42 | `get_dashboard_stats(p_yayasan_id)`, `hapus_kelas_atomik(..., p_yayasan_id)`, `pelanggaran.yayasan_id` + trigger |
| 43 | kunci `pengaturan` menjadi `(yayasan_id, key)`. Jalankan SETELAH kode yang memakai `onConflict 'yayasan_id,key'` ter-deploy |

Jalankan migrasi dulu, baru deploy kode. Jangan menjalankan SQL atau deploy saat ada ujian.

### Pola kode
- Semua rute memakai `tenantDb(yayasanIdDari(user))`. Ia menambah `yayasan_id` pada select/update/delete dan mengisinya pada insert/upsert.
- `tenantDb` TIDAK melindungi tabel di luar `TABEL_PER_YAYASAN` (jawaban, siswa_ujian, jawaban_essay*, skor_essay_siswa, essay_amplop_offline, log_reset, guru_sekolah, metrik_sistem), storage, dan `rpc`. Sebelum menyentuhnya dengan id dari klien, lakukan query ber-scope (mis. `sesi_ujian`, `siswa`) yang memberi 404 bila bukan milik yayasan ini.
- Cache in-memory untuk data per yayasan wajib memuat `yayasanId` di kuncinya.
- Berkas di bucket `assets` berfolder yayasan (kecuali `YYS_AWAL`). Ekstensi ditentukan dari tipe MIME, bukan nama file.
- Endpoint publik (`/api/public/*`) menentukan yayasan dari token atau `?kode=` (`yayasanIdPublik`); tanpa keduanya dan saklar menyala, jawabannya kosong.

### Batasan yang disengaja
- `username`, `NIS`, dan `kode_sesi` masih unik di seluruh database. Impor NIS milik yayasan lain dilewati ("NIS sudah terdaftar"). Jangan menghapus penjagaan itu sebelum PK diganti `(yayasan_id, ...)`.
- `admin/backup`, `reset`, `restore` ditolak (403) saat saklar menyala. Backup memakai fitur bawaan Supabase.
- Cron `reminder-soal` hanya memproses `YYS_AWAL` (nomor WA tujuan hanya satu).
- `siswa/dipantau` dan `metrik_sistem` global (peta berdasarkan NIS unik; metrik kesehatan server).
- Stream Layar Pantau mendengarkan perubahan semua yayasan, tetapi hanya sebagai pemicu: data selalu diambil ulang lewat query ber-scope.
- Panel Developer memakai client global (lintas yayasan) dan hanya untuk `DEVELOPER_USERNAMES` pada yayasan awal.

### Yang tersisa
1. **Uji dua yayasan** (wajib): daftarkan yayasan B, buat kelas bernama sama, lalu dari akun B coba baca/ubah/hapus id milik A (sesi, nis, paket, kelas, jadwal, username). Semua harus 404/403. Hapus kelas di B, pastikan data kelas sama di A utuh. Impor NIS milik A dari B. Simulasi ujian penuh di B. `backup/reset/restore` = 403. Token lama ditolak.
2. Setelah uji lulus: hapus `DEFAULT 'YYS_AWAL'` dan `SET NOT NULL` pada `yayasan_id` di semua tabel (cek dulu `grep -an "INSERT INTO" supabase/*.sql`; saat ini nilai, paket_soal, pelanggaran ditangani trigger).
3. Nyalakan `MULTI_YAYASAN_ENABLED=true`.
