// PERBAIKAN AUDIT P1 #14 (Timer): sebelumnya timer PG/Essay menghitung sisa
// waktu murni dari `Date.now()` client dibandingkan `waktu_mulai` (absolut
// dari server) — BENAR untuk drift/throttle tab (lihat FIX BUG #1 di
// timer effect page.tsx), TAPI tetap rentan kalau siswa MEMAJUKAN/
// MEMUNDURKAN JAM PERANGKATNYA SENDIRI: `Date.now()` client langsung ikut
// bergeser, jadi sisa waktu yang ditampilkan (dan dipakai untuk memutuskan
// kapan auto-submit) ikut salah.
//
// Modul ini menghitung:
//   serverClientOffset = serverTimestamp - clientTimestamp
//   trustedNow()        = Date.now() + serverClientOffset
//
// `serverTimestamp` diambil GRATIS dari header `Date` setiap response HTTP
// yang sudah ada (tidak perlu endpoint baru) — lihat pemanggilan
// registerServerDate() di dalam apiRequest() (src/lib/utils.ts). Setiap kali
// ujian melakukan request apapun ke server (sync, validasi, dsb — yang
// memang sudah sering terjadi selama ujian berlangsung), offset ikut
// dikalibrasi ulang, jadi ikut mengoreksi jam sistem client yang dimanipulasi
// SELAMA masih ada request yang sukses ke server.
//
// KETERBATASAN (didokumentasikan, bukan disembunyikan): perhitungan ini
// mengabaikan latensi round-trip request (server time dianggap = waktu
// respons diterima), jadi presisinya di kisaran detik, bukan milidetik —
// cukup untuk mencegah manipulasi jam kasar (mis. mundur berjam-jam), TIDAK
// dimaksudkan sebagai pengganti NTP presisi tinggi. Server (route
// /api/siswa/ujian/selesai dkk) TETAP jadi otoritas final atas waktu; nilai
// ini hanya untuk menampilkan/menghitung sisa waktu di client seakurat
// mungkin sebelum request final terjadi.

let offsetMs = 0
let terkalibrasi = false

// ── Ketahanan terhadap pemundur jam (audit "deadline / client time") ─────────
// Offset saja rentan: siswa yang OFFLINE lalu memundurkan jam perangkat membuat
// Date.now() (dan trustedNow = Date.now() + offset) ikut mundur -- timer
// bertambah, dan waktu jawaban yang dicap client tampak "sebelum deadline".
// Tiga sumber waktu dipakai dan trustedNow() mengambil YANG TERBESAR:
//   1) wall   = Date.now() + offsetMs        (perilaku lama; benar saat tidur/sleep)
//   2) mono   = jangkarServer + (performance.now() - jangkarPerf)
//               performance.now() monotonik: TIDAK ikut berubah saat jam sistem
//               dimundurkan selama halaman terbuka
//   3) hwm    = titik tertinggi yang pernah dilaporkan (di-persist di
//               localStorage) -- menahan pemundur jam yang disertai reload
// Memajukan jam hanya merugikan siswa itu sendiri (sisa waktu tampak lebih
// sedikit). Keterbatasan (jujur): menghapus data situs menghapus hwm; server
// tetap otoritas akhir (lihat src/lib/deadline-pg.ts).
const KUNCI_HWM = 'ujian_trusted_hwm'
const TOLERANSI_JANGKAR_MS = 2_000 // presisi header Date = 1 detik; jangan goyah karenanya
const BATAS_RESET_HWM_MS = 2 * 60_000 // server jauh di bawah hwm = hwm keracunan, percaya server

let jangkarPerf: number | null = null
let jangkarServerMs = 0
let hwmMs = 0
let hwmTerakhirDisimpan = 0

function bacaHwmAwal(): number {
  try {
    if (typeof localStorage === 'undefined') return 0
    const v = Number(localStorage.getItem(KUNCI_HWM))
    return Number.isFinite(v) && v > 0 ? v : 0
  } catch {
    return 0
  }
}
hwmMs = bacaHwmAwal()

function perfSekarang(): number | null {
  return typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : null
}

function estimasiMonotonik(): number | null {
  const p = perfSekarang()
  if (p === null || jangkarPerf === null) return null
  return jangkarServerMs + (p - jangkarPerf)
}

/** Dipanggil dari apiRequest() setiap response berhasil di-fetch. */
export function registerServerDate(dateHeaderValue: string | null | undefined): void {
  if (!dateHeaderValue) return
  const serverMs = Date.parse(dateHeaderValue)
  if (Number.isNaN(serverMs)) return
  offsetMs = serverMs - Date.now()
  terkalibrasi = true

  // hwm keracunan (mis. jam perangkat pernah dimajukan jauh): server menang.
  if (hwmMs > serverMs + BATAS_RESET_HWM_MS) hwmMs = serverMs

  // Jangkar monotonik hanya digeser kalau server MAJU dari estimasi kita
  // (kita tertinggal), belum ada jangkar, atau jauh menyimpang. Selisih kecil
  // ke bawah = noise presisi header Date, diabaikan agar timer tidak "macet" tiap
  // kalibrasi.
  const mono = estimasiMonotonik()
  const p = perfSekarang()
  if (p !== null && (mono === null || serverMs > mono || serverMs < mono - TOLERANSI_JANGKAR_MS - BATAS_RESET_HWM_MS)) {
    jangkarPerf = p
    jangkarServerMs = serverMs
  }
}

/** true kalau sudah pernah dapat minimal satu kalibrasi dari server. */
export function sudahTerkalibrasi(): boolean {
  return terkalibrasi
}

export function getServerClientOffsetMs(): number {
  return offsetMs
}

/**
 * Waktu "terpercaya" — dipakai MENGGANTIKAN Date.now() di semua perhitungan
 * sisa waktu ujian (timer PG & Essay) dan untuk mencap waktu jawaban. Tidak
 * pernah mundur (lihat penjelasan di atas). Sebelum kalibrasi pertama (offset=0,
 * belum ada jangkar) perilakunya identik dengan Date.now() biasa.
 */
export function trustedNow(): number {
  const wall = Date.now() + offsetMs
  const mono = estimasiMonotonik()
  let hasil = mono !== null && mono > wall ? mono : wall
  if (hasil < hwmMs) hasil = hwmMs
  if (hasil > hwmMs) {
    hwmMs = hasil
    // Simpan paling sering tiap 5 detik -- trustedNow() dipanggil tiap tick timer.
    if (hasil - hwmTerakhirDisimpan > 5_000) {
      hwmTerakhirDisimpan = hasil
      try { if (typeof localStorage !== 'undefined') localStorage.setItem(KUNCI_HWM, String(hasil)) } catch { /* penyimpanan penuh/dimatikan: abaikan */ }
    }
  }
  return hasil
}

/** Khusus pengujian: kembalikan keadaan modul ke awal. */
export function _resetClockUntukUji(): void {
  offsetMs = 0; terkalibrasi = false; jangkarPerf = null; jangkarServerMs = 0; hwmMs = 0; hwmTerakhirDisimpan = 0
}

/** Khusus pengujian: meniru reload halaman (state memori hilang, localStorage tetap). */
export function _simulasiReloadUntukUji(): void {
  offsetMs = 0; terkalibrasi = false; jangkarPerf = null; jangkarServerMs = 0; hwmTerakhirDisimpan = 0
  hwmMs = bacaHwmAwal()
}
