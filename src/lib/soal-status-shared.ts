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
// API (saat pengawas mencoba membuka sesi) maupun label di UI.
export const STATUS_MESSAGE: Record<StatusSoal, string> = {
  BELUM_ADA: 'Soal untuk mata pelajaran dan kelas ini belum dibuat oleh guru. Sesi ujian belum dapat dibuka.',
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

export function pesanStatusSoal(status?: string | null): string {
  return STATUS_MESSAGE[(status as StatusSoal) ?? 'BELUM_ADA'] ?? STATUS_MESSAGE.BELUM_ADA
}
