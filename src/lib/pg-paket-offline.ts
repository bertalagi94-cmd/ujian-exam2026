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

// PERBAIKAN AUDIT P0 #3 (paket PG masih blob localStorage polos, tanpa
// checksum/version/readiness formal): envelope sekarang membawa `skema`
// (versi struktur, supaya perubahan bentuk data di masa depan bisa dideteksi
// dan tidak dipulihkan buta-buta) dan `checksum` (hash ringan atas isi
// `sesiInfo` — BUKAN untuk keamanan/anti-tamper, hanya untuk mendeteksi data
// yang korup/terpotong, mis. localStorage penuh di tengah `setItem`).
// `paketPgOfflineSiapDipakai()` memformalkan syarat "boleh dipakai untuk
// recovery": checksum cocok + field wajib (soalList, durasi, waktu_mulai)
// benar-benar ada, bukan sekadar "JSON.parse tidak melempar error".

const SKEMA_VERSI = 2

export interface PaketPgOfflineEnvelope<TSesiInfo> {
  skema: number
  sesiId: string
  nis: string
  disimpanIso: string
  checksum: string
  sesiInfo: TSesiInfo
}

function key(sesiId: string, nis: string): string {
  return `${PREFIX}:${sesiId}:${nis}`
}

/** Hash ringan (djb2) — cukup untuk deteksi korupsi, bukan kriptografi. */
function hitungChecksum(payload: string): string {
  let h = 5381
  for (let i = 0; i < payload.length; i++) {
    h = ((h << 5) + h + payload.charCodeAt(i)) >>> 0
  }
  return h.toString(36)
}

/**
 * Syarat FORMAL sebuah paket PG offline boleh dipakai recovery:
 *  1) skema dikenal,
 *  2) checksum cocok dengan isi sesiInfo saat ini (deteksi korupsi),
 *  3) field minimal yang recoverActiveExam() BUTUHKAN benar-benar ada.
 * Sebelumnya "valid" hanya berarti JSON.parse() tidak melempar error —
 * itu tidak menjamin datanya utuh/lengkap.
 */
export function paketPgOfflineSiapDipakai<TSesiInfo>(
  envelope: PaketPgOfflineEnvelope<TSesiInfo> | null
): envelope is PaketPgOfflineEnvelope<TSesiInfo> {
  if (!envelope) return false
  if (envelope.skema !== SKEMA_VERSI) return false
  if (hitungChecksum(JSON.stringify(envelope.sesiInfo)) !== envelope.checksum) return false
  const info = envelope.sesiInfo as unknown as {
    sesiId?: string
    durasi?: number
    waktu_mulai?: string
    soalList?: unknown[]
  }
  if (!info.sesiId || !info.waktu_mulai) return false
  if (typeof info.durasi !== 'number' || info.durasi <= 0) return false
  if (!Array.isArray(info.soalList)) return false
  return true
}

export function simpanPaketPgOffline<TSesiInfo extends { sesiId: string }>(
  nis: string,
  sesiInfo: TSesiInfo
): void {
  const sesiInfoJson = JSON.stringify(sesiInfo)
  const envelope: PaketPgOfflineEnvelope<TSesiInfo> = {
    skema: SKEMA_VERSI,
    sesiId: sesiInfo.sesiId,
    nis,
    disimpanIso: new Date().toISOString(),
    checksum: hitungChecksum(sesiInfoJson),
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
    if (!raw) return null
    const envelope = JSON.parse(raw) as PaketPgOfflineEnvelope<TSesiInfo>
    // FIX AUDIT P0 #3: dulu envelope apa pun yang berhasil di-parse dianggap
    // valid. Sekarang syarat formal (skema + checksum + field wajib) WAJIB
    // lolos, kalau tidak dianggap tidak ada (jangan pulihkan data korup).
    return paketPgOfflineSiapDipakai(envelope) ? envelope : null
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
        // FIX AUDIT P0 #3: jangan tawarkan paket yang gagal syarat formal
        // (skema tidak dikenal / checksum tidak cocok / field wajib hilang)
        // untuk recovery — sebelumnya cukup "JSON.parse berhasil".
        if (!paketPgOfflineSiapDipakai(parsed)) continue
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
