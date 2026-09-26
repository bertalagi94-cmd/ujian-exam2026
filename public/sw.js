// PERBAIKAN AUDIT P1 #9 (Service Worker / App Shell) — REVISI 2:
// Versi sebelumnya HANYA menyimpan ke cache resource yang "kebetulan pernah
// diminta browser saat online" (network-first + cache fallback, TANPA
// precache saat install). Terbukti di lapangan (dites langsung di browser
// laptop DAN aplikasi Android): kalau guru menutup aplikasi lalu membukanya
// lagi saat jaringan benar-benar mati, halaman gagal dimuat total — padahal
// halaman itu 100% statis (`next build` menandainya "○ Static", tidak butuh
// server per-request).
//
// PERBAIKAN: sekarang ada tahap PRECACHE SUNGGUHAN saat Service Worker
// diinstal. Daftar URL yang di-precache dihasilkan otomatis tiap build oleh
// scripts/generate-precache-manifest.js → public/precache-manifest.json
// (baca komentar di file itu untuk detail & cara menambah rute baru).
//
// ATURAN PALING PENTING (tidak berubah dari versi sebelumnya):
// /api/* TIDAK PERNAH di-cache/disajikan dari cache. Service Worker BUKAN
// database jawaban — data ujian (soal, jawaban, sesi) tetap lewat
// IndexedDB/localStorage (lihat ujian-offline-storage.ts, pg-paket-offline.ts,
// ujian-outbox.ts), begitu juga data operasional mode-pengawas (kode reset,
// kode darurat, daftar siswa — lihat modul cache terpisah untuk itu). SW ini
// murni untuk JS/CSS/HTML shell supaya React app bisa BOOT saat offline.

const CACHE_PREFIX = 'ujian-app-shell'
const MANIFEST_URL = '/precache-manifest.json'

// Manifest diambil SEKALI per siklus hidup Service Worker lalu disimpan di
// memori (bukan di-fetch ulang di tiap event) — nama cache yang dipakai
// `install`, `activate`, dan `fetch` harus konsisten selama SW ini aktif.
let manifestPromise = null
function ambilManifest() {
  if (!manifestPromise) {
    manifestPromise = fetch(MANIFEST_URL, { cache: 'no-store' })
      .then((res) => res.json())
      .catch(() => {
        // Manifest tidak ada/rusak/gagal diambil (mis. deploy lama sebelum
        // perbaikan ini) — tetap jalan tanpa precache; runtime caching di
        // `fetch` tetap jadi jaring pengaman seperti versi sebelumnya.
        console.warn('[sw] Gagal mengambil precache-manifest.json — lanjut tanpa precache.')
        return { buildId: 'fallback', urls: [] }
      })
  }
  return manifestPromise
}

async function namaCacheAktif() {
  const manifest = await ambilManifest()
  return `${CACHE_PREFIX}-${manifest.buildId}`
}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const manifest = await ambilManifest()
    const cache = await caches.open(`${CACHE_PREFIX}-${manifest.buildId}`)

    // Precache satu-per-satu (BUKAN cache.addAll) supaya satu aset yang
    // gagal diambil tidak menggagalkan precache aset lain — addAll bersifat
    // all-or-nothing, dan itu terlalu rapuh untuk app-shell yang justru
    // dirancang untuk skenario darurat.
    await Promise.all((manifest.urls || []).map(async (url) => {
      try {
        const res = await fetch(url, { cache: 'no-store' })
        if (res.ok) await cache.put(url, res)
      } catch {
        console.warn(`[sw] Gagal precache: ${url}`)
      }
    }))

    // Aktifkan versi baru SEGERA — jangan tunggu semua tab lama ditutup.
    // Selaras dengan `clients.claim()` di `activate` di bawah.
    self.skipWaiting()
  })())
})

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const cacheName = await namaCacheAktif()
    const keys = await caches.keys()
    // Buang cache app-shell dari build sebelumnya (nama cache menyertakan
    // buildId, jadi ini otomatis membersihkan diri tiap ada deploy baru).
    await Promise.all(
      keys
        .filter((k) => k.startsWith(CACHE_PREFIX) && k !== cacheName)
        .map((k) => caches.delete(k))
    )
    await self.clients.claim()
  })())
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return

  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return
  // JANGAN PERNAH cache API — data ujian harus selalu request fresh ke
  // server saat online; saat offline, kode aplikasi sendiri (bukan SW) yang
  // bertanggung jawab jatuh ke IndexedDB/localStorage/cache data operasional
  // (lihat recoverActiveExam, pg-paket-offline.ts, ujian-outbox.ts, dan
  // modul cache mode-pengawas).
  if (url.pathname.startsWith('/api/')) return
  // Manifest-nya sendiri selalu diambil langsung dari network oleh Service
  // Worker (lihat `ambilManifest`) — tidak perlu lewat jalur cache di bawah.
  if (url.pathname === MANIFEST_URL) return

  event.respondWith((async () => {
    const cacheName = await namaCacheAktif()
    const cache = await caches.open(cacheName)

    // Sudah ada di precache (dari `install`)? Langsung pakai itu SEBELUM
    // coba network — untuk halaman yang di-precache, ini justru lebih cepat
    // & lebih pasti daripada network-first, dan tetap benar karena aset
    // Next.js sudah di-hash per build (kalaupun ada versi lebih baru, itu
    // menunggu deploy berikutnya yang buildId-nya beda → cache lama dibuang
    // otomatis di `activate`).
    const dariPrecache = await cache.match(request)
    if (dariPrecache) return dariPrecache

    try {
      const networkResponse = await fetch(request)
      if (networkResponse && networkResponse.ok) {
        cache.put(request, networkResponse.clone())
      }
      return networkResponse
    } catch (err) {
      const cached = await cache.match(request)
      if (cached) return cached
      throw err
    }
  })())
})
