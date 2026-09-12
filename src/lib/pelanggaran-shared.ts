// Helper bersama untuk menampilkan riwayat pelanggaran (kecurangan) siswa
// selama ujian. Dipakai di halaman guru "Mode Pengawas" (realtime, sesi yang
// sedang berjalan) dan halaman guru "Rekap Nilai" (riwayat, sesi yang sudah
// selesai) supaya label & warnanya konsisten di kedua tempat.

// ── Terjemahan jenis pelanggaran ke Bahasa Indonesia ──────────────────────
// Nilai `jenis` datang langsung dari client saat siswa ujian (lihat
// laporPelanggaran() di src/app/siswa/ujian/page.tsx), jadi daftar di bawah
// ini harus disinkronkan kalau ada jenis deteksi baru yang ditambahkan di sana.
export function terjemahJenisPelanggaran(jenis: string): string {
  const map: Record<string, string> = {
    WINDOW_BLUR:     'Keluar dari Aplikasi Ujian',
    EXIT_FULLSCREEN: 'Keluar Layar Penuh',
    TAB_SWITCH:      'Berpindah Tab/Aplikasi',
    COPY_PASTE:      'Salin/Tempel Teks',
    CONTEXT_MENU:    'Klik Kanan',
    KEYBOARD_BLOCK:  'Shortcut Terlarang',
    DRAG_DROP:       'Drag & Drop',
  }
  return map[jenis] ?? jenis.replace(/_/g, ' ')
}

// ── Label & warna badge status tindak lanjut pelanggaran ──────────────────
export function labelStatusPelanggaran(status: string): string {
  const map: Record<string, string> = {
    BELUM_DITINDAKLANJUTI: 'Belum Ditindaklanjuti',
    SUDAH_DITINDAKLANJUTI: 'Sudah Ditindaklanjuti',
    DIABAIKAN: 'Diabaikan',
  }
  return map[status] ?? status.replace(/_/g, ' ')
}

export function warnaStatusPelanggaran(status: string): string {
  if (status === 'SUDAH_DITINDAKLANJUTI') return 'badge-green'
  if (status === 'DIABAIKAN') return 'badge bg-slate-100 text-slate-500'
  return 'badge-yellow'
}
