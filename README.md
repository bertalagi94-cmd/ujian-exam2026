# ujian-exam2026

Aplikasi ujian sekolah (PG + Essay) dengan mode offline dan anti-cheat.
Next.js 14 (App Router) + Supabase (Postgres) + Vercel, dibungkus Capacitor
untuk Android. Peran: `admin`, `kepsek`, `guru` (termasuk mode pengawas),
`siswa`.

> **BACA INI DULU JIKA ANDA ADALAH AI CODING AGENT.**
> Repo ini sudah melewati beberapa putaran perbaikan keamanan dan
> konkurensi. Banyak kode yang tampak "berlebihan" sebenarnya adalah
> perbaikan bug nyata. Baca bagian **DO NOT REVERT / OVERWRITE** di bawah
> sebelum mengubah apa pun. **Jangan pernah menimpa file dengan versi lama
> dari zip/patch/riwayat chat.** Semua perubahan harus berupa edit terhadap
> file yang ada di repo sekarang.

Dokumen lain: `SETUP.md` (bangun ulang dari nol), `supabase/*.sql` (migrasi).

---

## CURRENT ARCHITECTURE

- **Semua akses database dari server memakai `service_role`**
  (`createAdminClient` di `src/lib/supabase.ts`). Autentikasi memakai JWT
  buatan sendiri (`jsonwebtoken`, `src/lib/auth.ts`, login di
  `src/app/api/auth/login`), **bukan** Supabase Auth.
- **Client `anon`/`authenticated` tidak dipakai untuk apa pun.** Sejak migrasi
  23, role itu tidak punya hak apa pun di schema `public` dan RLS aktif di
  semua tabel. `NEXT_PUBLIC_SUPABASE_ANON_KEY` tetap dibutuhkan hanya karena
  `src/lib/supabase.ts` membacanya. Hook `src/hooks/useMonitorRealtime.ts`
  tidak diimpor di mana pun dan tidak akan berfungsi (tanpa hak anon).
- **Server = sumber kebenaran akhir.** Client menyimpan data lokal (IndexedDB)
  hanya sebagai antrean dan untuk pemulihan.
- Logika penting yang dipakai bersama client dan server ada di `src/lib/`
  (`*-shared.ts`), mis. `pelanggaran-shared.ts`, `essay-amplop-shared.ts`.

## DATABASE MIGRATIONS

Jalankan **berurutan** di Supabase SQL Editor. Semua idempotent.

| File | Isi |
|---|---|
| `01`–`04` | Skema dasar + seed |
| `05_fix_rls.sql` | RLS awal (hanya untuk tabel yang ada saat itu) |
| `07`–`09`, `11`–`13` | Essay, paket essay, bobot, skor per soal, idempotency |
| `10`, `22` | `truncate_tabel_besar` (untuk restore/reset) |
| `14`, `15` | Snapshot paket, transaksi atomik, metrik |
| `16`, `17` | RPC approval paket, dashboard stats, increment peserta |
| `19` | Amplop essay offline |
| `20` | PG offline: kolom `revisi`, `sync_jawaban_revisi()`, `pg_selesai_offline` |
| `21` | `finalisasi_pg_atomik()` — nilai + status siswa dalam satu transaksi |
| `22` | Perbaikan backup/restore/reset, `sinkron_sequence_setelah_restore()` |
| **`23`** | **Hardening: RLS di semua tabel, cabut hak anon/authenticated, default privileges. WAJIB.** |

Aturan migrasi:

1. **Migrasi 23 menolak berjalan** kalau 20/21/22 belum terpasang. Itu
   disengaja: kode aplikasi **fail closed** dan tidak punya jalur fallback.
2. **Setiap tabel/fungsi baru wajib** menyertakan `ENABLE ROW LEVEL SECURITY`
   dan `REVOKE ... FROM PUBLIC, anon, authenticated` (contoh benar: migrasi
   19 dan 21). Di Supabase, `REVOKE ... FROM PUBLIC` saja **tidak cukup**.
3. Fungsi `SECURITY DEFINER` wajib `SET search_path = public` dan hanya
   di-`GRANT` ke `service_role`.

## EXAM FLOW

1. Siswa login → memasukkan Kode Ujian → server memvalidasi.
2. Client mengunduh paket PG (+ Essay), meng-cache soal dan gambar
   (`src/lib/pg-paket-offline.ts`, `gambar-offline.ts`) dan memverifikasinya.
3. Ujian baru **boleh dimulai setelah pre-cache selesai dan tervalidasi**.
   Jika internet mati sebelum tahap ini selesai, ujian tidak dimulai.
4. Setelah "siap", internet boleh terputus; ujian tetap berjalan.
5. PG: jawaban → outbox → `/api/siswa/ujian/sync` → `sync_jawaban_revisi()`.
6. Selesai: `/api/siswa/ujian/selesai` → `finalisasi_pg_atomik()`.
7. Jika ada Essay: fase essay (DIGITAL atau KERTAS), lalu kirim.

## OFFLINE ARCHITECTURE

**Sudah ada:**

- Status jaringan memakai pengecekan nyata ke server
  (`src/lib/status-jaringan.ts`), bukan hanya `navigator.onLine`.
- Outbox jawaban di IndexedDB (`src/lib/ujian-outbox.ts`), dengan migrasi dari
  localStorage lama. Outbox hidup di luar komponen halaman.
- Paket PG dan gambar di-cache sebelum ujian mulai.
- Jawaban PG memakai `revisi` naik-monoton yang dibuat client; server menolak
  revisi yang lebih kecil dari yang tersimpan.
- Klaim "PG selesai offline" disimpan sebagai jejak audit
  (`src/lib/klaim-offline.ts`, kolom `pg_selesai_offline`).

**Celah yang diketahui (belum diperbaiki):**

- Jika IndexedDB **dan** fallback localStorage sama-sama gagal, kegagalan
  ditelan diam-diam (`ujian-outbox.ts`). Siswa harus diperingatkan.
- Validasi cache gambar hanya `res.ok` + `blob.size > 0`; belum memeriksa
  `Content-Type: image/*` (HTML error dengan HTTP 200 lolos).
- ~~Data pengawas (kode ujian, kode reset) tidak disimpan lokal~~ — SUDAH
  diperbaiki: kode reset R1–R3 diambil sekali saat online lewat
  `GET /api/pengawas/sesi/[id]/kode-reset` dan dipakai offline dari situ.
  Lihat bagian RESET CODE SYSTEM. (Kalau ada bagian lain halaman Mode
  Pengawas yang masih butuh koneksi terus-menerus, itu belum ditelusuri di
  audit ini — cek `src/app/pengawas/` kalau relevan.)

## ANTI-CHEAT

- Client mendeteksi: keluar fullscreen, blur, visibilitychange, dsb.
  (`src/app/siswa/ujian/page.tsx`).
- Di Android (Capacitor), penguncian native (immersive mode + screen
  pinning) dijembatani lewat `src/lib/exam-lock.ts` →
  `android/.../ExamLockPlugin.java` (folder `android/` tidak ada di repo ini;
  pastikan tersedia di tempat build APK).
- Pelanggaran dikirim ke `/api/siswa/ujian/pelanggaran`; server
  men-dedup dalam jendela 5 detik dan menaikkan level.
- `pelanggaranActiveRef` di `page.tsx` berfungsi sebagai gerbang
  "menunggu reset"; ia direset **hanya** setelah kode reset benar.

**Belum ada (target desain — lihat prinsip di bawah):**

- Antrean event pelanggaran offline (saat ini kegagalan kirim hanya
  `console.warn` → pelanggaran offline hilang).
- Dedup event berbasis timestamp/ID idempotent di client.

**Prinsip yang HARUS dipertahankan:**

1. Offline **bukan** berarti anti-cheat mati.
2. Keluar dari lingkungan ujian yang **berhasil terdeteksi** = pelanggaran.
3. Crash/mati listrik yang tidak sempat terdeteksi = **recovery**, bukan
   pelanggaran yang dikarang-karang.
4. Event pelanggaran harus disimpan lokal dan disinkronkan idempotent.

## RESET CODE SYSTEM

**Sudah diimplementasikan (target desain lama SUDAH tercapai — bagian ini
sebelumnya tertinggal dari kode, jangan percaya versi lama dari riwayat
chat/patch):**

- Kode R1/R2/R3 (7 karakter) diturunkan deterministik lewat **HMAC-SHA256**
  (`src/lib/reset-berurutan.ts`, `hitungKodeReset`), **bukan** `Math.random()`.
  Tidak ada kode yang tersimpan mentah di database.
- Urutan & sekali-pakai dijaga atomik oleh penghitung
  `siswa_ujian.reset_terpakai` di database
  (`konsumsi_reset_berurutan`, `supabase/24_reset_berurutan.sql`); R2 ditolak
  sebelum R1 dipakai, dst.
- **Pelanggaran #1 → R1, #2 → R2, #3 → R3, #4 → siswa dikunci permanen
  (`TERKUNCI`) otomatis**, diputuskan atomik di `catat_pelanggaran_atomik`
  (lihat `supabase/24_reset_berurutan.sql` baris ~8, ~121). Ini sudah pelanggaran
  ke-4, bukan ke-3.
- Perangkat siswa memverifikasi kode **offline** tanpa server: amplop
  terenkripsi (PBKDF2 600rb iterasi) dikirim & disimpan lokal sejak siswa
  masuk ujian (`src/lib/reset-amplop-shared.ts`,
  `src/lib/reset-offline-client.ts`), dibuka lokal dengan kode dari pengawas,
  lalu hasil reset yang berhasil diverifikasi offline diantrekan untuk
  direkonsiliasi ke server begitu online lagi (idempoten, satu-per-satu,
  tidak pernah melompati entri gagal).
- Perangkat pengawas mengambil **semua** kode R1–R3 untuk seluruh siswa
  sesi SEKALI saat sesi dibuka/online
  (`GET /api/pengawas/sesi/[id]/kode-reset`), lalu memakainya offline dari
  situ. Kode **tidak pernah** dikirim ke perangkat siswa dari endpoint ini.
- Jenis kode terpisah: alur ini (Reset 1/2/3, untuk pelanggaran anti-cheat)
  berbeda dari Kode Ujian (masuk ujian, divalidasi di
  `api/siswa/ujian/validasi`) dan Kode Darurat Essay
  (`essay-amplop-shared.ts`, alur terpisah, lihat bagian ESSAY).

**Yang masih perlu diverifikasi/diaudit lebih lanjut (bukan berarti bug,
tapi belum ditelusuri ulang setelah refactor ini):** audit end-to-end alur
offline lengkap (amplop rusak/korup di IndexedDB, perangkat pengawas
kehilangan cache sebelum sempat online sekali, race antara pelaporan
pelanggaran offline dan pemakaian kode reset offline) belum ada catatan
hasil pengujian eksplisit di repo ini.

## ESSAY

- Mode `DIGITAL` (ketik + autosave, `essay/jawab`) dan `KERTAS` (siswa
  menulis di kertas; akses kirim dibuka pengawas, `buka-akses-essay`).
- Alur: PG selesai → nilai PG disimpan tapi disembunyikan → fase essay →
  kirim → nilai dibuka. Guru mengoreksi lewat `koreksi-essay`.
- **Sudah diperbaiki (README lama tertinggal):** `handleKirimEssay()` di
  `siswa/ujian/page.tsx` sekarang `await` hasil autosave terakhir
  (`syncJawabanEssay()`) sebelum memanggil `essay/kirim`, dan membedakan
  kegagalan jaringan (tidak memblokir siswa, jawaban diantrekan ke outbox
  permanen) dari penolakan sah server 409/403 (memblokir dengan pesan jelas).
- **Celah yang masih diketahui:** `essay/jawab` masih memakai `updated_at`
  (timestamp) untuk autosave, belum migrasi ke `revisi` seperti jawaban PG —
  jadi konflik multi-device untuk essay masih diselesaikan pakai jam, bukan
  penghitung monoton; finalisasi essay (`essay/kirim`) belum lewat RPC atomik
  (masih 2+ query terpisah dengan penyempitan celah race manual, lihat
  komentar di `essay/kirim/route.ts`); `essay/kirim` sengaja melewati cek
  device kalau `device_id` di database masih null (data lama sebelum
  device-lock ada) — bukan lubang baru, tapi tetap berarti device-lock tidak
  berlaku penuh untuk baris `siswa_ujian` semacam itu.

## DEVICE LOCK

- `siswa_ujian.device_id` mengikat siswa ke satu perangkat. Diperiksa di
  route `sync`, `cek-sesi`, `selesai`, dan endpoint essay
  (`mulai`/`jawab`/`kirim`).
- **Belum** diperiksa di: `pelanggaran`, `verifikasi-reset`, dan di dalam
  `finalisasi_pg_atomik()` (RPC belum menerima `device_id`).
- Takeover setelah heartbeat stale harus diperlakukan sebagai *device lease*;
  device lama harus ditolak setelah takeover.
- Identitas tab: `src/lib/identitas-tab.ts`. Outbox satu siswa tidak boleh
  pernah terkirim dengan identitas siswa lain (uji dengan dua tab).

## DEADLINE

- Jawaban yang dibuat **sebelum deadline** tetap diterima walau baru sync
  setelah deadline (kerja offline); jawaban yang dibuat setelahnya ditolak.
  Lihat `src/lib/deadline-pg.ts` dan `saringJawabanTerlambat` di `sync/route.ts`.
- Server **tidak** menjadikan waktu sync sebagai satu-satunya aturan, dan
  **tidak** memercayai jam client secara buta (metadata sesi dari server,
  validasi konsistensi). `clock-offset.ts` melindungi **timer** dari
  perubahan jam perangkat oleh siswa.

## SYNC

- `POST /api/siswa/ujian/sync` → `sync_jawaban_revisi(p_records)`; mengembalikan
  ACK per jawaban (`accepted` + `revisi` tersimpan).
- Jika RPC gagal, route mengembalikan **503** dan client mempertahankan
  jawaban di outbox untuk dicoba ulang. **Tidak ada fallback ke upsert lama.**
- `GET` sync mengembalikan jawaban server termasuk `revisi` untuk merge
  (`src/lib/jawaban-merge.ts`: bandingkan revisi dulu, jam hanya pemutus seri).

## RESET

- Reset siswa/sesi harus menangani jawaban PG, jawaban essay, revision,
  waktu mulai/deadline, device, heartbeat, pelanggaran, finalisasi, nilai.
- Bedakan **reset untuk retake** dari **hapus riwayat**. Riwayat audit
  jangan hilang tanpa alasan.
- *Audit fungsi Reset belum selesai.*

## BACKUP/RESTORE

- `api/admin/backup`, `api/admin/restore`, memakai `truncate_tabel_besar`
  dan `sinkron_sequence_setelah_restore` (migrasi 22).
- Restore harus menjaga konsistensi relasional (sesi ↔ siswa_ujian ↔
  jawaban ↔ essay ↔ nilai ↔ pelanggaran). Saat ini restore **bukan satu
  transaksi**; audit integritas belum selesai.

## PRODUCTION DEPLOYMENT

Urutan **wajib** saat rilis yang menyentuh database:

1. Jalankan migrasi baru di SQL Editor (berurutan; 23 akan menolak jika
   prasyarat tidak ada).
2. Verifikasi (lihat query di bawah).
3. **Baru** deploy kode.

Verifikasi keamanan (semua harus kosong/0):

```sql
-- fungsi yang bisa dijalankan anon/authenticated
select p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public'
  and (has_function_privilege('anon',p.oid,'execute')
    or has_function_privilege('authenticated',p.oid,'execute'));

-- tabel tanpa RLS atau masih terbuka untuk anon
select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relkind='r'
  and (not c.relrowsecurity
    or has_table_privilege('anon',c.oid,'select,insert,update,delete,truncate')
    or has_table_privilege('authenticated',c.oid,'select,insert,update,delete,truncate'));
```

Env vars: lihat `SETUP.md` bagian 4. Header keamanan (CSP, HSTS,
Permissions-Policy) **belum** dikonfigurasi di `next.config.js`.

---

## DO NOT REVERT / OVERWRITE

1. **Jangan menambahkan kembali fallback** ke upsert lama di `sync/route.ts`
   atau ke penulisan non-atomik di `selesai/route.ts`. Sistem harus fail
   closed.
2. **Jangan memberi hak `anon`/`authenticated`** pada tabel/fungsi apa pun,
   dan jangan menghapus migrasi 23. Jangan membuat client Supabase di browser
   untuk membaca tabel langsung.
3. **Jangan mengganti `revisi` dengan timestamp** untuk menentukan jawaban
   terbaru. (Essay masih perlu dimigrasikan *ke* revisi, bukan sebaliknya.)
4. **Jangan menjadikan waktu sinkronisasi sebagai waktu terjadinya jawaban.**
5. **Jangan menyederhanakan outbox/`finalisasi_pg_atomik`** menjadi beberapa
   query terpisah; atomisitasnya menutup race dengan penutupan sesi.
6. **Jangan mematikan anti-cheat saat offline**, dan jangan mengubah
   "keluar lingkungan ujian" menjadi bukan-pelanggaran.
7. **Jangan menimpa file dengan salinan dari zip/patch lama.** Riwayat repo
   (`git log`) adalah sumber kebenaran; edit file yang ada.
8. **Jangan mengklaim sesuatu aman sebelum diverifikasi di database
   production** (RLS, grant, RPC).
