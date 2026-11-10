'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { usePathname } from 'next/navigation'
import { ShieldCheck, X } from 'lucide-react'
import { apiRequest } from '@/lib/utils'

// Banner untuk SISWA saat admin sedang memantau akunnya (mode Lihat-sebagai).
// Sumber status:
//  - Di halaman ujian: event 'dipantau-status' dari polling cek-sesi (10 detik,
//    sudah ada) → tidak menambah request.
//  - Di halaman lain: polling ringan /api/siswa/dipantau tiap 60 detik
//    (berhenti saat tab tidak aktif; sekali langsung saat tab tampil lagi).
// Nada sengaja menenangkan; bisa ditutup, dan muncul lagi hanya untuk sesi
// pemantauan yang BARU. Tidak tampil untuk admin yang sedang "melihat sebagai".
// HEMAT VERCEL (10 Nov 2026, tahap 3): dulu polling sendiri ke /api/siswa/dipantau
// (20 dtk, lalu 60 dtk). Sekarang di luar halaman ujian statusnya ikut respons
// /api/notif yang SUDAH dipolling sidebar siswa (field `dipantau`/`dipantau_sid`,
// diteruskan lewat event 'dipantau-status' yang sama dengan halaman ujian), jadi
// banner tidak menambah request sama sekali. Banner hanya memanggil
// /api/siswa/dipantau sendiri sebagai CADANGAN: sekali bila event dari sidebar
// tidak datang dalam AWAL_TUNGGU_MS setelah halaman dibuka (mis. /api/notif gagal),
// lalu paling sering sekali per FALLBACK_BASI_MS selama tidak ada event.
// Di halaman ujian tidak ada polling (status ikut respons cek-sesi), tidak berubah.
const AWAL_TUNGGU_MS = 8_000
const FALLBACK_CEK_MS = 120_000
const FALLBACK_BASI_MS = 300_000

export function DipantauBanner() {
  const pathname = usePathname()
  const isUjian = !!pathname?.startsWith('/siswa/ujian')
  const [sid, setSid] = useState<string | null>(null)
  const [ditutupSid, setDitutupSid] = useState<string | null>(null)
  const viewAsRef = useRef(false)
  // Kapan terakhir status dipantau diterima (dari sidebar, cek-sesi, atau cek sendiri).
  const statusTerakhirRef = useRef(0)

  useEffect(() => {
    try { viewAsRef.current = !!JSON.parse(localStorage.getItem('user') ?? 'null')?.viewAs } catch { /* abaikan */ }
  }, [])

  const cek = useCallback(() => {
    if (viewAsRef.current || !localStorage.getItem('token')) return
    apiRequest<{ dipantau: boolean; sid?: string }>('/api/siswa/dipantau', { timeoutMs: 8_000 })
      .then(d => {
        statusTerakhirRef.current = Date.now()
        setSid(d.dipantau ? d.sid ?? 'aktif' : null)
      })
      .catch(() => {})
  }, [])

  // Halaman ujian: cek sekali saat masuk (selanjutnya status ikut respons cek-sesi).
  // Halaman lain: status datang dari sidebar (lihat event di bawah); cek sendiri
  // hanya sebagai cadangan.
  useEffect(() => {
    if (isUjian) { cek(); return }
    const sejak = Date.now()
    const awal = setTimeout(() => {
      if (statusTerakhirRef.current < sejak) cek()
    }, AWAL_TUNGGU_MS)
    const periksaBasi = () => {
      if (Date.now() - Math.max(statusTerakhirRef.current, sejak) >= FALLBACK_BASI_MS) cek()
    }
    let id: ReturnType<typeof setInterval> | null = setInterval(periksaBasi, FALLBACK_CEK_MS)
    const onVis = () => {
      if (document.hidden) { if (id) { clearInterval(id); id = null } }
      else { periksaBasi(); if (!id) id = setInterval(periksaBasi, FALLBACK_CEK_MS) }
    }
    document.addEventListener('visibilitychange', onVis)
    return () => {
      clearTimeout(awal)
      if (id) clearInterval(id)
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [cek, isUjian])

  // Status dari polling cek-sesi di halaman ujian.
  useEffect(() => {
    const onStatus = (e: Event) => {
      if (viewAsRef.current) return
      statusTerakhirRef.current = Date.now()
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
