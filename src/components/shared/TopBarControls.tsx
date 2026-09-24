'use client'

import { FullscreenButton } from '@/components/shared/FullscreenButton'
import { TransparentBgToggle } from '@/components/shared/TransparentBgToggle'

interface TopBarControlsProps {
  /** Warna aksen khas role (hex), diteruskan ke saklar efek transparan. */
  accent?: string
  /** Tampilkan tombol layar penuh. Default true. */
  showFullscreen?: boolean
}

/**
 * Kelompok kontrol mengambang di pojok kanan-atas area konten: saklar efek
 * transparan (compact) berdampingan dengan tombol layar penuh, supaya tidak
 * memakan tempat di badan halaman seperti kartu besar sebelumnya.
 */
export function TopBarControls({ accent = '#0ea5e9', showFullscreen = true }: TopBarControlsProps) {
  return (
    <div className="fixed top-4 right-4 z-30 flex items-center gap-2">
      <TransparentBgToggle accent={accent} />
      {showFullscreen && <FullscreenButton />}
    </div>
  )
}
