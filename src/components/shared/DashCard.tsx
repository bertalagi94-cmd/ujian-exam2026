'use client'

// ── Kartu informasi ringkas (versi ramping, 52px) ────────────────────────────
// Dipakai ditumpuk di sisi kiri beranda, diagram di sisi kanan. Tampilannya
// sama dengan kartu di beranda admin. Kelas gradient harus ditulis lengkap oleh
// pemanggil (bukan dirakit dari string) supaya terbaca Tailwind.
//
// Label boleh turun ke dua baris (line-clamp-2) supaya label panjang seperti
// "Total Paket Disetujui" tetap terbaca penuh di layar HP yang sempit.

import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

export function DashCard({
  label, value, sub, icon: Icon, gradient, className,
}: {
  label: string
  value: string | number
  sub?: string
  icon: LucideIcon
  gradient: string
  className?: string
}) {
  return (
    <div
      title={sub ? `${label} · ${sub}` : label}
      className={cn(
        'group relative h-[52px] overflow-hidden rounded-xl px-3 flex items-center gap-2.5 text-white',
        'bg-gradient-to-br shadow-md shadow-slate-900/10 ring-1 ring-white/25',
        'transition-all duration-300 hover:translate-x-0.5 hover:shadow-lg',
        gradient,
        className,
      )}
    >
      {/* dekorasi latar */}
      <span aria-hidden className="pointer-events-none absolute -right-5 -top-8 h-20 w-20 rounded-full bg-white/15" />
      <Icon
        aria-hidden
        className="pointer-events-none absolute right-1.5 bottom-0.5 h-9 w-9 -rotate-12 text-white/20 transition-transform duration-300 group-hover:scale-110 group-hover:-rotate-6"
      />

      <div className="relative hidden h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-white/20 ring-1 ring-white/30 backdrop-blur-sm sm:flex">
        <Icon className="h-4 w-4" />
      </div>
      {/* label di kiri, angka di kanan — satu kartu ramping */}
      <div className="relative min-w-0 flex-1 line-clamp-2 break-words text-[10.5px] font-semibold uppercase leading-[1.15] tracking-wide text-white/90">
        {label}
      </div>
      <span className="relative flex-shrink-0 pr-1 text-xl font-extrabold leading-none tabular-nums">{value}</span>
    </div>
  )
}
