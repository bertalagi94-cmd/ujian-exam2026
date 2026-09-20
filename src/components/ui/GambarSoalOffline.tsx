'use client'

// Pengganti drop-in untuk <img src={gambar_url}> di soal PG & essay. Coba
// ambil dari Cache API dulu (lihat src/lib/gambar-offline.ts) — kalau ada,
// dipakai langsung sehingga tetap tampil walau offline. Kalau tidak ada di
// cache (mis. precache belum sempat selesai, atau baru online lagi dan
// belum sempat prefetch), jatuh ke `src` asli seperti sebelumnya — perilaku
// TIDAK berubah untuk siswa yang koneksinya baik-baik saja.

import { useEffect, useState } from 'react'
import { ambilGambarDariCache } from '@/lib/gambar-offline'

interface Props {
  src: string
  alt: string
  className?: string
  style?: React.CSSProperties
}

export function GambarSoalOffline({ src, alt, className, style }: Props) {
  const [objectUrl, setObjectUrl] = useState<string | null>(null)

  useEffect(() => {
    let batal = false
    let urlDibuat: string | null = null
    setObjectUrl(null)
    ambilGambarDariCache(src).then((url) => {
      if (batal) return
      urlDibuat = url
      setObjectUrl(url)
    })
    return () => {
      batal = true
      if (urlDibuat) URL.revokeObjectURL(urlDibuat)
    }
  }, [src])

  return (
    <img
      src={objectUrl ?? src}
      alt={alt}
      className={className}
      style={style}
      // Kalau src asli (jaringan) juga gagal DAN cache kosong, jangan
      // biarkan ikon gambar rusak menumpuk — cukup sembunyikan elemen,
      // teks soal tetap terbaca (sesuai temuan #5: teks harus tetap utuh
      // walau gambar tidak bisa ditampilkan).
      onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
    />
  )
}
