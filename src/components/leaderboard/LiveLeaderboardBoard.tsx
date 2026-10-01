'use client'

import { useEffect, useRef } from 'react'
import { CheckCircle2, Flag, PartyPopper, Trophy } from 'lucide-react'
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
// Bar sengaja GELAP (bukan terang) supaya teks putih di atasnya tetap tajam
// dibaca dari jauh / di proyektor yang kurang jernih. Pembeda peringkat
// dipertahankan lewat HUE + garis tepi kiri yang terang (TRACK_EDGE).
const TRACK_STYLES = [
  'from-amber-700 via-amber-800 to-amber-900',      // #1 emas gelap
  'from-slate-500 via-slate-600 to-slate-700',      // #2 perak gelap
  'from-orange-800 via-orange-900 to-red-950',      // #3 perunggu gelap
]
const TRACK_STYLE_DEFAULT = 'from-sky-800 via-sky-900 to-slate-900'
const TRACK_EDGE = ['border-yellow-300', 'border-slate-200', 'border-orange-400']
const TRACK_EDGE_DEFAULT = 'border-sky-400'

const ROW_RING = [
  'ring-2 ring-yellow-300/70 shadow-[0_0_28px_rgba(250,204,21,0.18)]', // #1
  'ring-1 ring-slate-300/50',                                           // #2
  'ring-1 ring-orange-400/50',                                          // #3
]

// FITUR (diminta user): begitu pengawas menutup sesi, papan kelas ini tetap
// ditampilkan sebentar (bukan langsung lenyap dari rotasi tanpa keterangan —
// lihat komentar di layar-pantau/data & stream route.ts) dengan overlay besar
// "UJIAN SELESAI" + hitung mundur, baru benar-benar hilang dari layar setelah
// hitungan mencapai 0. `sisaDetikTutup` dihitung & di-tick oleh halaman induk
// (PapanLive di layar-pantau/page.tsx) dari serverTime — undefined berarti
// sesi ini masih BERJALAN seperti biasa (tidak menampilkan overlay).
export function LiveLeaderboardBoard({
  board,
  sisaDetikTutup,
}: {
  board: LiveLeaderboardSesi
  sisaDetikTutup?: number
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const rowKeys = board.peserta.map(p => p.nis)
  useFlipAnimation(rowKeys, containerRef)

  const sesiBaruDitutup = board.statusSesi === 'SELESAI' && sisaDetikTutup !== undefined

  const terjawabTotal = board.peserta.reduce((sum, p) => sum + p.terjawab, 0)
  const kapasitasTotal = board.totalPeserta * (board.peserta[0]?.totalSoal ?? 0)
  const progres = kapasitasTotal > 0 ? Math.round((terjawabTotal / kapasitasTotal) * 100) : 0
  const totalSoalBoard = board.peserta[0]?.totalSoal ?? 0
  // Banyak siswa → rapatkan sedikit supaya semua baris muat di layar.
  const padat = board.peserta.length > 12

  return (
    <div className="relative flex flex-col h-full">
      {sesiBaruDitutup && <OverlaySelesai sisaDetik={sisaDetikTutup!} />}

      <div className="flex items-end justify-between mb-6 flex-wrap gap-3">
        <div>
          <p className="inline-block text-base font-bold tracking-wider uppercase bg-slate-800 border border-brand-300/60 text-white rounded-full px-4 py-1 mb-2">
            Kelas {board.kelas}
          </p>
          <h2 className="text-5xl font-extrabold text-white">
            {board.namaMapel}
          </h2>
        </div>
        <div className="text-right text-slate-100">
          <p className="text-lg flex items-center justify-end gap-1.5">
            <Flag className="w-4 h-4 text-accent-300" />
            Menuju {totalSoalBoard} soal
          </p>
          <p className="text-4xl font-bold text-white">{board.totalPeserta} siswa</p>
          <p className="text-lg text-slate-200">Progres pengerjaan ± {progres}%</p>
        </div>
      </div>

      {board.peserta.length === 0 ? (
        <div className="flex-1 flex items-center justify-center text-slate-400 text-xl">
          Menunggu jawaban pertama masuk…
        </div>
      ) : (
        <div ref={containerRef} className={`flex-1 overflow-y-auto pr-1 ${padat ? 'space-y-1' : 'space-y-2'}`}>
          {board.peserta.map((p, i) => {
            // Panjang bar = progres menuju "garis finis" (total soal) —
            // semua siswa berbagi garis finis yang sama, jadi bar yang lebih
            // panjang benar-benar berarti jawaban benar lebih banyak, bukan
            // cuma relatif terhadap si nomor satu saat itu.
            const barPct = p.totalSoal > 0 ? Math.max((p.benar / p.totalSoal) * 100, 3) : 3
            const trackStyle = i < 3 ? TRACK_STYLES[i] : TRACK_STYLE_DEFAULT
            const rowRing = i < 3 ? ROW_RING[i] : 'ring-1 ring-white/10'
            const edge = i < 3 ? TRACK_EDGE[i] : TRACK_EDGE_DEFAULT

            return (
              <div
                key={p.nis}
                data-row-nis={p.nis}
                className={`relative overflow-hidden rounded-xl will-change-transform transition-transform
                  bg-slate-950/90 ${rowRing}`}
              >
                {/* "Lintasan balap": lebar bar mengejar garis finis di kanan,
                    beranimasi tiap kali jumlah benar berubah. */}
                <div
                  className={`absolute inset-y-0 left-0 bg-gradient-to-r ${trackStyle}
                    border-r-4 ${edge} transition-[width] duration-500 ease-out overflow-hidden`}
                  style={{ width: `${barPct}%` }}
                >
                  {/* Kilau bergerak — cuma dekorasi, memberi kesan "energik/hidup" */}
                  <div className="absolute inset-y-0 w-1/4 bg-gradient-to-r from-transparent via-white/10 to-transparent animate-[shine_2.8s_linear_infinite]" />
                </div>
                {/* Garis finis di ujung kanan, penanda batas total soal */}
                <div className="absolute inset-y-0 right-0 w-px bg-white/30" />

                <div className={`relative z-10 flex items-center gap-4 px-4 ${padat ? 'py-1.5' : 'py-3'}`}>
                  <div
                    className={`${padat ? 'w-8 h-8 text-sm' : 'w-11 h-11 text-lg'} shrink-0 rounded-full flex items-center justify-center font-bold ring-2 ring-white/30
                      ${i < 3 ? MEDAL_STYLES[i] : 'bg-slate-700 text-white'}`}
                  >
                    {i < 3 ? <Trophy className={padat ? 'w-4 h-4' : 'w-5 h-5'} /> : i + 1}
                  </div>

                  <div className="flex-1 min-w-0 flex items-baseline gap-x-4 gap-y-0 flex-wrap">
                    <p className={`text-white font-extrabold truncate [text-shadow:0_1px_3px_rgba(0,0,0,0.9)] shrink min-w-0 ${padat ? 'text-2xl' : 'text-3xl'}`}>{p.nama}</p>
                    <p className={`text-slate-100 font-medium whitespace-nowrap shrink-0 ${padat ? 'text-base' : 'text-lg'}`}>
                      Terjawab {p.terjawab}/{p.totalSoal} · Nilai sementara {p.nilaiSementara}
                      {p.selesai && (
                        <span className="ml-1.5 inline-flex items-center gap-1 text-emerald-300 font-bold">
                          <CheckCircle2 className="w-4 h-4" /> Selesai
                        </span>
                      )}
                    </p>
                  </div>

                  <div className="flex items-baseline gap-1.5 shrink-0">
                    <span className="text-sm font-semibold uppercase tracking-wide text-slate-200 whitespace-nowrap">
                      Jawaban benar
                    </span>
                    <p className={`${padat ? 'text-3xl' : 'text-5xl'} font-black text-white tabular-nums leading-none [text-shadow:0_1px_3px_rgba(0,0,0,0.9)]`}>
                      {p.benar}
                      <span className="text-xl font-semibold text-slate-200">/{p.totalSoal}</span>
                    </p>
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

// Overlay besar "UJIAN SELESAI" + hitung mundur, menutupi papan leaderboard
// (yang masih terlihat samar di belakang) selama beberapa detik terakhir
// sebelum papan ini hilang dari rotasi Layar Pantau.
function OverlaySelesai({ sisaDetik }: { sisaDetik: number }) {
  return (
    <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-4 rounded-3xl bg-slate-950/85 backdrop-blur-sm text-center px-6 animate-[fadeIn_0.4s_ease]">
      <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-accent-400/30 to-brand-400/20 border border-accent-400/30 flex items-center justify-center shadow-[0_0_40px_rgba(34,211,238,0.2)]">
        <PartyPopper className="w-8 h-8 text-accent-300" />
      </div>
      <h3 className="text-4xl md:text-5xl font-extrabold tracking-tight bg-gradient-to-r from-white via-accent-100 to-brand-200 bg-clip-text text-transparent">
        UJIAN SELESAI
      </h3>
      <p className="text-slate-300 text-sm md:text-base">
        Halaman ini akan hilang dalam{' '}
        <span className="font-bold text-white tabular-nums">{sisaDetik}</span> detik
      </p>
    </div>
  )
}
