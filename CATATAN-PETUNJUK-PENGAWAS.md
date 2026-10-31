# Petunjuk pengawas: tanpa sinyal & ganti perangkat

Dasar: repo `main`, commit `2e21a61`. Struktur folder sama dengan repo, ekstrak di akar repo.
Jika repo Anda sudah berubah setelah commit itu pada berkas yang sama, JANGAN timpa buta:
pakai `git apply --3way petunjuk-pengawas.patch`.

## Berkas (3 diubah, tanpa migrasi database, tanpa env baru)
UBAH  src/app/api/siswa/ujian/validasi/route.ts
      Saat perangkat lain berhasil mengambil alih sesi siswa (device_id berubah), server
      mencatat log_aktivitas aksi GANTI_PERANGKAT, detail "sesi:<id>|jeda_detik:..|lama:..|baru:..".
UBAH  src/app/api/pengawas/sesi/[id]/siswa/route.ts
      Respons siswa kini memuat detik_tanpa_sinyal (dari last_heartbeat, dihitung dengan jam
      server) dan ganti_perangkat (jumlah log GANTI_PERANGKAT sesi ini). device_id TIDAK dikirim.
UBAH  src/app/guru/jadwal-pengawasan/tabs/ModePengawasTab.tsx
      Dua label di baris siswa: "Tanpa sinyal N mnt" (siswa AKTIF, >= 60 dtk) dan
      "Ganti perangkat N x".

## Keputusan desain
- Ganti perangkat dicatat sebagai PETUNJUK, bukan pelanggaran otomatis. Pelanggaran otomatis
  akan memicu RESET/kunci permanen; siswa jujur yang pindah HP karena sinyal hilang akan ikut
  terkena. Jika Anda tetap ingin menjadikannya pelanggaran, itu perubahan terpisah.
- Label "tanpa sinyal" bukan bukti kecurangan: offline sengaja diperbolehkan. Ambang 60 dtk
  ada di BATAS_TANPA_SINYAL_DETIK (ModePengawasTab.tsx).

## Batas yang perlu Anda tahu
- Tidak menutup celah penghapusan data: hanya membuat jejaknya terlihat. Bila siswa menghapus
  data lalu masuk lagi < 2 menit sejak heartbeat terakhir, validasi menolak (aturan lama).
  Bila > 2 menit, masuk diizinkan dan label "Ganti perangkat" muncul.
- Label hanya muncul setelah siswa masuk ulang lewat validasi (untuk ganti perangkat) atau
  selama polling daftar siswa berjalan (untuk tanpa sinyal).
- Label tanpa sinyal hanya untuk status AKTIF (heartbeat tidak diperbarui saat RESET).

## Pengujian
- npx tsc --noEmit -> lulus tanpa error.
BELUM diuji: di browser/APK, database nyata, dan beban serentak. Uji di staging:
(a) matikan internet HP siswa > 1 menit -> label "Tanpa sinyal" muncul di layar pengawas;
(b) hapus data situs di HP siswa, tunggu > 2 menit, masuk lagi -> label "Ganti perangkat" muncul;
(c) alur normal 1 perangkat tidak berubah.
