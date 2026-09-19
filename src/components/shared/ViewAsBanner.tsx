'use client'

import { useEffect, useState } from 'react'
import { Eye, LogOut } from 'lucide-react'
import { keluarLihatSebagai } from '@/lib/lihat-sebagai'

const ROLE_LABEL: Record<string, string> = { GURU: 'Guru', KEPSEK: 'Kepala Sekolah', SISWA: 'Siswa' }

function formatSisa(detik: number) {
  const j = Math.floor(detik / 3600)
  const m = Math.floor((detik % 3600) / 60)
  const s = detik % 60
  const mm = String(m).padStart(2, '0')
  const ss = String(s).padStart(2, '0')
  return j > 0 ? `${j}:${mm}:${ss}` : `${mm}:${ss}`
}

// Banner permanen (melayang di bawah-tengah, tidak menggeser layout) selama
// mode "Lihat sebagai" aktif. Otomatis kembali ke Admin saat batas 2 jam habis.
export function ViewAsBanner() {
  const [info, setInfo] = useState<{ nama: string; role: string; exp: number } | null>(null)
  const [sisa, setSisa] = useState(0)
  const [keluar, setKeluar] = useState(false)

  useEffect(() => {
    try {
      const u = JSON.parse(localStorage.getItem('user') ?? 'null')
      if (u?.viewAs) setInfo({ nama: u.nama, role: u.role, exp: Number(u.viewAsExp) || 0 })
    } catch { /* abaikan */ }
  }, [])

  useEffect(() => {
    if (!info) return
    const tick = () => {
      const s = Math.max(0, Math.floor((info.exp - Date.now()) / 1000))
      setSisa(s)
      if (s <= 0) { setKeluar(true); keluarLihatSebagai() }
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [info])

  // Selama melihat sebagai SISWA, kirim "ping" tiap 30 detik supaya banner
  // "Anda sedang dipantau admin" di sisi siswa tetap menyala — dan otomatis
  // padam sendiri (≈2 menit) kalau tab admin tertutup tanpa menekan Kembali.
  useEffect(() => {
    if (info?.role !== 'SISWA') return
    const ping = () => {
      const token = localStorage.getItem('token')
      if (!token) return
      fetch('/api/auth/lihat-sebagai/ping', { method: 'POST', headers: { Authorization: `Bearer ${token}` } })
        .catch(() => {})
    }
    const id = setInterval(ping, 30_000)
    return () => clearInterval(id)
  }, [info])

  if (!info) return null

  return (
    <div
      role="status"
      className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[9999] flex items-center gap-3 rounded-full bg-amber-500 text-white shadow-xl px-4 py-2 text-sm max-w-[95vw]"
    >
      <Eye className="w-4 h-4 shrink-0" />
      <span className="truncate">
        Melihat sebagai <b>{info.nama}</b> ({ROLE_LABEL[info.role] ?? info.role}) · hanya-baca · sisa {formatSisa(sisa)}
      </span>
      <button
        onClick={() => { setKeluar(true); keluarLihatSebagai() }}
        disabled={keluar}
        className="flex items-center gap-1 rounded-full bg-white/20 hover:bg-white/30 px-3 py-1 font-semibold shrink-0 disabled:opacity-60"
      >
        <LogOut className="w-3.5 h-3.5" /> Kembali ke Admin
      </button>
    </div>
  )
}
