'use client'
// Komponen kecil yang dirender ulang tiap detik, TERPISAH dari halaman ujian
// supaya halaman (soal, pilihan jawaban) tidak ikut dirender ulang tiap detik.
// Lihat src/lib/waktu-ujian-store.ts.
import { Clock } from 'lucide-react'
import { useSisaWaktuUjian, useWaktuTerpakaiUjian, formatWaktuUjian } from '@/lib/waktu-ujian-store'

export function JamSisaWaktu() {
  const sisaWaktu = useSisaWaktuUjian()
  return (
    <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl font-mono font-bold text-base flex-shrink-0 transition-colors ${
      sisaWaktu < 300 ? 'bg-red-600 text-white ring-2 ring-red-200 shadow-md' :
      sisaWaktu < 600 ? 'bg-white text-amber-600 shadow-sm' :
      'bg-white/90 text-brand-700 shadow-sm'
    }`}>
      <Clock className="w-3.5 h-3.5" />
      {formatWaktuUjian(sisaWaktu)}
    </div>
  )
}

export function HitungMundurMinSubmit({ minDetik }: { minDetik: number }) {
  const waktuTerpakai = useWaktuTerpakaiUjian()
  const sisa = minDetik - waktuTerpakai
  if (minDetik <= 0 || sisa <= 0) return null
  const m = Math.floor(sisa / 60), d = sisa % 60
  return (
    <div className="relative z-[1] text-[11px] mt-1 flex items-center gap-1 text-amber-200 font-medium">
      <Clock className="w-3 h-3" />
      Tombol kirim akan aktif dalam {m}:{String(d).padStart(2, '0')} menit
    </div>
  )
}
