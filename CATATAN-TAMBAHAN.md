# Perbaikan tambahan (setelah pengecekan ulang)

Dasar: commit terbaru di GitHub `2214137` (yang sudah berisi paket perbaikan pertama).
Hanya 4 berkas — struktur folder sama dengan repo, tinggal timpa.

- src/lib/device-guard.ts  + PESAN_APLIKASI_LAMA dan pesanDevice()
- src/app/api/siswa/ujian/pelanggaran/route.ts       pilih pesan sesuai hasil cek
- src/app/api/siswa/ujian/verifikasi-reset/route.ts  pilih pesan sesuai hasil cek
- README.md  catatan: mode multi-yayasan belum boleh dinyalakan sebelum uji dua yayasan lulus

Alasan: pada DEVICE_LOCK_STRICT=true, request tanpa deviceId (aplikasi lama) sebelumnya
dijawab "aktif di perangkat lain" — menyesatkan. Sekarang dijawab "Versi aplikasi usang...".
Perilaku keamanan tidak berubah. Sudah lulus: tsc --noEmit, uji logika pesanDevice.
