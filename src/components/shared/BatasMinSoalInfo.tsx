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
  const batas = useBatasMinMapel(jenis, mapelId)
  if (batas === null) return null
  const pas = jumlah === batas
  const lebih = jumlah > batas
  return (
    <p
      className={`mt-2 inline-flex items-center gap-1.5 text-xs rounded-lg border px-2.5 py-1 ${
        pas ? 'text-emerald-700 bg-emerald-50 border-emerald-200'
          : lebih ? 'text-red-700 bg-red-50 border-red-200'
          : 'text-amber-800 bg-amber-50 border-amber-200'
      }`}
    >
      {pas ? <CheckCircle2 className="w-3.5 h-3.5" /> : <AlertTriangle className="w-3.5 h-3.5" />}
      <span>
        Jumlah soal mapel ini harus tepat <b>{batas}</b> (ditetapkan admin) · sudah {jumlah}
        {pas ? ', sudah pas dan siap dikirim' : lebih ? `, kelebihan ${jumlah - batas} (hapus dulu sebelum dikirim)` : `, kurang ${batas - jumlah} lagi`}
      </span>
    </p>
  )
}
