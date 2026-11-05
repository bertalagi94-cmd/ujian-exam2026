'use client'

// Batas minimal jumlah soal untuk SATU mapel, sesuai yang ditetapkan admin
// (kelompok 30 / 35 / dst., atau batas bawaan). null = tidak dibatasi.
// Gagal mengambil → null (guru tetap bisa bekerja; server tetap memvalidasi saat kirim).

import { useEffect, useState } from 'react'
import { apiRequest } from '@/lib/utils'

export function useBatasMinMapel(
  jenis: 'pg' | 'essay',
  mapelId: string | null | undefined,
  aktif: boolean = true
): number | null {
  const [min, setMin] = useState<number | null>(null)

  useEffect(() => {
    if (!aktif || !mapelId) { setMin(null); return }
    let batal = false
    apiRequest<{ min: number | null }>(`/api/guru/batas-soal?jenis=${jenis}&mapel_id=${encodeURIComponent(mapelId)}`)
      .then(r => {
        if (batal) return
        const m = Number(r.min)
        setMin(Number.isInteger(m) && m >= 1 ? m : null)
      })
      .catch(() => { if (!batal) setMin(null) })
    return () => { batal = true }
  }, [jenis, mapelId, aktif])

  return min
}
