# Hemat CPU Vercel — sisi guru/pengawas (9 Nov 2026)

Dua file berubah. Tidak ada perubahan database, API, atau logika bisnis.

1. ModePengawasTab.tsx
   - Poll roster siswa: 12 dtk -> 30 dtk.
   - Daftar pelanggaran LENGKAP tidak lagi ikut di tiap poll roster; hanya tiap ~2 menit
     (jaring pengaman). Pelanggaran baru tetap ditangkap poll cepat 5 dtk (tidak diubah).
   - load() awal, tombol refresh, dan semua aksi pengawas (reset/kunci/dll.) tetap memuat
     roster + pelanggaran lengkap seketika.

2. api/pengawas/sesi/[id]/siswa/route.ts
   - Query yang saling bebas dijalankan paralel (ruang khusus, log GANTI_PERANGKAT,
     siswa sesi lain untuk susulan). Isi query dan bentuk respons identik.

Untuk kembali ke perilaku lama: JEDA_POLL_ROSTER_MS = 12_000 dan PELANGGARAN_PENUH_MS = 12_000
di ModePengawasTab.tsx.
