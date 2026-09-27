'use client'

import { useEffect, useRef } from 'react'
import { CheckCircle2, Flag, Trophy } from 'lucide-react'
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
          row.style.transition = 'transform 450ms cubic-bezier(0.22, 1, 0.36, 1)'
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
  'bg-gradient-to-br from-yellow-200 via-yellow-400 to-amber-500 text-yellow-900 shadow-[0_0_18px_rgba(250,204,21,0.55)]', // #1
  'bg-gradient-to-br from-slate-100 via-slate-300 to-slate-400 text-slate-700 shadow-[0_0_12px_rgba(203,213,225,0.35)]',   // #2
  'bg-gradient-to-br from-amber-400 via-orange-500 to-amber-700 text-amber-50 shadow-[0_0_12px_rgba(251,146,60,0.35)]',    // #3
]

// Warna "lintasan balap" tiap baris — 3 besar dapat gradasi mencolok (biar
// jelas siapa yang memimpin), sisanya gradasi brand yang lebih tenang
// supaya tidak bersaing secara visual dengan 3 besar.
const TRACK_STYLES = [
  'from-yellow-300/90 via-amber-400/70 to-orange-500/40',   // #1
  'from-slate-200/80 via-slate-300/60 to-slate-400/30',     // #2
  'from-amber-400/85 via-orange-500/65 to-rose-500/35',     // #3
]
const TRACK_STYLE_DEFAULT = 'from-brand-400/70 via-brand-500/55 to-accent-500/30'

const ROW_RING = [
  'ring-2 ring-yellow-300/60 shadow-[0_0_32px_rgba(250,204,21,0.18)] scale-[1.015] origin-left', // #1
  'ring-1 ring-slate-300/40',                                                                     // #2
  'ring-1 ring-amber-400/40',                                                                     // #3
]

export function LiveLeaderboardBoard({ board }: { board: LiveLeaderboardSesi }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const rowKeys = board.peserta.map(p => p.nis)
  useFlipAnimation(rowKeys, containerRef)

  const terjawabTotal = board.peserta.reduce((sum, p) => sum + p.terjawab, 0)
  const kapasitasTotal = board.totalPeserta * (board.peserta[0]?.totalSoal ?? 0)
  const progres = kapasitasTotal > 0 ? Math.round((terjawabTotal / kapasitasTotal) * 100) : 0
  const totalSoalBoard = board.peserta[0]?.totalSoal ?? 0

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-end justify-between mb-6 flex-wrap gap-3">
        <div>
          <p className="inline-block text-xs font-bold tracking-wider uppercase bg-gradient-to-r from-brand-400/20 to-accent-400/20 border border-brand-400/30 text-brand-200 rounded-full px-3 py-1 mb-2">
            Kelas {board.kelas}
          </p>
          <h2 className="text-4xl font-extrabold bg-gradient-to-r from-white via-brand-100 to-accent-200 bg-clip-text text-transparent">
            {board.namaMapel}
          </h2>
        </div>
        <div className="text-right text-slate-300">
          <p className="text-sm flex items-center justify-end gap-1.5">
            <Flag className="w-3.5 h-3.5 text-accent-300" />
            Menuju {totalSoalBoard} soal
          </p>
          <p className="text-2xl font-bold text-white">{board.totalPeserta} siswa</p>
          <p className="text-xs text-slate-400">Progres pengerjaan ± {progres}%</p>
        </div>
      </div>

      {board.peserta.length === 0 ? (
        <div className="flex-1 flex items-center justify-center text-slate-400 text-xl">
          Menunggu jawaban pertama masuk…
        </div>
      ) : (
        <div ref={containerRef} className="flex-1 overflow-y-auto pr-1 space-y-2.5">
          {board.peserta.map((p, i) => {
            // Panjang bar = progres menuju "garis finis" (total soal) —
            // semua siswa berbagi garis finis yang sama, jadi bar yang lebih
            // panjang benar-benar berarti jawaban benar lebih banyak, bukan
            // cuma relatif terhadap si nomor satu saat itu.
            const barPct = p.totalSoal > 0 ? Math.max((p.benar / p.totalSoal) * 100, 3) : 3
            const trackStyle = i < 3 ? TRACK_STYLES[i] : TRACK_STYLE_DEFAULT
            const rowRing = i < 3 ? ROW_RING[i] : 'ring-1 ring-white/10'

            return (
              <div
                key={p.nis}
                data-row-nis={p.nis}
                className={`relative overflow-hidden rounded-2xl will-change-transform transition-transform
                  bg-gradient-to-r from-white/[0.08] to-white/[0.03] ${rowRing}`}
              >
                {/* "Lintasan balap": lebar bar mengejar garis finis di kanan,
                    beranimasi tiap kali jumlah benar berubah. */}
                <div
                  className={`absolute inset-y-0 left-0 bg-gradient-to-r ${trackStyle}
                    transition-[width] duration-500 ease-out overflow-hidden`}
                  style={{ width: `${barPct}%` }}
                >
                  {/* Kilau bergerak — cuma dekorasi, memberi kesan "energik/hidup" */}
                  <div className="absolute inset-y-0 w-1/4 bg-gradient-to-r from-transparent via-white/40 to-transparent animate-[shine_2.8s_linear_infinite]" />
                </div>
                {/* Garis finis di ujung kanan, penanda batas total soal */}
                <div className="absolute inset-y-0 right-0 w-px bg-white/15" />

                <div className="relative z-10 flex items-center gap-4 px-5 py-3.5">
                  <div
                    className={`w-10 h-10 shrink-0 rounded-full flex items-center justify-center font-bold text-sm ring-2 ring-white/20
                      ${i < 3 ? MEDAL_STYLES[i] : 'bg-black/30 text-slate-100'}`}
                  >
                    {i < 3 ? <Trophy className="w-5 h-5" /> : i + 1}
                  </div>

                  <div className="flex-1 min-w-0">
                    <p className="text-white font-semibold text-lg truncate drop-shadow-sm">{p.nama}</p>
                    <p className="text-slate-200/90 text-xs">
                      Terjawab {p.terjawab}/{p.totalSoal} · Nilai sementara {p.nilaiSementara}
                      {p.selesai && (
                        <span className="ml-2 inline-flex items-center gap-1 text-accent-300">
                          <CheckCircle2 className="w-3.5 h-3.5" /> Selesai
                        </span>
                      )}
                    </p>
                  </div>

                  <div className="text-right shrink-0">
                    <p className="text-3xl font-black text-white tabular-nums leading-none drop-shadow-sm">
                      {p.benar}
                      <span className="text-sm font-semibold text-slate-300">/{p.totalSoal}</span>
                    </p>
                    <p className="text-[10px] text-slate-200/90 uppercase tracking-wide mt-1">jawaban benar</p>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      <style jsx global>{`
        @keyframes shine {
          0% { transform: translateX(-150%); }
          100% { transform: translateX(500%); }
        }
      `}</style>
    </div>
  )
}
