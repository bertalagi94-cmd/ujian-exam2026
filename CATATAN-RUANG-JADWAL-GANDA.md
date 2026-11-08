# Perbaikan: siswa ruang khusus dengan 2+ jadwal di satu ruang

Masalah: setelah siswa selesai mengerjakan mapel pertama, mengetik kode ruang lagi
mengarah ke sesi yang sama (sudah selesai) dan ditolak "Anda sudah menyelesaikan
ujian ini", sehingga mapel kedua tidak bisa dimulai. Urutan sesi juga mengikuti
urutan pembuatan, bukan jam jadwal, sehingga login ulang saat mengerjakan bisa
salah sesi.

Perbaikan (src/lib/ruang-khusus.ts, fungsi resolveSesiDariKodeRuang):
1. Sesi yang sedang dikerjakan (AKTIF/RESET/TERKUNCI) dilanjutkan.
2. Kalau tidak ada, ambil sesi berikutnya yang belum disentuh, urut jam jadwal.
3. Sesi yang sudah selesai (ada nilai atau status SELESAI) tidak dipilih lagi.
4. Semua selesai -> pesan "Anda sudah menyelesaikan ujian ini." (sama seperti dulu).

Ruang dengan satu jadwal per siswa: perilaku tidak berubah.

Yang TIDAK diubah (keputusan kebijakan, bukan bug):
- "Mulai sesi" tetap membuka semua sesi jadwal hari itu sekaligus (tanpa batas jam).
- Ruang yang tidak pernah dimulai tetap harus dibatalkan admin.

File ini ditimpa utuh. Kalau src/lib/ruang-khusus.ts sudah kamu ubah sendiri setelah
kloning terakhir, pakai ruang-khusus.patch (git apply) alih-alih menimpa file.
