// Helper bersama untuk membatasi ("clamp") klaim waktu yang dilaporkan CLIENT
// saat merekonsiliasi state yang terjadi ketika device offline (mis. "PG
// selesai offline" atau "essay dibuka offline via kode darurat").
//
// PRINSIP: klaim client TIDAK PERNAH dipercaya mentah-mentah. Server tidak
// bisa membuktikan kapan persisnya sebuah kejadian terjadi saat device tidak
// terhubung -- yang bisa dilakukan server hanyalah membatasi klaim itu ke
// rentang yang MASUK AKAL, dan mencatat klaim mentahnya untuk diaudit guru/
// pengawas kalau perlu (lihat kolom pg_offline_audit / essay_amplop_offline).
//
// Pola ini sudah dipakai untuk waktuMulaiClient di essay/mulai/route.ts;
// modul ini mengekstraknya supaya dipakai juga untuk klaim waktu selesai PG
// (lihat selesai/route.ts) tanpa duplikasi logika.

export interface HasilKlaimWaktu {
  /** Waktu (ms epoch) yang dipakai server, sudah di-clamp. */
  waktuMs: number
  /** true kalau nilai klaim client di luar rentang wajar dan harus dicatat sebagai anomali untuk diaudit. */
  anomali: boolean
  /** Alasan singkat kalau anomali, untuk log/audit. */
  alasanAnomali?: string
}

const JEDA_MAKS_DEFAULT_MS = 3 * 60 * 60 * 1000 // 3 jam

/**
 * Membatasi klaim waktu client ke rentang [batasBawahMs, sekarangMs], dan
 * membatasi seberapa jauh klaim itu boleh berada di BELAKANG sekarang
 * (jedaMaksMs) supaya klaim yang jelas tidak masuk akal (mis. "3 hari lalu")
 * tidak diam-diam diterima sebagai timestamp resmi.
 */
export function klaimkanWaktu(
  klaimIso: string | null | undefined,
  batasBawahMs: number | null,
  sekarangMs: number = Date.now(),
  jedaMaksMs: number = JEDA_MAKS_DEFAULT_MS
): HasilKlaimWaktu {
  if (typeof klaimIso !== 'string') {
    return { waktuMs: sekarangMs, anomali: false }
  }
  const klaimMs = Date.parse(klaimIso)
  if (Number.isNaN(klaimMs)) {
    return { waktuMs: sekarangMs, anomali: true, alasanAnomali: 'klaim tidak bisa diparse' }
  }

  const bawah = batasBawahMs ?? klaimMs
  let hasil = Math.min(sekarangMs, Math.max(klaimMs, bawah))
  let anomali = false
  let alasan: string | undefined

  if (klaimMs > sekarangMs) {
    anomali = true
    alasan = 'klaim di masa depan, dipotong ke waktu sekarang'
  } else if (batasBawahMs !== null && klaimMs < batasBawahMs) {
    anomali = true
    alasan = 'klaim lebih awal dari batas bawah yang sah, dipotong'
  } else if (sekarangMs - klaimMs > jedaMaksMs) {
    // Klaim ada di dalam rentang yang sah, tapi jedanya sangat panjang
    // (mis. device baru online lagi berjam-jam kemudian). Ini bukan berarti
    // klaimnya salah -- offline bisa memang lama -- tapi dicatat sebagai
    // anomali supaya guru/pengawas bisa meninjau kalau perlu.
    anomali = true
    alasan = `jeda offline ${Math.round((sekarangMs - klaimMs) / 60000)} menit, melebihi ambang wajar`
    hasil = klaimMs // tetap pakai klaimnya, hanya ditandai untuk audit
  }

  return { waktuMs: hasil, anomali, alasanAnomali: alasan }
}
