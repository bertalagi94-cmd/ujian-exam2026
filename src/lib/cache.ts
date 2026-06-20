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

export function cacheSet<T>(key: string, value: T, ttlSeconds: number): void {
  store.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 })
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
export async function cachedFetch<T>(
  key: string,
  ttlSeconds: number,
  fn: () => Promise<T>
): Promise<T> {
  const hit = cacheGet<T>(key)
  if (hit !== null) return hit
  const value = await fn()
  cacheSet(key, value, ttlSeconds)
  return value
}
