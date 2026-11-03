// src/lib/admin-kelas-shared.ts
//
// Tipe & label untuk tab-tab tambahan menu Admin Kelas (guru): Kesiapan Ujian
// dan Reset Password Siswa. TIDAK ada import server di sini, jadi aman dipakai
// komponen client maupun route API.
import type { StatusSoal } from '@/lib/soal-status-shared'

export interface BarisKesiapanKelas {
  mapel_id: string
  nama_mapel: string
  kelas: string
  nama_guru: string | null
  status_soal: StatusSoal
  sudah_dijadwalkan: boolean
  /** YYYY-MM-DD, null kalau belum terjadwal. */
  tanggal_jadwal: string | null
  /**
   * Tautan WhatsApp berisi pesan tagihan siap kirim ke guru pengampu. Hanya
   * diisi untuk status yang memang menunggu tindakan GURU (belum ada, draft,
   * ditolak) dan kalau guru punya nomor HP valid.
   */
  link_tagih: string | null
}

export interface RingkasanKesiapanKelas {
  total: number
  per_status: Record<StatusSoal, number>
  /** DISETUJUI tetapi belum punya jadwal. */
  siap_belum_terjadwal: number
  sudah_terjadwal: number
  /** Menunggu tindakan guru (BELUM_ADA + DRAFT + DITOLAK). */
  perlu_ditagih: number
}

export interface ResponKesiapanKelas {
  kelas: { id: string; nama: string }[]
  data: BarisKesiapanKelas[]
  ringkasan: RingkasanKesiapanKelas
  /** Kelas wilayah yang belum punya mapel sama sekali (tidak ada yang bisa dipantau). */
  kelas_tanpa_mapel: string[]
}

export interface SiswaAdminKelas {
  nis: string
  nama: string
  kelas: string
  status: string | null
  last_login: string | null
}

export interface ResponSiswaAdminKelas {
  kelas: { id: string; nama: string }[]
  data: SiswaAdminKelas[]
}

/** Label status soal yang dipakai di papan kesiapan. */
export const LABEL_KESIAPAN: Record<StatusSoal, string> = {
  BELUM_ADA: 'Belum dibuat',
  DRAFT: 'Sedang dibuat',
  MENUNGGU: 'Menunggu validasi',
  DITOLAK: 'Ditolak',
  DISETUJUI: 'Disetujui',
}
