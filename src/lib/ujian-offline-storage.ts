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
// FIX P0 #1 (antrean pelanggaran offline): dinaikkan dari 2 → 3 untuk
// menambah object store STORE_PELANGGARAN, supaya event anti-cheat yang
// gagal terkirim (sebelumnya hanya console.warn dan HILANG, lihat
// pelanggaran-outbox.ts) punya tempat penyimpanan durable sendiri, terpisah
// dari STORE_OUTBOX (paket PG/Essay) supaya tidak ada campur jenis data saat
// membaca "semua nilai" dari satu store. IndexedDB akan memanggil
// onupgradeneeded otomatis untuk browser yang masih di versi lama.
// FIX P0 (audit reset offline R1/R2/R3): dinaikkan dari 3 → 4 untuk
// menambah dua object store baru — STORE_RESET_MATERIAL (amplop terenkripsi
// R1/R2/R3 per sesi+nis, disimpan sejak masuk ujian) dan STORE_RESET_PENDING
// (antrean kejadian reset yang berhasil diverifikasi OFFLINE, menunggu
// direkonsiliasi ke server begitu online kembali). Lihat reset-offline-client.ts.
const DB_VERSION = 4
export const STORE_ASSETS = 'assets'
export const STORE_HEALTHCHECK = 'healthcheck'
export const STORE_OUTBOX = 'outbox'
export const STORE_PELANGGARAN = 'pelanggaran_outbox'
export const STORE_RESET_MATERIAL = 'reset_material'
export const STORE_RESET_PENDING = 'reset_pending'

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
      if (!db.objectStoreNames.contains(STORE_OUTBOX)) {
        db.createObjectStore(STORE_OUTBOX)
      }
      if (!db.objectStoreNames.contains(STORE_PELANGGARAN)) {
        db.createObjectStore(STORE_PELANGGARAN)
      }
      if (!db.objectStoreNames.contains(STORE_RESET_MATERIAL)) {
        db.createObjectStore(STORE_RESET_MATERIAL)
      }
      if (!db.objectStoreNames.contains(STORE_RESET_PENDING)) {
        db.createObjectStore(STORE_RESET_PENDING)
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

// ── FIX AUDIT P0 #7 (migrasi bertahap ke IndexedDB, tahap 1: outbox) ───────
// KV generik di atas STORE_OUTBOX. Sengaja generik (bukan mengimpor tipe
// dari ujian-outbox.ts) supaya modul storage ini tetap berdiri sendiri dan
// tidak membentuk dependency melingkar; ujian-outbox.ts yang tahu bentuk
// datanya (PaketUjianTertunda) lewat generic <T> di sini.
//
// Key dipakai APA ADANYA dari pemanggil (sama seperti storageKey() lama di
// ujian-outbox.ts: `${PREFIX}:${sesiId}:${nis}`) supaya data yang sudah
// bermigrasi dari localStorage tetap konsisten penamaannya.

export async function outboxPut<T>(key: string, value: T): Promise<void> {
  const db = await bukaDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_OUTBOX, 'readwrite')
    tx.objectStore(STORE_OUTBOX).put(value, key)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('Gagal menyimpan entri outbox'))
  })
}

export async function outboxGet<T>(key: string): Promise<T | null> {
  const db = await bukaDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_OUTBOX, 'readonly')
    const req = tx.objectStore(STORE_OUTBOX).get(key)
    req.onsuccess = () => resolve((req.result as T | undefined) ?? null)
    req.onerror = () => reject(req.error ?? new Error('Gagal membaca entri outbox'))
  })
}

export async function outboxDelete(key: string): Promise<void> {
  const db = await bukaDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_OUTBOX, 'readwrite')
    tx.objectStore(STORE_OUTBOX).delete(key)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('Gagal menghapus entri outbox'))
  })
}

/** Semua key yang tersimpan di store outbox saat ini. */
export async function outboxGetAllKeys(): Promise<string[]> {
  const db = await bukaDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_OUTBOX, 'readonly')
    const req = tx.objectStore(STORE_OUTBOX).getAllKeys()
    req.onsuccess = () => resolve((req.result as IDBValidKey[]).map(String))
    req.onerror = () => reject(req.error ?? new Error('Gagal membaca daftar key outbox'))
  })
}

/** Semua value yang tersimpan di store outbox saat ini. */
export async function outboxGetAllValues<T>(): Promise<T[]> {
  const db = await bukaDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_OUTBOX, 'readonly')
    const req = tx.objectStore(STORE_OUTBOX).getAll()
    req.onsuccess = () => resolve((req.result as T[]) ?? [])
    req.onerror = () => reject(req.error ?? new Error('Gagal membaca isi outbox'))
  })
}

// ── FIX P0 #1 (antrean pelanggaran offline) ─────────────────────────────────
// KV generik yang sama persis polanya dengan STORE_OUTBOX di atas, tapi di
// object store TERPISAH (STORE_PELANGGARAN) supaya pelanggaran-outbox.ts bisa
// membaca "semua nilai miliknya" tanpa bercampur dengan PaketUjianTertunda.
// Lihat src/lib/pelanggaran-outbox.ts untuk bentuk datanya.

export async function pelanggaranQueuePut<T>(key: string, value: T): Promise<void> {
  const db = await bukaDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_PELANGGARAN, 'readwrite')
    tx.objectStore(STORE_PELANGGARAN).put(value, key)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('Gagal menyimpan antrean pelanggaran'))
  })
}

export async function pelanggaranQueueDelete(key: string): Promise<void> {
  const db = await bukaDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_PELANGGARAN, 'readwrite')
    tx.objectStore(STORE_PELANGGARAN).delete(key)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('Gagal menghapus antrean pelanggaran'))
  })
}

/** Semua value yang tersimpan di antrean pelanggaran saat ini. */
export async function pelanggaranQueueGetAllValues<T>(): Promise<T[]> {
  const db = await bukaDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_PELANGGARAN, 'readonly')
    const req = tx.objectStore(STORE_PELANGGARAN).getAll()
    req.onsuccess = () => resolve((req.result as T[]) ?? [])
    req.onerror = () => reject(req.error ?? new Error('Gagal membaca antrean pelanggaran'))
  })
}

// ── P0 (reset offline R1/R2/R3) — dua store, KV generik sama seperti di
// atas: STORE_RESET_MATERIAL menyimpan amplop terenkripsi (dibaca berkali-
// kali, tidak pernah dihapus sampai sesi selesai), STORE_RESET_PENDING
// menyimpan kejadian reset yang berhasil diverifikasi OFFLINE dan menunggu
// direkonsiliasi ke server. Lihat src/lib/reset-offline-client.ts.

export async function resetMaterialPut<T>(key: string, value: T): Promise<void> {
  const db = await bukaDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_RESET_MATERIAL, 'readwrite')
    tx.objectStore(STORE_RESET_MATERIAL).put(value, key)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('Gagal menyimpan material reset'))
  })
}

export async function resetMaterialGet<T>(key: string): Promise<T | null> {
  const db = await bukaDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_RESET_MATERIAL, 'readonly')
    const req = tx.objectStore(STORE_RESET_MATERIAL).get(key)
    req.onsuccess = () => resolve((req.result as T | undefined) ?? null)
    req.onerror = () => reject(req.error ?? new Error('Gagal membaca material reset'))
  })
}

export async function resetPendingPut<T>(key: string, value: T): Promise<void> {
  const db = await bukaDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_RESET_PENDING, 'readwrite')
    tx.objectStore(STORE_RESET_PENDING).put(value, key)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('Gagal menyimpan antrean reset'))
  })
}

export async function resetPendingDelete(key: string): Promise<void> {
  const db = await bukaDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_RESET_PENDING, 'readwrite')
    tx.objectStore(STORE_RESET_PENDING).delete(key)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('Gagal menghapus antrean reset'))
  })
}

/** Semua value yang tersimpan di antrean reset offline saat ini. */
export async function resetPendingGetAllValues<T>(): Promise<T[]> {
  const db = await bukaDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_RESET_PENDING, 'readonly')
    const req = tx.objectStore(STORE_RESET_PENDING).getAll()
    req.onsuccess = () => resolve((req.result as T[]) ?? [])
    req.onerror = () => reject(req.error ?? new Error('Gagal membaca antrean reset'))
  })
}
