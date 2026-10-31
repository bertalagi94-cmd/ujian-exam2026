/**
 * Pembatas konkurensi sederhana (FIFO) dengan antrean terbatas.
 *
 * KENAPA ADA: pekerjaan CPU-berat (PBKDF2 600rb iterasi saat siswa masuk ujian)
 * tidak jadi lebih cepat kalau dijalankan paralel di instance yang sama — total
 * CPU-nya tetap. Tanpa batas, 20 siswa serentak di 1 core SEMUA selesai di waktu
 * yang hampir sama (lambat), sehingga kalau melewati batas durasi fungsi,
 * semuanya gagal bersamaan. Dengan antrean berurutan, siswa yang datang lebih
 * dulu selesai lebih dulu (terukur: siswa pertama ~0,8 dtk vs ~12,5 dtk), dan
 * kalau antrean sudah terlalu panjang, request baru DITOLAK CEPAT dengan pesan
 * "coba lagi" — jauh lebih baik daripada menggantung sampai timeout.
 *
 * Batas ini per-instance (memori proses). Kalau Vercel menambah instance,
 * kapasitas total ikut naik.
 */

export class AntreanPenuhError extends Error {
  constructor(message = 'Antrean pekerjaan penuh') {
    super(message)
    this.name = 'AntreanPenuhError'
  }
}

export interface PembatasKonkurensi {
  /** Jalankan fn begitu ada slot. Melempar AntreanPenuhError kalau antrean sudah penuh. */
  jalankan<T>(fn: () => Promise<T>): Promise<T>
  /** Jumlah pekerjaan yang sedang berjalan (untuk logging/diagnosa). */
  readonly aktif: number
  /** Jumlah pekerjaan yang menunggu slot. */
  readonly menunggu: number
}

export function buatPembatasKonkurensi(konkurensi: number, antreanMaks: number): PembatasKonkurensi {
  const maks = Math.max(1, Math.floor(konkurensi))
  const batasAntrean = Math.max(0, Math.floor(antreanMaks))
  let aktif = 0
  const antrean: Array<() => void> = []

  function lepas() {
    aktif--
    const berikut = antrean.shift()
    if (berikut) {
      aktif++
      berikut()
    }
  }

  return {
    get aktif() { return aktif },
    get menunggu() { return antrean.length },
    async jalankan<T>(fn: () => Promise<T>): Promise<T> {
      if (aktif >= maks) {
        if (antrean.length >= batasAntrean) throw new AntreanPenuhError()
        await new Promise<void>((resolve) => antrean.push(resolve))
      } else {
        aktif++
      }
      try {
        return await fn()
      } finally {
        lepas()
      }
    },
  }
}

/** Baca integer dari env dengan nilai bawaan & batas; nilai tidak valid -> bawaan. */
export function intDariEnv(nama: string, bawaan: number, min: number, maks: number): number {
  const mentah = process.env[nama]
  if (mentah === undefined || mentah === '') return bawaan
  const n = Number(mentah)
  if (!Number.isFinite(n)) return bawaan
  return Math.min(maks, Math.max(min, Math.floor(n)))
}
