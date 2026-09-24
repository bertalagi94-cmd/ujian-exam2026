'use client'

import { Sparkles } from 'lucide-react'
import { useDashboardBgPref } from '@/lib/dashboard-bg-pref'

interface TransparentBgToggleProps {
  /** Warna aksen khas role (hex), mis. '#0891b2' untuk admin. */
  accent?: string
}

/**
 * Saklar mengambang (compact pill) untuk menyalakan/mematikan efek latar
 * kaca transparan (foto siswa buram) di seluruh dashboard akun ini.
 * Diletakkan berdampingan dengan tombol layar penuh di pojok kanan-atas
 * agar tidak memakan tempat di badan halaman. Tersimpan per-browser
 * (localStorage) & langsung berlaku di semua halaman tanpa perlu reload.
 */
export function TransparentBgToggle({ accent = '#0ea5e9' }: TransparentBgToggleProps) {
  const [enabled, setEnabled] = useDashboardBgPref()

  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      aria-label="Aktifkan latar kaca transparan"
      title={enabled ? 'Matikan efek transparan' : 'Aktifkan efek transparan'}
      onClick={() => setEnabled(!enabled)}
      className="group inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white/95 backdrop-blur-sm shadow-card-md pl-2 pr-1 py-1 transition-all duration-200 hover:shadow-card-lg"
    >
      <Sparkles
        className="w-3.5 h-3.5 transition-colors duration-200"
        style={{ color: enabled ? accent : '#94a3b8' }}
      />
      <span
        className="relative inline-flex h-5 w-9 flex-shrink-0 items-center rounded-full transition-colors duration-300"
        style={{ background: enabled ? accent : '#e2e8f0' }}
      >
        <span
          className="inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow-sm transition-transform duration-300 ease-out"
          style={{ transform: enabled ? 'translateX(17px)' : 'translateX(3px)' }}
        />
      </span>
    </button>
  )
}
