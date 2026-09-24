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
      {/* Foto — di-scale sedikit supaya tepi hasil blur tidak menampakkan area kosong.
          Blur dijaga tipis (bukan 18px) supaya fotonya masih benar-benar terlihat,
          senada dengan kaca form login (bukan cuma warna pastel polos). */}
      <div
        className="absolute inset-0"
        style={{
          backgroundImage: "url('/images/siswa-sekolah.webp')",
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          transform: 'scale(1.06)',
          filter: 'blur(8px) saturate(115%)',
        }}
      />
      {/* Tint kaca — tipis, sekadar penanda warna khas role + sedikit
          keputihan di pojok supaya judul halaman yang tidak berada di
          dalam kartu tetap kebaca. Kartu (.card) sendiri sudah solid putih,
          jadi lapisan ini TIDAK perlu menutupi foto sampai pudar. */}
      <div
        className="absolute inset-0"
        style={{
          background: `linear-gradient(135deg, ${hexToRgba(tint, 0.4)} 0%, ${hexToRgba(tint, 0.18)} 45%, rgba(255,255,255,0.22) 100%)`,
          backdropFilter: 'blur(1px) saturate(150%)',
          WebkitBackdropFilter: 'blur(1px) saturate(150%)',
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
