// Precache gambar soal (PG & essay) ke IndexedDB (lihat ujian-offline-storage.ts),
// supaya gambar tetap tampil walau internet mati.
//
// PERBAIKAN AUDIT (P0 #4, #5, #6):
//  - #4: precacheGambarSoal() DULU dipanggil dengan `void ...` (fire-and-forget),
//    sekarang mengembalikan Promise yang WAJIB ditunggu (`await`) oleh pemanggil
//    sebelum mengizinkan siswa mulai mengerjakan. Hasilnya berupa ringkasan
//    manifest (berapa sukses, berapa gagal) supaya pemanggil bisa memutuskan
//    START / retry / tampilkan error.
//  - #5: TIDAK ADA LAGI fallback diam-diam ke internet saat offline. Kalau
//    aset tidak ada di IndexedDB dan browser sedang offline, pemanggil (lihat
//    GambarSoalOffline.tsx) akan menampilkan status error eksplisit, bukan
//    mencoba fetch ke Supabase.
//  - #6: modul ini tidak pernah "menyembunyikan" kegagalan; setiap kegagalan
//    per-URL dicatat di `status` (ASSET_FAILED) sehingga terlihat oleh UI.
//
// Cache API (versi lama modul ini) sengaja diganti dengan IndexedDB supaya
// selaras dengan gudang data durable lain (lihat ujian-offline-storage.ts) dan
// supaya statusnya bisa diperiksa secara sinkron-terhadap-manifest (bukan
// hanya "ada/tidak ada").

import { ambilAsset, simpanAsset, type AssetStatus } from './ujian-offline-storage'

export interface HasilPrecache {
  total: number
  berhasil: number
  gagal: string[]
  /** true kalau SEMUA url berhasil diunduh & tervalidasi — dipakai sebagai START gate. */
  siap: boolean
}

function isOnline(): boolean {
  return typeof navigator === 'undefined' || navigator.onLine !== false
}

/**
 * Unduh & simpan semua URL gambar yang diberikan ke IndexedDB. WAJIB di-`await`
 * oleh pemanggil sebelum ujian dianggap READY (lihat BUG P0 #3/#4) — jangan
 * lagi dipanggil dengan `void`.
 *
 * URL yang sudah ada di penyimpanan lokal (ASSET_READY) dilewati, tidak
 * diunduh ulang. Aman dipanggil berkali-kali/retry.
 */
export async function precacheGambarSoal(
  urls: (string | null | undefined)[]
): Promise<HasilPrecache> {
  const unik = Array.from(new Set(urls.filter((u): u is string => !!u)))
  if (unik.length === 0) return { total: 0, berhasil: 0, gagal: [], siap: true }

  if (!isOnline()) {
    // Offline sejak awal: tidak ada gunanya mencoba fetch, cukup laporkan
    // mana yang sudah ada di penyimpanan lokal dari sesi sebelumnya.
    let berhasil = 0
    const gagal: string[] = []
    for (const url of unik) {
      const rec = await ambilAsset(url).catch(() => null)
      if (rec?.status === 'ASSET_READY') berhasil++
      else gagal.push(url)
    }
    return { total: unik.length, berhasil, gagal, siap: gagal.length === 0 }
  }

  const gagal: string[] = []
  let berhasil = 0

  await Promise.all(
    unik.map(async (url) => {
      try {
        const existing = await ambilAsset(url).catch(() => null)
        if (existing?.status === 'ASSET_READY' && existing.blob.size > 0) {
          berhasil++
          return
        }
        // no-store: kita sendiri yang mengatur penyimpanan durable-nya lewat
        // IndexedDB, tidak perlu double-cache lewat HTTP cache browser.
        const res = await fetch(url, { cache: 'no-store' })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const blob = await res.blob()
        if (blob.size === 0) throw new Error('Berkas kosong')
        await simpanAsset({
          url,
          blob,
          mimeType: blob.type || 'application/octet-stream',
          size: blob.size,
          savedAtIso: new Date().toISOString(),
          status: 'ASSET_READY',
        })
        berhasil++
      } catch {
        // Satu gambar gagal tidak boleh menggagalkan gambar lain — dicatat
        // sebagai gagal (BUKAN diam-diam disembunyikan, lihat BUG P0 #6),
        // pemanggil yang memutuskan apakah ini memblokir START.
        gagal.push(url)
      }
    })
  )

  return { total: unik.length, berhasil, gagal, siap: gagal.length === 0 }
}

/**
 * Ambil kembali gambar dari IndexedDB sebagai object URL untuk dipakai di
 * elemen <img src=...>. Mengembalikan null kalau tidak ada di penyimpanan
 * lokal — pemanggil (GambarSoalOffline.tsx) yang memutuskan apakah boleh
 * jatuh ke jaringan (HANYA kalau online, lihat BUG P0 #5).
 */
export async function ambilGambarDariCache(url: string | null | undefined): Promise<string | null> {
  if (!url) return null
  try {
    const rec = await ambilAsset(url)
    if (!rec || rec.status !== 'ASSET_READY') return null
    return URL.createObjectURL(rec.blob)
  } catch {
    return null
  }
}

export async function statusGambar(url: string | null | undefined): Promise<AssetStatus | 'UNKNOWN'> {
  if (!url) return 'UNKNOWN'
  try {
    const rec = await ambilAsset(url)
    return rec?.status ?? 'UNKNOWN'
  } catch {
    return 'UNKNOWN'
  }
}

export { isOnline as gambarOfflineIsOnline }
