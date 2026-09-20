// PERBAIKAN AUDIT P1 #9 (Service Worker / App Shell):
// Sebelumnya cache gambar (Cache API/IndexedDB) TIDAK sama dengan offline
// application — kalau browser di-refresh saat offline, browser tetap butuh
// JS/CSS/chunks Next.js untuk boot ulang React app, dan itu tidak pernah
// disimpan di mana pun.
//
// Strategi yang dipilih SENGAJA konservatif (network-first + cache
// fallback, runtime caching, TANPA precache saat install): Next.js
// menghasilkan nama file _next/static/chunks/*.js dengan hash yang berubah
// tiap build, jadi tidak bisa ditebak/precache saat install tanpa tooling
// build-time (mis. next-pwa/workbox-webpack-plugin) yang belum ada di
// project ini. Sebagai gantinya, SW ini menyimpan ke cache SETIAP resource
// GET yang benar-benar diminta browser selama online (termasuk halaman
// ujian & seluruh chunk JS/CSS-nya) — begitu siswa pernah membuka halaman
// ujian sekali secara online, app-shell-nya otomatis tersimpan dan bisa
// dipakai lagi kalau refresh terjadi saat offline.
//
// ATURAN PALING PENTING: /api/* TIDAK PERNAH di-cache/disajikan dari cache.
// Service Worker BUKAN database jawaban (lihat catatan arsitektur di audit)
// — data ujian (soal, jawaban, sesi) tetap lewat IndexedDB/localStorage
// (lihat ujian-offline-storage.ts, pg-paket-offline.ts), SW ini murni untuk
// JS/CSS/HTML shell supaya React app bisa BOOT saat offline.

const CACHE_NAME = 'ujian-app-shell-v1'

self.addEventListener('install', () => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return

  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return
  // JANGAN PERNAH cache API — data ujian harus selalu request fresh ke
  // server saat online; saat offline, kode aplikasi sendiri (bukan SW) yang
  // bertanggung jawab jatuh ke IndexedDB/localStorage (lihat
  // recoverActiveExam, pg-paket-offline.ts, ujian-outbox.ts).
  if (url.pathname.startsWith('/api/')) return

  event.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => {
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
    })
  )
})
