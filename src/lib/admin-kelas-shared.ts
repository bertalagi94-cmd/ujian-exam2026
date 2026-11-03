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

// ── Pantauan ujian (siswa terkunci & sesi bermasalah) ───────────────────────

export type JenisMasalahSesi = 'KEMARIN' | 'LEWAT_WAKTU' | 'SEMUA_SELESAI'

export const LABEL_MASALAH_SESI: Record<JenisMasalahSesi, string> = {
  KEMARIN: 'Belum ditutup sejak kemarin',
  LEWAT_WAKTU: 'Lewat waktu, belum ditutup',
  SEMUA_SELESAI: 'Semua siswa selesai, belum ditutup',
}

export interface SesiPantauan {
  sesi_id: string
  nama_mapel: string
  kelas: string
  label_tanggal: string
  label_jam_mulai: string
  durasi_menit: number
  is_susulan: boolean
  /** null = sesi berjalan normal. */
  jenis_masalah: JenisMasalahSesi | null
  peserta: { aktif: number; reset: number; selesai: number; terkunci: number; total_masuk: number }
  pengawas_nama: string | null
  /** Tautan WhatsApp pengingat ke pengawas; hanya untuk sesi bermasalah dan pengawas ber-HP valid. */
  link_ingatkan: string | null
}

export interface SiswaTerkunciPantauan {
  sesi_id: string
  nis: string
  nama: string
  kelas: string
  nama_mapel: string
  label_tanggal: string
  /** true = sesinya masih berjalan (siswa mungkin sedang menunggu ditangani). */
  sesi_berjalan: boolean
  jumlah_pelanggaran: number
  /** Jenis pelanggaran (sudah diterjemahkan), maksimal 3 teratas. */
  jenis_pelanggaran: string[]
}

export interface ResponPantauanKelas {
  kelas: { id: string; nama: string }[]
  sesi: SesiPantauan[]
  terkunci: SiswaTerkunciPantauan[]
  /** Riwayat siswa terkunci yang ditampilkan (hari ke belakang). */
  hari_riwayat: number
  ringkasan: {
    sesi_berjalan: number
    sesi_bermasalah: number
    siswa_terkunci: number
    terkunci_di_sesi_berjalan: number
  }
}
