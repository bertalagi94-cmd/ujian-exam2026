'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { usePathname } from 'next/navigation'
import { ShieldCheck, X } from 'lucide-react'
import { apiRequest } from '@/lib/utils'

// Banner untuk SISWA saat admin sedang memantau akunnya (mode Lihat-sebagai).
// Sumber status:
//  - Di halaman ujian: event 'dipantau-status' dari polling cek-sesi (10 detik,
//    sudah ada) → tidak menambah request.
//  - Di halaman lain: polling ringan /api/siswa/dipantau tiap 20 detik
//    (berhenti saat tab tidak aktif).
// Nada sengaja menenangkan; bisa ditutup, dan muncul lagi hanya untuk sesi
// pemantauan yang BARU. Tidak tampil untuk admin yang sedang "melihat sebagai".
const POLL_MS = 20_000

export function DipantauBanner() {
  const pathname = usePathname()
  const isUjian = !!pathname?.startsWith('/siswa/ujian')
  const [sid, setSid] = useState<string | null>(null)
  const [ditutupSid, setDitutupSid] = useState<string | null>(null)
  const viewAsRef = useRef(false)

  useEffect(() => {
    try { viewAsRef.current = !!JSON.parse(localStorage.getItem('user') ?? 'null')?.viewAs } catch { /* abaikan */ }
  }, [])

  const cek = useCallback(() => {
    if (viewAsRef.current || !localStorage.getItem('token')) return
    apiRequest<{ dipantau: boolean; sid?: string }>('/api/siswa/dipantau', { timeoutMs: 8_000 })
      .then(d => setSid(d.dipantau ? d.sid ?? 'aktif' : null))
      .catch(() => {})
  }, [])

  // Cek sekali setiap masuk halaman baru + polling di luar halaman ujian.
  useEffect(() => {
    cek()
    if (isUjian) return
    let id: ReturnType<typeof setInterval> | null = setInterval(cek, POLL_MS)
    const onVis = () => {
      if (document.hidden) { if (id) { clearInterval(id); id = null } }
      else { cek(); if (!id) id = setInterval(cek, POLL_MS) }
    }
    document.addEventListener('visibilitychange', onVis)
    return () => { if (id) clearInterval(id); document.removeEventListener('visibilitychange', onVis) }
  }, [cek, isUjian])

  // Status dari polling cek-sesi di halaman ujian.
  useEffect(() => {
    const onStatus = (e: Event) => {
      if (viewAsRef.current) return
      const d = (e as CustomEvent<{ dipantau?: boolean; sid?: string }>).detail
      setSid(d?.dipantau ? d.sid ?? 'aktif' : null)
    }
    window.addEventListener('dipantau-status', onStatus)
    return () => window.removeEventListener('dipantau-status', onStatus)
  }, [])

  if (!sid || sid === ditutupSid) return null

  return (
    <div className="pointer-events-none fixed top-3 left-1/2 -translate-x-1/2 z-[9998] max-w-[95vw]">
      <div role="status" className="pointer-events-auto flex items-center gap-2 rounded-full bg-sky-600/95 text-white shadow-lg px-4 py-1.5 text-sm">
        <ShieldCheck className="w-4 h-4 shrink-0" />
        <span>Anda sedang dipantau admin. Tidak perlu khawatir.</span>
        <button onClick={() => setDitutupSid(sid)} aria-label="Tutup" className="rounded-full p-0.5 hover:bg-white/20">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  )
}
