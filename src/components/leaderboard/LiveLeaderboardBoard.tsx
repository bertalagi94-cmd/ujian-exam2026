'use client'

import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, CheckCircle2, Flag, Lock, PartyPopper, Trophy } from 'lucide-react'
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

// ── Tinggi baris proporsional ───────────────────────────────────────────────
// Tinggi tiap baris siswa menyesuaikan jumlah siswa: sedikit siswa → baris
// agak tinggi (maks), banyak siswa → baris menipis (min) supaya makin banyak
// yang muat di layar. Batasnya relatif terhadap tinggi layar (vh) supaya sama
// proporsinya di laptop, TV, maupun proyektor, dengan lantai piksel agar teks
// tidak pernah terlalu kecil. Kalau siswa masih terlalu banyak walau sudah
// setipis batas minimum, daftar bisa di-scroll.
const GAP_BARIS = 4
function useTinggiBaris(containerRef: React.RefObject<HTMLDivElement>, jumlah: number): number {
  const [h, setH] = useState(0)
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ukur = () => setH(el.clientHeight)
    ukur()
    const ro = new ResizeObserver(ukur)
    ro.observe(el)
    return () => ro.disconnect()
  }, [containerRef, jumlah > 0])

  const vh = typeof window !== 'undefined' ? window.innerHeight / 100 : 10
  const min = Math.max(40, Math.round(vh * 4.4))
  const max = Math.max(min, Math.round(vh * 7))
  if (!jumlah || !h) return max
  const ideal = Math.floor((h - (jumlah - 1) * GAP_BARIS) / jumlah)
  return Math.min(max, Math.max(min, ideal))
}
const px = (v: number, lo: number, hi: number) => Math.round(Math.min(hi, Math.max(lo, v)))

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
  const rowH = useTinggiBaris(containerRef, board.peserta.length)

  const sesiBaruDitutup = board.statusSesi === 'SELESAI' && sisaDetikTutup !== undefined

  const terjawabTotal = board.peserta.reduce((sum, p) => sum + p.terjawab, 0)
  const kapasitasTotal = board.totalPeserta * (board.peserta[0]?.totalSoal ?? 0)
  const progres = kapasitasTotal > 0 ? Math.round((terjawabTotal / kapasitasTotal) * 100) : 0
  const totalSoalBoard = board.peserta[0]?.totalSoal ?? 0
  // Banyak siswa → kepala papan (kelas/mapel/statistik) ikut diciutkan supaya
  // ruang untuk baris siswa lebih lega.
  const ringkas = board.peserta.length > 6

  return (
    <div className="relative flex flex-col h-full flex-1 min-h-0">
      {sesiBaruDitutup && <OverlaySelesai sisaDetik={sisaDetikTutup!} />}

      <div className={`flex items-end justify-between flex-wrap gap-3 ${ringkas ? 'mb-3' : 'mb-6'}`}>
        <div>
          <p className={`inline-block font-bold tracking-wider uppercase bg-slate-800 border border-brand-300/60 text-white rounded-full px-4 py-1 mb-2 ${ringkas ? 'text-sm' : 'text-base'}`}>
            Kelas {board.kelas}
          </p>
          <h2 className={`${ringkas ? 'text-3xl' : 'text-5xl'} font-extrabold text-white`}>
            {board.namaMapel}
          </h2>
        </div>
        <div className="text-right text-slate-100">
          <p className={`${ringkas ? 'text-sm' : 'text-lg'} flex items-center justify-end gap-1.5`}>
            <Flag className="w-4 h-4 text-accent-300" />
            Menuju {totalSoalBoard} soal
          </p>
          <p className={`${ringkas ? 'text-2xl' : 'text-4xl'} font-bold text-white`}>{board.totalPeserta} siswa</p>
          <p className={`${ringkas ? 'text-sm' : 'text-lg'} text-slate-200`}>Progres pengerjaan ± {progres}%</p>
        </div>
      </div>

      {board.peserta.length === 0 ? (
        <div className="flex-1 flex items-center justify-center text-slate-400 text-xl">
          Menunggu jawaban pertama masuk…
        </div>
      ) : (
        <div ref={containerRef} className="flex-1 min-h-0 overflow-y-auto pr-1 flex flex-col gap-1">
          {board.peserta.map((p, i) => {
            // Panjang bar = progres menuju "garis finis" (total soal) —
            // semua siswa berbagi garis finis yang sama, jadi bar yang lebih
            // panjang benar-benar berarti jawaban benar lebih banyak, bukan
            // cuma relatif terhadap si nomor satu saat itu.
            const barPct = p.totalSoal > 0 ? Math.max((p.benar / p.totalSoal) * 100, 3) : 3
            const trackStyle = i < 3 ? TRACK_STYLES[i] : TRACK_STYLE_DEFAULT
            const edge = i < 3 ? TRACK_EDGE[i] : TRACK_EDGE_DEFAULT
            // Pelanggaran: RESET = baru melanggar, menunggu kode pengawas
            // (baris berkedip merah). TERKUNCI = melewati batas (merah tetap).
            // Keduanya hilang sendiri begitu status kembali AKTIF.
            const reset = p.status === 'RESET'
            const terkunci = p.status === 'TERKUNCI'
            const bermasalah = reset || terkunci
            const rowRing = bermasalah ? 'ring-2 ring-red-500' : i < 3 ? ROW_RING[i] : 'ring-1 ring-white/10'

            return (
              <div
                key={p.nis}
                data-row-nis={p.nis}
                className={`relative shrink-0 overflow-hidden rounded-lg will-change-transform transition-transform
                  bg-slate-950/90 ${rowRing}`}
                style={{ height: rowH }}
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
                {/* Lapisan merah penanda pelanggaran (di atas bar, di bawah teks).
                    Tanpa animasi (mis. 'kurangi gerakan' aktif) tetap merah statis. */}
                {bermasalah && (
                  <div
                    className={`absolute inset-0 bg-red-600 ${reset ? 'opacity-40 animate-[pelanggaranBlink_1s_ease-in-out_infinite]' : 'opacity-45'}`}
                  />
                )}
                {/* Garis finis di ujung kanan, penanda batas total soal */}
                <div className="absolute inset-y-0 right-0 w-px bg-white/30" />

                <div className="relative z-10 h-full flex items-center gap-3 px-3">
                  <div
                    className={`shrink-0 rounded-full flex items-center justify-center font-bold ring-2 ring-white/30
                      ${i < 3 ? MEDAL_STYLES[i] : 'bg-slate-700 text-white'}`}
                    style={{ width: px(rowH * 0.62, 26, 44), height: px(rowH * 0.62, 26, 44), fontSize: px(rowH * 0.3, 12, 20) }}
                  >
                    {i < 3 ? <Trophy style={{ width: '50%', height: '50%' }} /> : i + 1}
                  </div>

                  <p
                    className="text-white font-extrabold truncate shrink-0 max-w-[38%] [text-shadow:0_1px_3px_rgba(0,0,0,0.9)]"
                    style={{ fontSize: px(rowH * 0.4, 16, 30) }}
                  >
                    {p.nama}
                  </p>

                  <p
                    className="text-slate-100 font-medium whitespace-nowrap truncate min-w-0 flex-1"
                    style={{ fontSize: px(rowH * 0.24, 12, 18) }}
                  >
                    Terjawab {p.terjawab}/{p.totalSoal} · Nilai sementara {p.nilaiSementara}
                  </p>

                  {p.selesai && !terkunci && (
                    <span className="shrink-0 inline-flex items-center gap-1 text-emerald-300 font-bold" style={{ fontSize: px(rowH * 0.24, 12, 18) }}>
                      <CheckCircle2 className="w-[1.1em] h-[1.1em]" /> Selesai
                    </span>
                  )}
                  {reset && (
                    <span className="shrink-0 inline-flex items-center gap-1.5 rounded-md bg-red-700 px-2 py-0.5 font-extrabold text-white" style={{ fontSize: px(rowH * 0.24, 12, 18) }}>
                      <AlertTriangle className="w-[1.1em] h-[1.1em]" /> Pelanggaran · menunggu pengawas
                    </span>
                  )}
                  {terkunci && (
                    <span className="shrink-0 inline-flex items-center gap-1.5 rounded-md bg-red-800 px-2 py-0.5 font-extrabold text-white" style={{ fontSize: px(rowH * 0.24, 12, 18) }}>
                      <Lock className="w-[1.1em] h-[1.1em]" /> Terkunci · ujian dihentikan
                    </span>
                  )}

                  <div className="flex items-baseline gap-1.5 shrink-0 ml-auto">
                    <span
                      className="font-semibold uppercase tracking-wide text-slate-200 whitespace-nowrap"
                      style={{ fontSize: px(rowH * 0.19, 11, 14) }}
                    >
                      Jawaban benar
                    </span>
                    <p className="font-black text-white tabular-nums leading-none [text-shadow:0_1px_3px_rgba(0,0,0,0.9)]" style={{ fontSize: px(rowH * 0.55, 22, 44) }}>
                      {p.benar}
                      <span className="font-semibold text-slate-200" style={{ fontSize: px(rowH * 0.28, 13, 22) }}>/{p.totalSoal}</span>
                    </p>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      <style jsx global>{`
        @keyframes pelanggaranBlink {
          0%, 100% { opacity: 0.15; }
          50%      { opacity: 0.7; }
        }
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
