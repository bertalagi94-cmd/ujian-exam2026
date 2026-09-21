// Kebijakan BATAS WAKTU PG yang deterministik & dihitung di SERVER.
//
//   mulai    = siswa_ujian.waktu_mulai_awal   (referensi tunggal, tidak berubah
//                                              walau siswa di-reset pelanggaran)
//   deadline = mulai + sesi_ujian.durasi menit
//   batasMaks= deadline + GRACE (jeda jaringan wajar saat auto-submit)
//
// Kebenaran ujian TIDAK boleh bergantung pada pengawas yang menutup sesi atau
// pada cron: begitu NOW > batasMaks, server SENDIRI yang tahu bahwa waktu siswa
// itu sudah habis ("kedaluwarsa secara logis").
//
// KEBIJAKAN jawaban yang datang setelah kedaluwarsa (mis. siswa offline lalu
// baru online lagi):
//   - Jawaban yang DIBUAT sebelum deadline (dibuktikan lewat waktu perubahan
//     yang dicatat client, `waktuJawabMs`) tetap SAH -- siswa offline yang
//     mengerjakan tepat waktu tidak boleh dirugikan.
//   - Jawaban tanpa bukti waktu, atau yang klaim waktunya jatuh setelah batas,
//     DITOLAK.
// JUJUR soal batasnya: waktu dari client adalah BUKTI, bukan JAMINAN. Client
// yang dipalsukan bisa mengklaim waktu apa pun di dalam rentang sah. Lapisan
// pendukungnya: (1) jam client di aplikasi dibuat tahan dimundurkan (lihat
// src/lib/clock-offset.ts), (2) setiap penerimaan/penolakan jawaban terlambat
// dicatat ke log_aktivitas untuk ditinjau, (3) klaim yang mustahil (sebelum
// mulai, atau di masa depan menurut jam server) ditolak.

export const GRACE_MS = 60_000
// Selisih jam perangkat siswa yang masih dimaklumi saat memeriksa klaim waktu
// (perangkat tanpa sinkronisasi jam yang baik). Tidak memberi keuntungan
// kepada pemalsu -- mereka bisa mengklaim waktu apa pun di dalam rentang sah
// -- hanya mencegah siswa JUJUR dengan jam melenceng ditolak keliru.
export const TOLERANSI_JAM_CLIENT_MS = 3 * 60_000

export interface BatasWaktuPg {
  mulaiMs: number
  deadlineMs: number
  batasMaksMs: number
}

export function hitungBatasWaktuPg(
  waktuMulaiAwal: string | null | undefined,
  durasiMenit: number | null | undefined
): BatasWaktuPg | null {
  if (!waktuMulaiAwal || !durasiMenit) return null
  const mulaiMs = new Date(waktuMulaiAwal).getTime()
  if (Number.isNaN(mulaiMs)) return null
  const deadlineMs = mulaiMs + durasiMenit * 60_000
  return { mulaiMs, deadlineMs, batasMaksMs: deadlineMs + GRACE_MS }
}

/** true kalau waktu siswa ini sudah lewat (kedaluwarsa secara logis). */
export function sudahKedaluwarsa(batas: BatasWaktuPg | null, sekarangMs: number): boolean {
  return !!batas && sekarangMs > batas.batasMaksMs
}

export interface JawabanMasuk {
  soal_id: string
  jawaban: string
  revisi?: number
  /** Waktu (ms epoch, jam tepercaya client) saat siswa membuat/ubah jawaban ini. */
  waktuJawabMs?: number
}

export type AlasanTolak = 'TANPA_BUKTI_WAKTU' | 'SETELAH_BATAS' | 'SEBELUM_MULAI' | 'DI_MASA_DEPAN'

export interface HasilSaring<T extends JawabanMasuk> {
  diterima: T[]
  ditolak: { jawaban: T; alasan: AlasanTolak }[]
}

/**
 * Terapkan kebijakan jawaban terlambat. Hanya dipanggil kalau siswa sudah
 * KEDALUWARSA; kalau belum, semua jawaban diterima seperti biasa (tidak
 * memanggil fungsi ini sama sekali -- jalur normal tidak berubah).
 */
export function saringJawabanTerlambat<T extends JawabanMasuk>(
  jawaban: T[],
  batas: BatasWaktuPg,
  sekarangMs: number
): HasilSaring<T> {
  const diterima: T[] = []
  const ditolak: { jawaban: T; alasan: AlasanTolak }[] = []
  for (const j of jawaban) {
    const w = j.waktuJawabMs
    if (typeof w !== 'number' || !Number.isFinite(w)) {
      ditolak.push({ jawaban: j, alasan: 'TANPA_BUKTI_WAKTU' })
    } else if (w > sekarangMs + TOLERANSI_JAM_CLIENT_MS) {
      ditolak.push({ jawaban: j, alasan: 'DI_MASA_DEPAN' })
    } else if (w < batas.mulaiMs - TOLERANSI_JAM_CLIENT_MS) {
      ditolak.push({ jawaban: j, alasan: 'SEBELUM_MULAI' })
    } else if (w > batas.batasMaksMs + TOLERANSI_JAM_CLIENT_MS) {
      ditolak.push({ jawaban: j, alasan: 'SETELAH_BATAS' })
    } else {
      diterima.push(j)
    }
  }
  return { diterima, ditolak }
}
