'use client'

import { Sparkles } from 'lucide-react'
import { useDashboardBgPref } from '@/lib/dashboard-bg-pref'

interface TransparentBgToggleProps {
  /** Warna aksen khas role (hex), mis. '#0891b2' untuk admin. */
  accent?: string
}

/**
 * Kartu saklar di halaman Beranda untuk menyalakan/mematikan efek latar
 * kaca transparan (foto siswa buram) di seluruh dashboard akun ini.
 * Tersimpan per-browser (localStorage) & langsung berlaku di semua
 * halaman tanpa perlu reload.
 */
export function TransparentBgToggle({ accent = '#0ea5e9' }: TransparentBgToggleProps) {
  const [enabled, setEnabled] = useDashboardBgPref()

  return (
    <div className="card flex items-center justify-between gap-4">
      <div className="flex items-center gap-3 min-w-0">
        <div
          className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
          style={{ background: `${accent}1a` }}
        >
          <Sparkles className="w-5 h-5" style={{ color: accent }} />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-slate-800">Latar Kaca Transparan</p>
          <p className="text-xs text-slate-400 mt-0.5">
            Tampilkan efek kaca buram seperti di halaman login pada latar dashboard Anda.
          </p>
        </div>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        aria-label="Aktifkan latar kaca transparan"
        onClick={() => setEnabled(!enabled)}
        className="relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors duration-200"
        style={{ background: enabled ? accent : '#e2e8f0' }}
      >
        <span
          className="inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform duration-200"
          style={{ transform: enabled ? 'translateX(22px)' : 'translateX(4px)' }}
        />
      </button>
    </div>
  )
}
