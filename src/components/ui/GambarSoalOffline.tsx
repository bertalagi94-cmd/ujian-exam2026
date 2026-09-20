'use client'

// Pengganti drop-in untuk <img src={gambar_url}> di soal PG & essay.
//
// PERBAIKAN AUDIT (P0 #5, #6):
//  - #5: dulu kalau cache lokal kosong, komponen ini diam-diam jatuh ke
//    `src` asli (URL Supabase) APAPUN kondisi jaringannya. Saat offline itu
//    pasti gagal. Sekarang: kalau `navigator.onLine === false` dan aset
//    tidak ada di penyimpanan lokal (IndexedDB), komponen TIDAK mencoba
//    jaringan sama sekali — langsung tampilkan status error eksplisit.
//  - #6: dulu `onError` menyembunyikan elemen (`display:none`) — berbahaya
//    untuk soal yang merujuk gambar ("Perhatikan gambar berikut..."). Sekarang
//    kegagalan selalu tampil sebagai kotak "Aset gambar belum tersedia" +
//    tombol coba lagi, gambar TIDAK PERNAH hilang tanpa jejak.
//
// Catatan: gambar seharusnya sudah READY sebelum ujian START (lihat
// precacheGambarSoal, dipakai sebagai gerbang START). Jalur error di sini
// adalah safety-net, bukan alur normal.

import { useCallback, useEffect, useState } from 'react'
import { ambilGambarDariCache, precacheGambarSoal, gambarOfflineIsOnline } from '@/lib/gambar-offline'

interface Props {
  src: string
  alt: string
  className?: string
  style?: React.CSSProperties
}

type Tahap = 'memuat' | 'siap' | 'error'

export function GambarSoalOffline({ src, alt, className, style }: Props) {
  const [objectUrl, setObjectUrl] = useState<string | null>(null)
  const [tahap, setTahap] = useState<Tahap>('memuat')
  const [retryKey, setRetryKey] = useState(0)

  const muat = useCallback(async (): Promise<() => void> => {
    setTahap('memuat')
    setObjectUrl(null)
    const dariCache = await ambilGambarDariCache(src)
    if (dariCache) {
      setObjectUrl(dariCache)
      setTahap('siap')
      return () => URL.revokeObjectURL(dariCache)
    }

    // Tidak ada di penyimpanan lokal. HANYA coba jaringan kalau memang
    // online — kalau offline, jangan pernah mencoba (BUG P0 #5).
    if (!gambarOfflineIsOnline()) {
      setTahap('error')
      return () => {}
    }

    // Online tapi belum sempat ter-precache (mis. soal baru dibuka pertama
    // kali) — coba unduh sekarang juga sebagai safety-net, lalu ambil lagi
    // dari penyimpanan lokal supaya konsisten dengan jalur normal.
    const hasil = await precacheGambarSoal([src])
    if (hasil.berhasil > 0) {
      const setelahUnduh = await ambilGambarDariCache(src)
      if (setelahUnduh) {
        setObjectUrl(setelahUnduh)
        setTahap('siap')
        return () => URL.revokeObjectURL(setelahUnduh)
      }
    }
    setTahap('error')
    return () => {}
  }, [src])

  useEffect(() => {
    let batal = false
    let cleanup: (() => void) | null = null
    muat().then((fn) => {
      if (batal) { fn(); return }
      cleanup = fn
    })
    return () => {
      batal = true
      if (cleanup) cleanup()
    }
  }, [muat, retryKey])

  if (tahap === 'memuat') {
    return (
      <div
        className={className}
        style={{ ...style, display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 80, background: '#f1f5f9', color: '#64748b', fontSize: 13 }}
        role="status"
      >
        Memuat gambar…
      </div>
    )
  }

  if (tahap === 'error') {
    return (
      <div
        className={className}
        style={{ ...style, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, minHeight: 100, background: '#fef2f2', border: '1px dashed #fca5a5', color: '#b91c1c', fontSize: 13, padding: 12, textAlign: 'center' }}
        role="alert"
      >
        <span>Aset gambar belum tersedia{gambarOfflineIsOnline() ? '' : ' (sedang offline)'}.</span>
        <button
          type="button"
          onClick={() => setRetryKey((k) => k + 1)}
          style={{ border: '1px solid #b91c1c', borderRadius: 6, padding: '4px 10px', fontSize: 12, background: 'white' }}
        >
          Coba lagi
        </button>
      </div>
    )
  }

  return (
    <img
      src={objectUrl ?? src}
      alt={alt}
      className={className}
      style={style}
      onError={() => setTahap('error')}
    />
  )
}
