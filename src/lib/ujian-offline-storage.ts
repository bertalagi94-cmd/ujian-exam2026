// Lapisan penyimpanan durable berbasis IndexedDB untuk data kritis ujian
// (BUG P0 #7/#8 pada audit): aset gambar dan health-check storage.
//
// Kenapa IndexedDB, bukan localStorage:
//  - localStorage synchronous & bisa memblokir main thread untuk payload besar
//  - localStorage quota kecil (~5MB) dan hanya string
//  - IndexedDB transactional, mendukung Blob native, quota jauh lebih besar
//
// Modul ini SENGAJA dibuat generik & berdiri sendiri (tidak bergantung pada
// React state) supaya bisa dipakai baik dari komponen React (GambarSoalOffline)
// maupun dari modul non-React (ujian-outbox.ts, boot recovery) tanpa membawa
// serta seluruh state halaman ujian.

const DB_NAME = 'ujian-offline-db'
const DB_VERSION = 1
export const STORE_ASSETS = 'assets'
export const STORE_HEALTHCHECK = 'healthcheck'

export type AssetStatus = 'ASSET_LOADING' | 'ASSET_READY' | 'ASSET_FAILED'

export interface AssetRecord {
  url: string
  blob: Blob
  mimeType: string
  size: number
  savedAtIso: string
  status: AssetStatus
}

function idbTersedia(): boolean {
  return typeof window !== 'undefined' && 'indexedDB' in window
}

let dbPromise: Promise<IDBDatabase> | null = null

function bukaDb(): Promise<IDBDatabase> {
  if (!idbTersedia()) return Promise.reject(new Error('IndexedDB tidak tersedia'))
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE_ASSETS)) {
        db.createObjectStore(STORE_ASSETS, { keyPath: 'url' })
      }
      if (!db.objectStoreNames.contains(STORE_HEALTHCHECK)) {
        db.createObjectStore(STORE_HEALTHCHECK)
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('Gagal membuka IndexedDB'))
  })
  return dbPromise
}

export async function simpanAsset(record: AssetRecord): Promise<void> {
  const db = await bukaDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_ASSETS, 'readwrite')
    tx.objectStore(STORE_ASSETS).put(record)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('Gagal menyimpan aset'))
  })
}

export async function ambilAsset(url: string): Promise<AssetRecord | null> {
  const db = await bukaDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_ASSETS, 'readonly')
    const req = tx.objectStore(STORE_ASSETS).get(url)
    req.onsuccess = () => resolve((req.result as AssetRecord | undefined) ?? null)
    req.onerror = () => reject(req.error ?? new Error('Gagal membaca aset'))
  })
}

export async function statusAsset(url: string): Promise<AssetStatus | 'UNKNOWN'> {
  try {
    const rec = await ambilAsset(url)
    return rec?.status ?? 'UNKNOWN'
  } catch {
    return 'UNKNOWN'
  }
}

/**
 * DETECT STORAGE FAILURE (BUG P0 #8): tulis lalu baca kembali kunci kecil.
 * Dipanggil sebelum ujian dimulai (gerbang START) — kalau gagal, jangan
 * izinkan ujian dimulai karena jawaban tidak akan bisa disimpan durable.
 * TIDAK boleh di-try/catch lalu diabaikan seperti pola lama.
 */
export async function healthCheckStorage(): Promise<{ ok: boolean; error?: string }> {
  if (!idbTersedia()) {
    return { ok: false, error: 'Browser ini tidak mendukung IndexedDB (mode privat ketat / browser lama).' }
  }
  try {
    const db = await bukaDb()
    const testKey = '__healthcheck__'
    const testVal = { t: Date.now() }
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_HEALTHCHECK, 'readwrite')
      tx.objectStore(STORE_HEALTHCHECK).put(testVal, testKey)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error ?? new Error('Gagal menulis health-check'))
    })
    const read = await new Promise<{ t: number } | undefined>((resolve, reject) => {
      const tx = db.transaction(STORE_HEALTHCHECK, 'readonly')
      const req = tx.objectStore(STORE_HEALTHCHECK).get(testKey)
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error ?? new Error('Gagal membaca health-check'))
    })
    if (!read || read.t !== testVal.t) {
      return { ok: false, error: 'Penyimpanan lokal tidak konsisten (tulis berhasil tapi baca gagal).' }
    }
    // Sekalian cek localStorage kecil-kecilan (dipakai untuk flag non-kritis
    // & backup jawaban lama) — kalau ini gagal juga, storage device memang
    // penuh/diblokir total.
    try {
      localStorage.setItem('__ujian_storage_healthcheck__', '1')
      localStorage.removeItem('__ujian_storage_healthcheck__')
    } catch {
      return { ok: false, error: 'localStorage penuh atau diblokir (mode privat).' }
    }
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Penyimpanan lokal tidak dapat diakses.' }
  }
}
