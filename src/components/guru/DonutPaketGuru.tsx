'use client'

// ── Diagram donat "Status Paket Soal" (beranda guru) ─────────────────────────
// Tampilan dan animasi sama dengan donat "Kelengkapan Soal" di beranda admin
// (components/admin/DonutKelengkapanSoal.tsx), tetapi sumber datanya adalah
// paket soal milik guru yang login (dikirim /api/guru/dashboard lewat props,
// jadi tidak ada request tambahan). Satu "unit" = satu kombinasi mapel + kelas
// yang diampu guru, termasuk yang BELUM DIBUAT sama sekali (status BELUM_DIBUAT,
// dibentuk oleh API), supaya progres guru terlihat utuh. Persentase tengah =
// unit DISETUJUI / seluruh unit. Klik segmen atau legenda untuk melihat daftarnya.
//
// Semua animasi dimatikan otomatis bila perangkat memilih "kurangi gerakan".

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { PieChart, ArrowUpRight, MousePointerClick, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { PesanSoalSelesai } from '@/components/shared/PesanSoalSelesai'

export interface PaketRingkas {
  id: string
  nama_mapel: string
  nama_kelas: string
  status: string
  jumlah_soal: number
  catatan: string | null
}

type StatusKey = 'DISETUJUI' | 'MENUNGGU' | 'DRAFT' | 'DITOLAK' | 'BELUM_DIBUAT'

const LABEL: Record<StatusKey, string> = {
  DISETUJUI: 'Disetujui',
  MENUNGGU: 'Menunggu Validasi',
  DRAFT: 'Draft',
  DITOLAK: 'Ditolak',
  BELUM_DIBUAT: 'Belum Dibuat',
}

// Urutan = urutan searah jarum jam dari jam 12.
const SEGMEN: { key: StatusKey; warna: [string, string]; titik: string; keterangan: string }[] = [
  { key: 'DISETUJUI', warna: ['#34d399', '#059669'], titik: 'bg-emerald-500', keterangan: 'Sudah disetujui & siap dipakai ujian' },
  { key: 'MENUNGGU',  warna: ['#fbbf24', '#d97706'], titik: 'bg-amber-500',   keterangan: 'Sudah Anda kirim, menunggu validasi admin' },
  { key: 'DRAFT',     warna: ['#60a5fa', '#2563eb'], titik: 'bg-blue-500',    keterangan: 'Masih Anda susun, belum dikirim' },
  { key: 'DITOLAK',   warna: ['#fb7185', '#e11d48'], titik: 'bg-rose-500',    keterangan: 'Dikembalikan validator, perlu diperbaiki' },
  { key: 'BELUM_DIBUAT', warna: ['#cbd5e1', '#94a3b8'], titik: 'bg-slate-400', keterangan: 'Anda belum membuat paket soal untuk mapel & kelas ini' },
]

const R = 84
const KELILING = 2 * Math.PI * R
const CELAH = 3 // jarak antar segmen (satuan keliling)

// Angka yang menghitung naik dengan easing.
function useHitungNaik(target: number, durasi = 1400) {
  const [nilai, setNilai] = useState(0)
  const awal = useRef(0)
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) { setNilai(target); return }
    const dari = awal.current
    const t0 = performance.now()
    let raf = 0
    const tick = (t: number) => {
      const p = Math.min((t - t0) / durasi, 1)
      const e = 1 - Math.pow(1 - p, 3)
      setNilai(Math.round(dari + (target - dari) * e))
      if (p < 1) raf = requestAnimationFrame(tick)
      else awal.current = target
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [target, durasi])
  return nilai
}

export function DonutPaketGuru({ paket, className }: { paket: PaketRingkas[]; className?: string }) {
  const [dipilih, setDipilih] = useState<StatusKey | null>(null)
  const [tergambar, setTergambar] = useState(false)

  useEffect(() => {
    // tunda sedikit supaya transisi "menggambar" terlihat
    const t = setTimeout(() => setTergambar(true), 80)
    return () => clearTimeout(t)
  }, [])

  const total = paket.length
  const hitung = useMemo(() => {
    const h: Record<StatusKey, number> = { DISETUJUI: 0, MENUNGGU: 0, DRAFT: 0, DITOLAK: 0, BELUM_DIBUAT: 0 }
    for (const p of paket) {
      // Status tak dikenal dianggap Draft supaya jumlah segmen selalu = total.
      const k = (p.status in h ? p.status : 'DRAFT') as StatusKey
      h[k]++
    }
    return h
  }, [paket])

  const semuaSelesai = total > 0 && hitung.DISETUJUI === total
  const persen = total ? Math.round((hitung.DISETUJUI / total) * 100) : 0
  const persenTampil = useHitungNaik(persen)

  // Geometri segmen
  const segmen = useMemo(() => {
    let mulai = 0
    return SEGMEN.map(s => {
      const jumlah = hitung[s.key]
      const panjangPenuh = total ? (jumlah / total) * KELILING : 0
      const panjang = Math.max(panjangPenuh - (jumlah > 0 && jumlah < total ? CELAH : 0), 0)
      const out = { ...s, jumlah, panjang, mulai }
      mulai += panjangPenuh
      return out
    })
  }, [hitung, total])

  const detail = useMemo(
    () => (dipilih ? paket.filter(p => ((p.status in hitung ? p.status : 'DRAFT') as StatusKey) === dipilih) : []),
    [dipilih, paket, hitung]
  )
  const infoDipilih = SEGMEN.find(s => s.key === dipilih)

  const pilih = (k: StatusKey) => setDipilih(prev => (prev === k ? null : k))

  return (
    <div className={cn('card relative overflow-hidden', className)}>
      <style>{`
        @keyframes dpg-putar { to { transform: rotate(360deg); } }
        @keyframes dpg-putar-balik { to { transform: rotate(-360deg); } }
        @keyframes dpg-denyut { 0%,100% { opacity:.35; transform:scale(1);} 50% { opacity:.7; transform:scale(1.04);} }
        .dpg-cincin { transform-origin: 110px 110px; animation: dpg-putar 70s linear infinite; }
        .dpg-cincin-luar { transform-origin: 110px 110px; animation: dpg-putar-balik 45s linear infinite; }
        .dpg-orbit { transform-origin: 110px 110px; animation: dpg-putar 9s linear infinite; }
        .dpg-halo { transform-origin: 110px 110px; animation: dpg-denyut 4s ease-in-out infinite; }
        .dpg-wrap { transition: transform .55s cubic-bezier(.34,1.56,.64,1), filter .55s ease; will-change: transform; }
        .dpg-wrap:hover { transform: scale(1.1); filter: drop-shadow(0 14px 24px rgba(79,70,229,.28)); z-index: 5; }
        .dpg-wrap:hover .dpg-halo { animation-duration: 1.8s; }
        .dpg-wrap:hover .dpg-orbit { animation-duration: 4s; }
        .dpg-wrap:hover .dpg-cincin, .dpg-wrap[data-pilih="1"] .dpg-cincin { animation-play-state: paused; }
        .dpg-seg { transition: stroke-dasharray 1.3s cubic-bezier(.22,1,.36,1), stroke-width .35s ease, opacity .35s ease, filter .35s ease; cursor: pointer; }
        @media (prefers-reduced-motion: reduce) {
          .dpg-cincin,.dpg-cincin-luar,.dpg-orbit,.dpg-halo { animation: none; }
          .dpg-seg { transition: none; }
          .dpg-wrap, .dpg-wrap:hover { transition: none; transform: none; }
        }
      `}</style>

      {/* dekorasi latar */}
      <span aria-hidden className="pointer-events-none absolute -right-16 -top-16 h-52 w-52 rounded-full bg-brand-100/60 blur-3xl" />
      <span aria-hidden className="pointer-events-none absolute -bottom-20 -left-10 h-48 w-48 rounded-full bg-emerald-100/60 blur-3xl" />

      <div className="relative mb-3 flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 text-white shadow-sm shadow-brand-600/30">
            <PieChart className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <h2 className="font-semibold leading-tight text-slate-900">Status Paket Soal</h2>
            <p className="text-xs text-slate-400">Mapel & kelas yang Anda ampu · klik diagram untuk detail</p>
          </div>
        </div>
        <Link href="/guru/paket" className="inline-flex flex-shrink-0 items-center gap-1 text-xs font-medium text-brand-600 hover:underline">
          Kelola <ArrowUpRight className="h-3.5 w-3.5" />
        </Link>
      </div>

      {total === 0 ? (
        <p className="py-16 text-center text-sm text-slate-400">Belum ada mapel atau kelas yang ditugaskan kepada Anda, dan belum ada paket soal. Hubungi admin untuk penugasan mapel, atau buat paket di menu Paket Soal.</p>
      ) : (
        <div className="relative grid items-center gap-5 md:grid-cols-[250px_1fr]">
          {/* ── Diagram ── */}
          <div className="dpg-wrap relative mx-auto aspect-square w-full max-w-[250px]" data-pilih={dipilih ? '1' : '0'}>
            <svg viewBox="0 0 220 220" className="h-full w-full overflow-visible" role="img"
                 aria-label={`Paket soal disetujui ${persen} persen dari seluruh mapel dan kelas yang Anda ampu`}>
              <defs>
                {SEGMEN.map(s => (
                  <linearGradient key={s.key} id={`dpg-g-${s.key}`} x1="0" y1="0" x2="1" y2="1">
                    <stop offset="0%" stopColor={s.warna[0]} />
                    <stop offset="100%" stopColor={s.warna[1]} />
                  </linearGradient>
                ))}
                <filter id="dpg-glow" x="-30%" y="-30%" width="160%" height="160%">
                  <feGaussianBlur stdDeviation="3.5" result="b" />
                  <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
                </filter>
              </defs>

              {/* halo berdenyut */}
              <circle className="dpg-halo" cx="110" cy="110" r="104" fill="none" stroke="#a5b4fc" strokeWidth="1" />
              {/* cincin putus-putus berlawanan arah */}
              <g className="dpg-cincin-luar">
                <circle cx="110" cy="110" r="102" fill="none" stroke="#94a3b8" strokeOpacity=".45" strokeWidth="1" strokeDasharray="2 7" strokeLinecap="round" />
              </g>
              {/* alur */}
              <circle cx="110" cy="110" r={R} fill="none" stroke="#f1f5f9" strokeWidth="22" />

              {/* segmen — berputar pelan */}
              <g className="dpg-cincin">
                <g transform="rotate(-90 110 110)">
                  {segmen.map(s => s.jumlah > 0 && (
                    <circle
                      key={s.key}
                      className="dpg-seg"
                      cx="110" cy="110" r={R}
                      fill="none"
                      stroke={`url(#dpg-g-${s.key})`}
                      strokeWidth={dipilih === s.key ? 30 : 22}
                      strokeLinecap="butt"
                      strokeDasharray={`${tergambar ? s.panjang : 0} ${KELILING}`}
                      strokeDashoffset={-s.mulai}
                      opacity={dipilih && dipilih !== s.key ? 0.3 : 1}
                      filter={dipilih === s.key ? 'url(#dpg-glow)' : undefined}
                      onClick={() => pilih(s.key)}
                    >
                      <title>{`${LABEL[s.key]}: ${s.jumlah} dari ${total} paket`}</title>
                    </circle>
                  ))}
                </g>
              </g>

              {/* titik cahaya mengorbit */}
              <g className="dpg-orbit">
                <circle cx="110" cy="6" r="3" fill="#6366f1" filter="url(#dpg-glow)" />
              </g>
            </svg>

            {/* angka tengah (tidak ikut berputar) */}
            <button
              type="button"
              onClick={() => setDipilih(null)}
              className="absolute left-1/2 top-1/2 flex h-[54%] w-[54%] -translate-x-1/2 -translate-y-1/2 flex-col items-center justify-center rounded-full bg-white/85 shadow-inner ring-1 ring-slate-100 backdrop-blur-sm"
              title={dipilih ? 'Klik untuk kembali ke ringkasan' : undefined}
            >
              {infoDipilih ? (
                <>
                  <span className="text-3xl font-extrabold leading-none tabular-nums text-slate-800">{hitung[infoDipilih.key]}</span>
                  <span className="mt-1 px-2 text-center text-[10px] font-semibold uppercase leading-tight tracking-wide text-slate-500">
                    {LABEL[infoDipilih.key]}
                  </span>
                  <span className="text-[10px] tabular-nums text-slate-400">{Math.round((hitung[infoDipilih.key] / total) * 100)}%</span>
                </>
              ) : (
                <>
                  <span className="text-4xl font-extrabold leading-none tabular-nums text-slate-800">
                    {persenTampil}<span className="text-xl text-slate-400">%</span>
                  </span>
                  <span className="mt-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">Disetujui</span>
                  <span className="text-[10px] text-slate-400">{hitung.DISETUJUI}/{total} paket</span>
                </>
              )}
            </button>
          </div>

          {/* ── Legenda + detail ── */}
          <div className="min-w-0 space-y-3">
            {!semuaSelesai && (
            <div className="grid grid-cols-1 gap-1.5 min-[420px]:grid-cols-2">
              {SEGMEN.map(s => (
                <button
                  key={s.key}
                  type="button"
                  onClick={() => pilih(s.key)}
                  disabled={hitung[s.key] === 0}
                  className={cn(
                    'flex items-center gap-2 rounded-xl border px-2.5 py-1.5 text-left text-xs transition-all',
                    'disabled:cursor-default disabled:opacity-40',
                    dipilih === s.key
                      ? 'border-brand-300 bg-brand-50 shadow-sm'
                      : 'border-slate-100 bg-white/70 hover:border-brand-200 hover:bg-brand-50/50',
                  )}
                >
                  <span className={cn('h-2.5 w-2.5 flex-shrink-0 rounded-full', s.titik)} />
                  <span className="min-w-0 flex-1 truncate font-medium text-slate-700">{LABEL[s.key]}</span>
                  <span className="font-bold tabular-nums text-slate-800">{hitung[s.key]}</span>
                </button>
              ))}
            </div>
            )}

            {semuaSelesai ? (
              <PesanSoalSelesai untuk="guru" />
            ) : infoDipilih ? (
              <div className="rounded-xl border border-slate-100 bg-white/80 p-3 animate-fade-in">
                <div className="mb-2 flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-800">
                      {LABEL[infoDipilih.key]} · {detail.length} paket
                    </p>
                    <p className="text-[11px] text-slate-400">{infoDipilih.keterangan}</p>
                  </div>
                  <button type="button" onClick={() => setDipilih(null)} className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600" aria-label="Tutup detail">
                    <X className="h-4 w-4" />
                  </button>
                </div>
                {infoDipilih.key === 'BELUM_DIBUAT' && (
                  <Link href="/guru/paket" className="mb-2 inline-flex items-center gap-1 text-xs font-medium text-brand-600 hover:underline">
                    Buat paket soal <ArrowUpRight className="h-3.5 w-3.5" />
                  </Link>
                )}
                <div className="max-h-44 space-y-1 overflow-y-auto pr-1">
                  {detail.map(p => (
                    <div key={p.id} className="flex items-center justify-between gap-2 rounded-lg bg-slate-50 px-2.5 py-1.5 text-xs">
                      <div className="min-w-0">
                        <span className="font-medium text-slate-700">{p.nama_mapel}</span>
                        <span className="text-slate-400"> · Kelas {p.nama_kelas}</span>
                        {infoDipilih.key === 'DITOLAK' && p.catatan && (
                          <div className="line-clamp-2 break-words text-[11px] text-slate-400">{p.catatan}</div>
                        )}
                      </div>
                      {p.jumlah_soal > 0 && (
                        <span className="flex-shrink-0 rounded-full bg-white px-2 py-0.5 text-[11px] font-semibold tabular-nums text-slate-500 ring-1 ring-slate-200">
                          {p.jumlah_soal} soal
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-2 rounded-xl border border-dashed border-slate-200 px-3 py-2.5 text-xs text-slate-500">
                <MousePointerClick className="h-4 w-4 flex-shrink-0 text-brand-500" />
                <span>
                  <b className="text-slate-700">{total - hitung.DISETUJUI}</b> dari {total} paket belum disetujui.
                  Klik bagian diagram atau daftar di atas untuk melihat mapel dan kelasnya.
                </span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
