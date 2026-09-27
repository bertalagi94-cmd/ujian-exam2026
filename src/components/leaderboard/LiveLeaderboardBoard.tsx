'use client'

import { useEffect, useRef } from 'react'
import { CheckCircle2, Trophy } from 'lucide-react'
import type { LiveLeaderboardSesi } from '@/lib/leaderboard-live'

// ── Animasi FLIP manual (First-Last-Invert-Play) ────────────────────────────
// Tanpa library tambahan: sebelum urutan baris berubah, catat posisi lama
// tiap baris (by nis); setelah React selesai re-render dengan urutan baru,
// hitung selisih posisi lama vs baru, lalu animasikan dari selisih itu ke 0
// lewat CSS transform + transition. Efeknya siswa yang naik/turun peringkat
// terlihat "meluncur" ke posisi barunya, bukan melompat tiba-tiba.
function useFlipAnimation(rowKeys: string[], containerRef: React.RefObject<HTMLDivElement>) {
  const prevRects = useRef<Map<string, DOMRect>>(new Map())

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const rows = Array.from(container.querySelectorAll<HTMLElement>('[data-row-nis]'))
    const newRects = new Map<string, DOMRect>()

    for (const row of rows) {
      const nis = row.dataset.rowNis!
      const rect = row.getBoundingClientRect()
      newRects.set(nis, rect)

      const prev = prevRects.current.get(nis)
      if (prev) {
        const deltaY = prev.top - rect.top
        if (Math.abs(deltaY) > 1) {
          row.style.transition = 'none'
          row.style.transform = `translateY(${deltaY}px)`
          // Paksa reflow supaya transition berikutnya benar-benar dianimasikan
          // dari nilai transform di atas, bukan langsung "meloncat" ke 0.
          void row.offsetHeight
          row.style.transition = 'transform 550ms cubic-bezier(0.22, 1, 0.36, 1)'
          row.style.transform = ''
        }
      }
    }

    prevRects.current = newRects
    // rowKeys sengaja jadi dependency utama: efek ini harus jalan setiap kali
    // URUTAN baris berubah (bukan setiap kali skor berubah tapi urutan sama).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rowKeys.join('|')])
}

const MEDAL_STYLES = [
  'bg-gradient-to-br from-yellow-300 to-yellow-500 text-yellow-900', // #1
  'bg-gradient-to-br from-slate-200 to-slate-400 text-slate-700',    // #2
  'bg-gradient-to-br from-amber-500 to-amber-700 text-amber-50',     // #3
]

export function LiveLeaderboardBoard({ board }: { board: LiveLeaderboardSesi }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const rowKeys = board.peserta.map(p => p.nis)
  useFlipAnimation(rowKeys, containerRef)

  const terjawabTotal = board.peserta.reduce((sum, p) => sum + p.terjawab, 0)
  const kapasitasTotal = board.totalPeserta * (board.peserta[0]?.totalSoal ?? 0)
  const progres = kapasitasTotal > 0 ? Math.round((terjawabTotal / kapasitasTotal) * 100) : 0

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-end justify-between mb-6 flex-wrap gap-3">
        <div>
          <p className="text-brand-300 text-lg font-semibold tracking-wide uppercase">Kelas {board.kelas}</p>
          <h2 className="text-4xl font-extrabold text-white">{board.namaMapel}</h2>
        </div>
        <div className="text-right text-slate-300">
          <p className="text-sm">Peserta ujian</p>
          <p className="text-2xl font-bold text-white">{board.totalPeserta} siswa</p>
          <p className="text-xs text-slate-400">Progres pengerjaan ± {progres}%</p>
        </div>
      </div>

      {board.peserta.length === 0 ? (
        <div className="flex-1 flex items-center justify-center text-slate-400 text-xl">
          Menunggu jawaban pertama masuk…
        </div>
      ) : (
        <div ref={containerRef} className="flex-1 overflow-y-auto pr-1 space-y-2">
          {board.peserta.map((p, i) => (
            <div
              key={p.nis}
              data-row-nis={p.nis}
              className={`flex items-center gap-4 rounded-2xl px-5 py-3.5 will-change-transform
                ${i < 3 ? 'bg-white/10 ring-1 ring-white/20' : 'bg-white/5'}`}
            >
              <div
                className={`w-10 h-10 shrink-0 rounded-full flex items-center justify-center font-bold text-sm
                  ${i < 3 ? MEDAL_STYLES[i] : 'bg-white/10 text-slate-200'}`}
              >
                {i < 3 ? <Trophy className="w-5 h-5" /> : i + 1}
              </div>

              <div className="flex-1 min-w-0">
                <p className="text-white font-semibold text-lg truncate">{p.nama}</p>
                <p className="text-slate-400 text-xs">
                  Terjawab {p.terjawab}/{p.totalSoal}
                  {p.selesai && (
                    <span className="ml-2 inline-flex items-center gap-1 text-accent-400">
                      <CheckCircle2 className="w-3.5 h-3.5" /> Selesai
                    </span>
                  )}
                </p>
              </div>

              <div className="text-right shrink-0">
                <p className="text-2xl font-extrabold text-white tabular-nums">{p.nilaiSementara}</p>
                <p className="text-[10px] text-slate-400 uppercase tracking-wide">{p.benar} benar</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
