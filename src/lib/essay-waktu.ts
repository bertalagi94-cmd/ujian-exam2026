// src/lib/essay-waktu.ts
//
// Validasi batas waktu essay di server. Toleransi 60 detik (jeda jaringan),
// sama seperti PG.
//
// REVISI: sebelumnya SEMUA aksi essay (jawab/kirim) ditolak mutlak setelah
// batas + 60 dtk, sehingga siswa yang offline (mis. essay via kode darurat)
// dan baru online belakangan kehilangan jawabannya. PG sudah punya kebijakan
// "jawaban yang dibuat sebelum batas tetap sah" (deadline-pg.ts). Di sini
// padanannya memakai bukti dari SERVER: siswa_ujian.last_heartbeat. Kalau
// heartbeat terakhir yang dicatat server masih SEBELUM deadline, perangkat
// terbukti offline saat waktu habis -> kiriman terlambat diterima. Kalau
// heartbeat sudah di/after deadline, perangkat terbukti online -> ditolak.

const GRACE_MS = 60 * 1000

export function sudahLewatBatasWaktuEssay(
  waktuMulaiEssay: string | null | undefined,
  durasiMenit: number | null | undefined
): boolean {
  if (!waktuMulaiEssay || !durasiMenit) return false
  const batasWaktu = new Date(waktuMulaiEssay).getTime() + durasiMenit * 60 * 1000
  return Date.now() > batasWaktu + GRACE_MS
}

/**
 * true = aksi essay HARUS ditolak karena waktu habis dan perangkat terbukti
 * online sampai deadline. false = boleh (belum lewat batas, atau terlambat
 * tapi terbukti offline).
 */
export function essayTerlambatDitolak(
  waktuMulaiEssay: string | null | undefined,
  durasiMenit: number | null | undefined,
  lastHeartbeat: string | null | undefined
): boolean {
  if (!sudahLewatBatasWaktuEssay(waktuMulaiEssay, durasiMenit)) return false
  const deadlineMs = new Date(waktuMulaiEssay as string).getTime() + (durasiMenit as number) * 60 * 1000
  const hb = lastHeartbeat ? new Date(lastHeartbeat).getTime() : NaN
  // Tanpa bukti heartbeat -> tidak bisa membuktikan online -> terima (jangan rugikan siswa).
  if (!Number.isFinite(hb)) return false
  return hb >= deadlineMs
}
