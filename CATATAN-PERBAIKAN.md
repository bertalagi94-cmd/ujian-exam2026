# Perbaikan alur ujian — ujian-exam2026

Dasar: commit `e573405` (main). Struktur folder SAMA dengan repo: ekstrak di root repo, timpa.
Jika ada perubahan di repo setelah commit itu pada berkas yang sama, jangan timpa buta —
pakai `git apply --3way perbaikan-alur-ujian.patch`.

## Berkas (4 diubah, tidak ada yang baru/dihapus, tanpa migrasi DB, tanpa env baru)
- src/lib/penilaian-ujian.ts
- src/lib/finalisasi-nilai.ts
- src/app/api/siswa/ujian/selesai/route.ts
- src/app/api/siswa/nilai/[id]/route.ts

## Yang diperbaiki
1. Error sesaat pada query kunci jawaban tidak lagi ikut di-cache 5 menit
   (sebelumnya: kunciMap kosong ter-cache -> semua siswa yang submit dinilai 0 permanen).
   - ambilDataSesiUntukPenilaian kini memeriksa error semua query dan MELEMPAR
     DataPenilaianGagalError (hasil tidak di-cache). Ada pengaman: paket punya soal
     tapi kunci kosong -> dianggap gagal baca.
   - selesai/route.ts: bila data penilaian gagal dibaca -> HTTP 503 `sementara:true`
     (klien/outbox mencoba lagi otomatis; jawaban tetap aman).
   - finalisasiNilaiPaksa: bila gagal -> ok:false, TIDAK menulis nilai.
   - kunci-siswa.ts sudah punya try/catch -> tidak perlu diubah.
2. Finalisasi paksa (tutup sesi) tidak lagi memotong jawaban di 1000 baris
   - Query jawaban/nilai/status_essay dipaginasi dengan ambilSemuaBaris (urutan stabil)
     dan error-nya diperiksa; gagal baca jawaban -> ok:false sebelum satu nilai pun ditulis.
3. Kunci & jawaban dinormalisasi (trim + huruf besar) saat menilai; rincian nilai siswa
   (nilai/[id]) memakai aturan yang sama supaya konsisten.

## Sengaja TIDAK diubah (keputusan kebijakan, bukan bug pasti)
- Selisih GRACE 60 dtk vs +3 menit toleransi jam klien di deadline-pg.ts.
- Penolakan TANPA_JEDA_OFFLINE_NYATA saat heartbeat >= deadline.

## Pengujian yang sudah dijalankan
- npx tsc --noEmit -> lulus tanpa error.
- 7 uji logika dengan DB tiruan (meniru .range() & batas 1000 baris PostgREST) memakai
  kode asli: error query tidak ter-cache & pulih di panggilan berikutnya; 400 siswa
  benar semua -> 0 siswa bernilai 0 (sebelumnya 66); error baca jawaban -> tidak ada
  nilai 0 ditulis; kunci " a " vs jawaban "a" dinilai benar.
BELUM diuji: Supabase produksi, alur ujian nyata di browser/APK, beban serentak.
Mohon uji: (a) tutup sesi dengan >1000 baris jawaban milik siswa belum-selesai,
(b) submit normal 1 siswa, (c) submit saat DB sengaja dibuat gagal -> harus 503 lalu pulih.
