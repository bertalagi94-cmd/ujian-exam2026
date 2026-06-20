'use client'

import { useEffect, useState } from 'react'
import { Maximize, Minimize } from 'lucide-react'

// ── Fullscreen helpers (selaras dengan logika di halaman ujian siswa) ────────
function requestFullscreen(el: Element) {
  if (el.requestFullscreen) return el.requestFullscreen()
  const anyEl = el as unknown as Record<string, () => Promise<void>>
  if (anyEl.webkitRequestFullscreen) return anyEl.webkitRequestFullscreen()
  if (anyEl.mozRequestFullScreen) return anyEl.mozRequestFullScreen()
  if (anyEl.msRequestFullscreen) return anyEl.msRequestFullscreen()
  return Promise.resolve()
}

function exitFullscreen() {
  if (document.exitFullscreen) return document.exitFullscreen()
  const anyDoc = document as unknown as Record<string, () => Promise<void>>
  if (anyDoc.webkitExitFullscreen) return anyDoc.webkitExitFullscreen()
  if (anyDoc.mozCancelFullScreen) return anyDoc.mozCancelFullScreen()
  if (anyDoc.msExitFullscreen) return anyDoc.msExitFullscreen()
  return Promise.resolve()
}

function isFullscreen() {
  const anyDoc = document as unknown as Record<string, Element | null>
  return !!(
    document.fullscreenElement ||
    anyDoc.webkitFullscreenElement ||
    anyDoc.mozFullScreenElement ||
    anyDoc.msFullscreenElement
  )
}

/**
 * Tombol layar penuh untuk dashboard Admin / Guru / Kepala Sekolah.
 * Diletakkan mengambang di pojok kanan-atas area konten.
 * Beda dengan mode ujian siswa: di sini TIDAK ada anti-cheat/paksaan apa pun —
 * murni kenyamanan tampilan, jadi pengguna bebas keluar masuk fullscreen kapan saja.
 */
export function FullscreenButton() {
  const [fs, setFs] = useState(false)

  useEffect(() => {
    function onChange() { setFs(isFullscreen()) }
    document.addEventListener('fullscreenchange', onChange)
    document.addEventListener('webkitfullscreenchange', onChange)
    document.addEventListener('mozfullscreenchange', onChange)
    document.addEventListener('MSFullscreenChange', onChange)
    return () => {
      document.removeEventListener('fullscreenchange', onChange)
      document.removeEventListener('webkitfullscreenchange', onChange)
      document.removeEventListener('mozfullscreenchange', onChange)
      document.removeEventListener('MSFullscreenChange', onChange)
    }
  }, [])

  function toggle() {
    if (isFullscreen()) {
      exitFullscreen().catch(() => {})
    } else {
      requestFullscreen(document.documentElement).catch(() => {})
    }
  }

  return (
    <button
      onClick={toggle}
      className="fixed top-4 right-4 z-30 btn-secondary btn-sm shadow-card-md bg-white"
      title={fs ? 'Keluar dari layar penuh' : 'Tampilkan layar penuh'}
    >
      {fs ? <Minimize className="w-3.5 h-3.5" /> : <Maximize className="w-3.5 h-3.5" />}
      <span>{fs ? 'Keluar Fullscreen' : 'Layar Penuh'}</span>
    </button>
  )
}
