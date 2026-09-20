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

/** Dipanggil dari apiRequest() setiap response berhasil di-fetch. */
export function registerServerDate(dateHeaderValue: string | null | undefined): void {
  if (!dateHeaderValue) return
  const serverMs = Date.parse(dateHeaderValue)
  if (Number.isNaN(serverMs)) return
  offsetMs = serverMs - Date.now()
  terkalibrasi = true
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
 * sisa waktu ujian (timer PG & Essay). Sebelum kalibrasi pertama terjadi
 * (mis. baru buka halaman, belum ada request apapun), offsetMs = 0 sehingga
 * perilakunya identik dengan Date.now() biasa — tidak ada regresi untuk
 * kasus normal.
 */
export function trustedNow(): number {
  return Date.now() + offsetMs
}
