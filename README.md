# Fitur Soal Essay — Backend LENGKAP (siap timpa langsung ke repo)

Total **17 file backend** sudah selesai dan siap ditimpa/ditambahkan ke
`bertalagi94-cmd/ujian-exam2026`. Ini SEMUA logika server (database, API,
validasi, rumus nilai) — yang tersisa HANYA tampilan (UI) di frontend,
lihat bagian "SISA PEKERJAAN" di bawah.

## Cara pasang
Struktur folder di dalam zip ini SAMA PERSIS dengan struktur repo Anda —
tinggal copy-timpa folder `src/` dan `supabase/` di zip ini ke repo Anda,
lalu jalankan migrasi SQL-nya.

```
supabase/07_essay.sql   ← BARU, jalankan di Supabase SQL editor dulu

src/lib/penilaian-ujian.ts                                          ← DIEDIT (tambah info_json ke select)
src/app/api/siswa/ujian/selesai/route.ts                              ← DIEDIT (cabang alur essay)
src/app/api/guru/mode-pengawas/route.ts                               ← DIEDIT (salin config essay ke sesi)
src/app/api/guru/susulan/route.ts                                     ← DIEDIT (idem, untuk sesi susulan guru)
src/app/api/admin/susulan/route.ts                                    ← DIEDIT (idem, untuk sesi susulan admin)
src/app/api/guru/kirim-nilai/route.ts                                 ← DIEDIT (tambah aksi rilis_essay_individu / rilis_essay_sekaligus)

src/app/api/guru/soal-essay/route.ts                                  ← BARU (CRUD bank soal essay - list & create)
src/app/api/guru/soal-essay/[id]/route.ts                             ← BARU (CRUD - update & delete)
src/app/api/guru/jadwal/[id]/essay-setting/route.ts                   ← BARU (set mode/durasi/bobot per jadwal)
src/app/api/guru/mode-pengawas/buka-akses-essay/route.ts              ← BARU (buka akses kirim, mode KERTAS)
src/app/api/guru/koreksi-essay/route.ts                               ← BARU (lihat jawaban + input nilai essay)
src/app/api/siswa/ujian/essay/info/route.ts                           ← BARU (halaman info sebelum mulai essay)
src/app/api/siswa/ujian/essay/mulai/route.ts                          ← BARU (mulai timer essay)
src/app/api/siswa/ujian/essay/jawab/route.ts                          ← BARU (autosave jawaban, mode DIGITAL)
src/app/api/siswa/ujian/essay/upload-foto/route.ts                    ← BARU (upload foto, mode KERTAS)
src/app/api/siswa/ujian/essay/kirim/route.ts                          ← BARU (kirim essay, buka nilai PG + lepas fullscreen)
```

**PENTING**: file yang ditandai "DIEDIT" adalah file yang SUDAH ADA di
repo Anda — file di zip ini adalah versi LENGKAP (bukan diff/patch), jadi
langsung TIMPA file lama dengan file ini. Perubahan yang saya buat di
masing-masing ditandai komentar `// FIX (fitur essay): ...` di dalam kode,
supaya gampang dilacak kalau ada konflik dengan perubahan lain yang mungkin
sudah Anda buat di file yang sama sejak repo di-clone.

## Alur yang SUDAH lengkap di backend ini
1. Guru buat soal essay + atur mode jawaban/durasi/bobot per jadwal
2. Sesi dibuka → konfigurasi essay ikut tersalin & terkunci di sesi tsb
3. Siswa submit PG → nilai PG dihitung & DISIMPAN tapi TIDAK dibuka ke
   siswa dulu → diarahkan ke fase essay
4. Siswa lihat info essay → mulai → jawab (digital: ketik & autosave;
   kertas: hanya baca soal + upload foto setelah pengawas buka akses)
5. Siswa kirim essay → BARU DI SINI nilai PG dibuka & status ujian jadi
   SELESAI (frontend bisa lepas fullscreen)
6. Guru koreksi essay (lihat jawaban/foto, input nilai) → sistem hitung
   nilai_total otomatis dari bobot PG:Essay
7. Guru rilis nilai (per individu / sekaligus — sekaligus terkunci sampai
   SEMUA siswa dinilai) → siswa baru bisa lihat nilai_essay/nilai_total

## SISA PEKERJAAN — hanya UI/Frontend (untuk dilanjutkan AI lain)
Backend TIDAK butuh apa-apa lagi untuk fitur ini berfungsi lewat API
langsung (Postman/curl). Yang belum ada HANYA tampilan di browser:

1. **`src/app/siswa/ujian/page.tsx`** (paling besar, 1906 baris) — tambah
   state/tampilan baru setelah submit PG: halaman info essay → form
   jawab essay (digital/kertas) → tombol kirim. INI YANG PALING RUMIT
   karena harus terintegrasi dengan fullscreen-lock & anti-kecurangan yang
   sudah ada di file itu.
2. Halaman guru: form buat/edit soal essay + setting sesi (pakai endpoint
   `/api/guru/soal-essay` & `/api/guru/jadwal/[id]/essay-setting`)
3. Halaman guru: panel koreksi essay (pakai `/api/guru/koreksi-essay`)
4. Tombol "Buka Akses Kirim" di halaman Mode Pengawas guru, untuk mode
   KERTAS (pakai `/api/guru/mode-pengawas/buka-akses-essay`)
5. `src/app/guru/kirim-nilai/page.tsx` — tambah tombol rilis nilai essay
   (pakai aksi `rilis_essay_individu` / `rilis_essay_sekaligus`)
6. Halaman Pengaturan Admin — tambah 2 field untuk
   `batas_durasi_essay_min_menit` / `batas_durasi_essay_max_menit`
   (endpoint-nya sudah ada, generik key-value, tidak perlu API baru)

Detail teknis & alasan setiap keputusan desain ada di `HANDOFF.md` yang
disertakan dalam paket ini — silakan lampirkan ke sesi AI berikutnya
sebagai konteks.
