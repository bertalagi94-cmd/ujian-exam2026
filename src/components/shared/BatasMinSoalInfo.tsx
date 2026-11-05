'use client'

// Info kecil di halaman guru: "Minimal 30 soal (ditetapkan admin) · sudah 12, kurang 18".
// Tidak tampil kalau admin tidak membatasi mapel ini.

import { AlertTriangle, CheckCircle2 } from 'lucide-react'
import { useBatasMinMapel } from '@/lib/use-batas-min-soal'

interface Props {
  jenis: 'pg' | 'essay'
  mapelId: string | null | undefined
  /** Jumlah soal yang sudah ada di paket. */
  jumlah: number
}

export function BatasMinSoalInfo({ jenis, mapelId, jumlah }: Props) {
  const min = useBatasMinMapel(jenis, mapelId)
  if (min === null) return null
  const cukup = jumlah >= min
  return (
    <p
      className={`mt-2 inline-flex items-center gap-1.5 text-xs rounded-lg border px-2.5 py-1 ${
        cukup ? 'text-emerald-700 bg-emerald-50 border-emerald-200' : 'text-amber-800 bg-amber-50 border-amber-200'
      }`}
    >
      {cukup ? <CheckCircle2 className="w-3.5 h-3.5" /> : <AlertTriangle className="w-3.5 h-3.5" />}
      <span>
        Jumlah soal mapel ini minimal <b>{min}</b> (ditetapkan admin) · sudah {jumlah}
        {cukup ? ', sudah cukup untuk dikirim' : `, kurang ${min - jumlah} lagi`}
      </span>
    </p>
  )
}
