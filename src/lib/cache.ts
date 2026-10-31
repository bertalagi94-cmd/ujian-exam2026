/**
 * In-memory cache ringan untuk data yang jarang berubah.
 * Berjalan di dalam Node.js process — tidak perlu Redis.
 * TTL per-key, auto-expire, thread-safe (JS single-threaded).
 */

interface CacheEntry<T> {
  value: T
  expiresAt: number
}

const store = new Map<string, CacheEntry<unknown>>()

export function cacheGet<T>(key: string): T | null {
  const entry = store.get(key) as CacheEntry<T> | undefined
  if (!entry) return null
  if (Date.now() > entry.expiresAt) {
    store.delete(key)
    return null
  }
  return entry.value
}

// Sapu berkala: entri kedaluwarsa dulu hanya dihapus saat key yang sama dibaca
// lagi, jadi key unik (mis. kunci rate limit berisi username dari input
// pengguna) menumpuk selamanya di server yang hidup lama.
const MAKS_ENTRI = 20_000
const JEDA_SAPU_MS = 60_000
let sapuTerakhir = 0

function sapu(now: number): void {
  if (now - sapuTerakhir < JEDA_SAPU_MS && store.size <= MAKS_ENTRI) return
  sapuTerakhir = now
  store.forEach((entry, key) => {
    if (now > entry.expiresAt) store.delete(key)
  })
  if (store.size > MAKS_ENTRI) {
    let lebih = store.size - MAKS_ENTRI
    for (const key of Array.from(store.keys())) {
      if (lebih-- <= 0) break
      store.delete(key)
    }
  }
}

export function cacheSet<T>(key: string, value: T, ttlSeconds: number): void {
  const now = Date.now()
  sapu(now)
  store.set(key, { value, expiresAt: now + ttlSeconds * 1000 })
}

export function cacheDel(key: string): void {
  store.delete(key)
}

/** Hapus semua key yang cocok dengan prefix — pakai saat admin save pengaturan */
export function cacheDelPrefix(prefix: string): void {
  for (const key of store.keys()) {
    if (key.startsWith(prefix)) store.delete(key)
  }
}

/**
 * Helper: ambil dari cache, kalau miss jalankan fn() lalu simpan hasilnya.
 * Contoh:
 *   const data = await cachedFetch('pengaturan', 60, () => db.from(...))
 */
// Pengambilan yang sedang berjalan per key. Tanpa ini, saat cache kosong/kedaluwarsa
// SEMUA request yang tiba selama fn() belum selesai masing-masing menjalankan fn()
// sendiri (cache stampede) — mis. ratusan polling siswa serentak ke database untuk
// data yang sama. Sekarang mereka berbagi satu pengambilan.
const berjalan = new Map<string, Promise<unknown>>()

export async function cachedFetch<T>(
  key: string,
  ttlSeconds: number,
  fn: () => Promise<T>
): Promise<T> {
  const hit = cacheGet<T>(key)
  if (hit !== null) return hit
  const sedangBerjalan = berjalan.get(key) as Promise<T> | undefined
  if (sedangBerjalan) return sedangBerjalan
  const janji = (async () => {
    const value = await fn()
    cacheSet(key, value, ttlSeconds)
    return value
  })().finally(() => {
    berjalan.delete(key)
  })
  berjalan.set(key, janji)
  return janji
}
