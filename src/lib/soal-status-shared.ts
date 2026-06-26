// src/lib/soal-status-shared.ts
//
// Bagian dari status_soal yang AMAN dipakai di client component (tidak ada
// import ke supabase admin client / service role key). Logika query database
// (computeStatusSoalMap, getStatusSoal) ada di src/lib/soal-status.ts dan
// HANYA boleh dipakai di server (API routes).

export type StatusSoal = 'BELUM_ADA' | 'DRAFT' | 'MENUNGGU' | 'DITOLAK' | 'DISETUJUI'

export const STATUS_LABEL: Record<StatusSoal, string> = {
  BELUM_ADA: 'Belum Ada Soal',
  DRAFT: 'Sedang Dibuat',
  MENUNGGU: 'Menunggu Persetujuan',
  DITOLAK: 'Ditolak',
  DISETUJUI: 'Soal Siap',
}

// Pesan informatif untuk masing-masing status — dipakai baik di pesan error
// API (saat pengawas mencoba membuka sesi) maupun label/tooltip di UI.
// Beberapa pesan menyebut nama guru pembuat soal (namaGuru) supaya pengawas
// (termasuk akun GURU yang sedang memakai Mode Pengawas) tahu harus
// menghubungi siapa. Kalau nama guru tidak diketahui, dipakai placeholder
// "-".
export const STATUS_MESSAGE: Record<StatusSoal, string> = {
  BELUM_ADA: 'Soal untuk mata pelajaran dan kelas ini belum dibuat oleh guru. Sesi ujian belum dapat dibuka. Kemungkinan ujian di mapel ini belum dapat dilaksanakan hari ini.',
  DRAFT: 'Soal masih dalam proses pembuatan (draft) oleh guru dan belum diajukan untuk divalidasi. Sesi ujian belum dapat dibuka.',
  MENUNGGU: 'Soal sudah dibuat tetapi masih menunggu validasi/persetujuan admin. Sesi ujian belum dapat dibuka.',
  DITOLAK: 'Soal untuk mata pelajaran dan kelas ini ditolak saat validasi dan perlu direvisi oleh guru. Sesi ujian belum dapat dibuka.',
  DISETUJUI: 'Soal sudah disetujui dan siap digunakan.',
}

export function isStatusSoalSiap(status?: string | null): boolean {
  return status === 'DISETUJUI'
}

export function labelStatusSoal(status?: string | null): string {
  return STATUS_LABEL[(status as StatusSoal) ?? 'BELUM_ADA'] ?? STATUS_LABEL.BELUM_ADA
}

/**
 * @param status status_soal saat ini.
 * @param namaGuru nama guru pemilik paket soal (kalau diketahui) — dipakai
 *   supaya pengawas/guru-mode-pengawas tahu harus menghubungi siapa.
 */
export function pesanStatusSoal(status?: string | null, namaGuru?: string | null): string {
  const guru = namaGuru?.trim() || '-'
  switch ((status as StatusSoal) ?? 'BELUM_ADA') {
    case 'BELUM_ADA':
      return `Soal belum dibuat. Nama Guru : ${guru}. Kemungkinan ujian di mapel ini belum dapat dilaksanakan hari ini.`
    case 'DRAFT':
      return `Soal Sedang dibuat. Sampaikan ke Guru ${guru} untuk mengirim soal ke admin agar dapat di setujui sehingga tombol mulai ujian bisa aktif.`
    case 'MENUNGGU':
      return `Soal sedang Menunggu Validasi admin. Sampaikan ke Admin untuk segera menyetujui soal agar tombol Mulai Ujian bisa aktif.`
    case 'DITOLAK':
      return `Soal ditolak saat validasi dan perlu direvisi. Nama Guru : ${guru}`
    case 'DISETUJUI':
      return STATUS_MESSAGE.DISETUJUI
    default:
      return STATUS_MESSAGE.BELUM_ADA
  }
}
