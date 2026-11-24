'use client'

// ── Panel progres di beranda admin: dua tab sederhana ────────────────────────
//   "Progres Soal"   → DonutKelengkapanSoal (tampilan lama, TIDAK diubah)
//   "Progres Ujian"  → DonutProgresUjian
//
// Default saat admin membuka beranda: Progres Soal. Data Progres Ujian baru
// dimuat saat tab itu pertama diklik, lalu dimuat ulang setiap kali tab itu
// diklik lagi (refresh manual, tanpa auto-refresh berkala). Progres Soal tetap
// terpasang (hanya disembunyikan) supaya berpindah tab tidak memuat ulang
// laporan yang cukup berat.

import { useRef, useState, type KeyboardEvent } from 'react'
import { cn } from '@/lib/utils'
import { DonutKelengkapanSoal } from '@/components/admin/DonutKelengkapanSoal'
import { DonutProgresUjian } from '@/components/admin/DonutProgresUjian'

type Tab = 'soal' | 'ujian'

const TAB: { id: Tab; label: string }[] = [
  { id: 'soal', label: 'Progres Soal' },
  { id: 'ujian', label: 'Progres Ujian' },
]

export function PanelProgresBeranda() {
  const [tab, setTab] = useState<Tab>('soal')
  const [ujianDibuka, setUjianDibuka] = useState(false)
  const [muatKe, setMuatKe] = useState(0)
  const tombol = useRef<Record<Tab, HTMLButtonElement | null>>({ soal: null, ujian: null })

  const pilihTab = (t: Tab) => {
    setTab(t)
    if (t === 'ujian') {
      setUjianDibuka(true)
      setMuatKe(n => n + 1) // setiap klik tab Progres Ujian = muat ulang data
    }
  }

  // Navigasi keyboard standar tab: panah kiri/kanan berpindah tab.
  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
    e.preventDefault()
    const tujuan: Tab = tab === 'soal' ? 'ujian' : 'soal'
    pilihTab(tujuan)
    tombol.current[tujuan]?.focus()
  }

  return (
    <div className="min-w-0 space-y-3">
      <div
        role="tablist"
        aria-label="Progres beranda admin"
        className="inline-flex rounded-xl bg-slate-100/80 p-1 ring-1 ring-slate-200/70"
      >
        {TAB.map(t => {
          const aktif = tab === t.id
          return (
            <button
              key={t.id}
              ref={el => { tombol.current[t.id] = el }}
              type="button"
              role="tab"
              id={`tab-progres-${t.id}`}
              aria-selected={aktif}
              aria-controls={`panel-progres-${t.id}`}
              tabIndex={aktif ? 0 : -1}
              onClick={() => pilihTab(t.id)}
              onKeyDown={onKeyDown}
              className={cn(
                'rounded-lg px-3.5 py-1.5 text-sm font-medium transition-all',
                aktif
                  ? 'bg-white text-brand-700 shadow-sm ring-1 ring-slate-200/80'
                  : 'text-slate-500 hover:text-slate-700',
              )}
            >
              {t.label}
            </button>
          )
        })}
      </div>

      <div role="tabpanel" id="panel-progres-soal" aria-labelledby="tab-progres-soal" hidden={tab !== 'soal'}>
        <DonutKelengkapanSoal />
      </div>

      {ujianDibuka && (
        <div role="tabpanel" id="panel-progres-ujian" aria-labelledby="tab-progres-ujian" hidden={tab !== 'ujian'}>
          <DonutProgresUjian refreshKey={muatKe} />
        </div>
      )}
    </div>
  )
}
