// PERBAIKAN AUDIT P0 #1 & #3: sebelumnya paket soal PG (soalList, durasi,
// waktu_mulai, dst — yaitu SesiInfo di siswa/ujian/page.tsx) HANYA hidup di
// React state, tidak pernah dipersist ke penyimpanan lokal. Kalau browser
// di-refresh saat offline, tidak ada cara memulihkan soal PG sama sekali
// (recovery yang ada sebelumnya, pulihkanEssayOffline(), hanya menangani
// Essay lewat amplop terenkripsi).
//
// Modul ini menyimpan snapshot SesiInfo (paket ujian PG) begitu siswa masuk
// ujian (lihat pemanggilan simpanPaketPgOffline setelah setSesiInfo di
// handleMasukUjian/handleVerifikasiReset), supaya recoverActiveExam() bisa
// memulihkan soal + konfigurasi + timer TANPA bergantung pada
// /api/siswa/jadwal maupun /api/siswa/ujian/validasi.
//
// CATATAN ARSITEKTUR: ini sengaja disimpan sebagai satu blob JSON per sesi
// (bukan dipecah ke banyak baris IndexedDB) karena soalList sekali diambil
// bersifat statis untuk satu sesi/device (server adalah otoritas nilai —
// paket ini tidak pernah dipakai untuk grading, hanya untuk menampilkan
// ulang soal ke siswa saat offline).

const PREFIX = 'pgPaketOffline:v1'
/** Sesi yang sudah lebih tua dari ini tidak lagi ditawarkan untuk resume — */
/** mencegah "membangkitkan" sisa ujian hari lain yang seharusnya sudah usai. */
const BATAS_USIA_MS = 24 * 60 * 60 * 1000

export interface PaketPgOfflineEnvelope<TSesiInfo> {
  sesiId: string
  nis: string
  disimpanIso: string
  sesiInfo: TSesiInfo
}

function key(sesiId: string, nis: string): string {
  return `${PREFIX}:${sesiId}:${nis}`
}

export function simpanPaketPgOffline<TSesiInfo extends { sesiId: string }>(
  nis: string,
  sesiInfo: TSesiInfo
): void {
  const envelope: PaketPgOfflineEnvelope<TSesiInfo> = {
    sesiId: sesiInfo.sesiId,
    nis,
    disimpanIso: new Date().toISOString(),
    sesiInfo,
  }
  try {
    localStorage.setItem(key(sesiInfo.sesiId, nis), JSON.stringify(envelope))
  } catch {
    // Storage penuh/diblokir — recoverActiveExam() nanti tidak akan
    // menemukan paket ini. Ini terdeteksi lewat healthCheckStorage() yang
    // WAJIB dijalankan sebelum START (lihat BUG P0 #7/#8), bukan di sini.
  }
}

export function ambilPaketPgOffline<TSesiInfo>(
  sesiId: string,
  nis: string
): PaketPgOfflineEnvelope<TSesiInfo> | null {
  try {
    const raw = localStorage.getItem(key(sesiId, nis))
    return raw ? (JSON.parse(raw) as PaketPgOfflineEnvelope<TSesiInfo>) : null
  } catch {
    return null
  }
}

export function hapusPaketPgOffline(sesiId: string, nis: string): void {
  try {
    localStorage.removeItem(key(sesiId, nis))
  } catch {
    // abaikan
  }
}

/**
 * Cari paket PG offline TERBARU milik satu NIS (dipakai recoverActiveExam
 * saat /api/siswa/jadwal gagal karena jaringan dan kita belum tahu sesiId
 * mana yang aktif). Mengembalikan null kalau tidak ada, atau semuanya sudah
 * kedaluwarsa (lihat BATAS_USIA_MS).
 */
export function cariPaketPgOfflineTerbaru<TSesiInfo>(
  nis: string
): PaketPgOfflineEnvelope<TSesiInfo> | null {
  let terbaik: PaketPgOfflineEnvelope<TSesiInfo> | null = null
  let terbaikMs = -Infinity
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (!k || !k.startsWith(`${PREFIX}:`)) continue
      if (!k.endsWith(`:${nis}`)) continue
      try {
        const raw = localStorage.getItem(k)
        if (!raw) continue
        const parsed = JSON.parse(raw) as PaketPgOfflineEnvelope<TSesiInfo>
        const ms = Date.parse(parsed.disimpanIso)
        if (Number.isNaN(ms) || Date.now() - ms > BATAS_USIA_MS) continue
        if (ms > terbaikMs) { terbaik = parsed; terbaikMs = ms }
      } catch {
        // entri korup — lewati, jangan sampai mematikan pencarian yang lain
      }
    }
  } catch {
    return null
  }
  return terbaik
}
