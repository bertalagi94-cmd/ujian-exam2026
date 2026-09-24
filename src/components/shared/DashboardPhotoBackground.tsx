'use client'

import { useDashboardBgPref } from '@/lib/dashboard-bg-pref'

interface DashboardPhotoBackgroundProps {
  /** Warna aksen khas role (hex), dipakai sebagai tint di atas foto. */
  tint: string
  /**
   * Set false untuk menonaktifkan sementara terlepas dari preferensi user
   * (mis. saat siswa sedang mengerjakan ujian, supaya tidak mengganggu
   * konsentrasi).
   */
  active?: boolean
}

/**
 * Latar foto siswa yang sama seperti di halaman login, diburamkan
 * (backdrop-style blur) lalu ditutup lapisan tint transparan bernuansa
 * warna khas role. Lapisan tint ini yang menjaga supaya teks & kartu putih
 * di atasnya tetap kontras dan mudah dibaca — bukan cuma foto polos
 * ditransparankan begitu saja.
 */
export function DashboardPhotoBackground({ tint, active = true }: DashboardPhotoBackgroundProps) {
  const [enabled] = useDashboardBgPref()
  if (!enabled || !active) return null

  return (
    <div className="fixed inset-0 overflow-hidden pointer-events-none" style={{ zIndex: 0 }} aria-hidden="true">
      {/* Foto — di-scale sedikit supaya tepi hasil blur tidak menampakkan area kosong */}
      <div
        className="absolute inset-0"
        style={{
          backgroundImage: "url('/images/siswa-sekolah.webp')",
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          transform: 'scale(1.1)',
          filter: 'blur(18px) saturate(110%)',
        }}
      />
      {/* Tint kaca — senada warna role, menjaga kontras konten di atasnya */}
      <div
        className="absolute inset-0"
        style={{
          background: `linear-gradient(135deg, ${hexToRgba(tint, 0.5)} 0%, rgba(255,255,255,0.78) 55%, rgba(255,255,255,0.9) 100%)`,
          backdropFilter: 'blur(2px) saturate(140%)',
          WebkitBackdropFilter: 'blur(2px) saturate(140%)',
        }}
      />
    </div>
  )
}

function hexToRgba(hex: string, alpha: number): string {
  const clean = hex.replace('#', '')
  const r = parseInt(clean.substring(0, 2), 16)
  const g = parseInt(clean.substring(2, 4), 16)
  const b = parseInt(clean.substring(4, 6), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}
