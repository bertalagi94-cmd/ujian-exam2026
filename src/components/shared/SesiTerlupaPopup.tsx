'use client'

// Popup peringatan "Sesi Lupa Ditutup" — ditampilkan ke guru begitu masuk
// area Guru (dipasang di src/app/guru/layout.tsx, jalan sekali per mount).
//
// Logika pengecekan (siapa yang dianggap "terlupa") ada di server:
// GET /api/guru/sesi-terlupa — komponen ini hanya menampilkan hasilnya dan
// menyediakan dua aksi: "Tutup Sesi Ini" (memanggil endpoint tutup yang sudah
// ada) atau "Nanti Saja" (menutup popup tanpa eksekusi apa pun).

import { useEffect, useState } from 'react'
import { AlertTriangle, Square, X, RefreshCw, BookOpen, Users, Clock, ClipboardList } from 'lucide-react'
import { apiRequest } from '@/lib/utils'

interface SesiTerlupa {
  sesiId: string
  jadwalId: string
  kodeSesi: string
  waktuMulai: string
  namaMapel: string
  namaKelas: string
  isSusulan: boolean
  jumlahSudahSelesai: number
}

export function SesiTerlupaPopup() {
  const [daftar, setDaftar] = useState<SesiTerlupa[]>([])
  const [loadingClose, setLoadingClose] = useState<string | null>(null)
  const [dismissed, setDismissed] = useState<Set<string>>(new Set())

  useEffect(() => {
    apiRequest<{ data: SesiTerlupa[] }>('/api/guru/sesi-terlupa')
      .then(res => setDaftar(res.data ?? []))
      .catch(() => { /* gagal cek = diamkan saja, jangan ganggu guru dengan error */ })
  }, [])

  async function tutupSesi(sesiId: string) {
    setLoadingClose(sesiId)
    try {
      await apiRequest('/api/guru/mode-pengawas/tutup', {
        method: 'POST',
        body: JSON.stringify({ sesiId }),
      })
      setDismissed(prev => new Set(prev).add(sesiId))
    } catch {
      // Biarkan tampil, guru bisa coba lagi dari sini atau dari Mode Pengawas
    } finally {
      setLoadingClose(null)
    }
  }

  const tampil = daftar.filter(s => !dismissed.has(s.sesiId))
  if (tampil.length === 0) return null

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full animate-fade-in overflow-hidden">
        {/* Header besar & mencolok */}
        <div className="relative overflow-hidden bg-gradient-to-br from-amber-500 via-orange-500 to-red-500 px-6 py-6 text-center">
          <div className="absolute inset-0 opacity-20 pointer-events-none" style={{ backgroundImage: 'radial-gradient(circle at 15% 20%, white 0%, transparent 30%), radial-gradient(circle at 85% 75%, white 0%, transparent 30%)' }} />
          <div className="relative flex flex-col items-center gap-2">
            <div className="w-14 h-14 rounded-2xl bg-white/20 backdrop-blur flex items-center justify-center mb-1">
              <AlertTriangle className="w-7 h-7 text-white" />
            </div>
            <div className="text-[11px] font-bold uppercase tracking-widest text-white/80">Perhatian</div>
            <h3 className="text-lg font-bold text-white leading-snug">
              {tampil.length > 1 ? `${tampil.length} Sesi Ujian Belum Ditutup` : 'Sesi Ujian Belum Ditutup'}
            </h3>
            <p className="text-xs text-white/85 max-w-sm">
              Sesi berikut masih berstatus berjalan, namun sudah tidak ada siswa yang sedang mengerjakan.
              Mungkin Anda lupa menutupnya.
            </p>
          </div>
        </div>

        {/* Daftar sesi */}
        <div className="p-5 space-y-3 max-h-80 overflow-y-auto">
          {tampil.map(s => (
            <div key={s.sesiId} className="border border-slate-200 rounded-xl p-4">
              <div className="flex items-start justify-between gap-3 mb-2">
                <div>
                  <div className="font-semibold text-slate-900 text-sm">{s.namaMapel}</div>
                  <div className="flex items-center gap-3 mt-1 text-xs text-slate-500 flex-wrap">
                    <span className="flex items-center gap-1"><Users className="w-3 h-3" />Kelas {s.namaKelas}</span>
                    <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{new Date(s.waktuMulai).toLocaleString('id-ID', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                  </div>
                </div>
                {s.isSusulan && (
                  <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-purple-700 bg-purple-50 px-1.5 py-0.5 rounded-md flex-shrink-0">
                    <ClipboardList className="w-3 h-3" /> Susulan
                  </span>
                )}
              </div>
              {s.jumlahSudahSelesai > 0 && (
                <p className="text-xs text-slate-400 mb-3">{s.jumlahSudahSelesai} siswa sudah menyelesaikan ujian ini.</p>
              )}
              <button
                onClick={() => tutupSesi(s.sesiId)}
                disabled={loadingClose === s.sesiId}
                className="w-full flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-red-600 hover:bg-red-700 text-white text-sm font-semibold transition-all"
              >
                {loadingClose === s.sesiId ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Square className="w-3.5 h-3.5" />}
                {loadingClose === s.sesiId ? 'Menutup...' : 'Tutup Sesi Ini'}
              </button>
            </div>
          ))}
        </div>

        {/* Footer: nanti saja (tutup popup tanpa eksekusi apa pun) */}
        <div className="px-5 pb-5">
          <button
            onClick={() => setDismissed(prev => {
              const next = new Set(prev)
              tampil.forEach(s => next.add(s.sesiId))
              return next
            })}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border border-slate-200 text-slate-500 hover:bg-slate-50 text-sm font-medium"
          >
            <X className="w-4 h-4" /> Nanti Saja
          </button>
          <p className="text-[11px] text-slate-400 text-center mt-2 flex items-center justify-center gap-1">
            <BookOpen className="w-3 h-3" /> Anda bisa menutup sesi kapan saja dari menu Mode Pengawas.
          </p>
        </div>
      </div>
    </div>
  )
}
