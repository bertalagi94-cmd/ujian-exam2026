'use client'

// ── Diagram donat "Kelengkapan Soal" (beranda admin) ─────────────────────────
// Sumber data: /api/admin/laporan-lengkap (sama dengan menu Laporan Lengkap),
// jadi angkanya selalu konsisten dengan laporan. Satu "unit" = satu kombinasi
// mapel + kelas. Persentase kelengkapan = unit berstatus DISETUJUI / seluruh unit.
//
// Animasi: cincin berputar pelan (berhenti saat disentuh/dipilih agar mudah
// diklik), segmen "tergambar" saat pertama muncul, angka tengah menghitung naik,
// titik cahaya mengorbit, dan cincin putus-putus tipis berputar berlawanan arah.
// Semua animasi dimatikan otomatis bila perangkat memilih "kurangi gerakan".

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { PieChart, ArrowUpRight, MousePointerClick, X } from 'lucide-react'
import { apiRequest, cn } from '@/lib/utils'
import type { LaporanResponse, RowLaporan } from '@/lib/laporan-pdf'
import { STATUS_SOAL_LABEL } from '@/lib/laporan-pdf'

type StatusKey = 'DISETUJUI' | 'MENUNGGU' | 'DRAFT' | 'DITOLAK' | 'BELUM_DIBUAT'

// Urutan = urutan searah jarum jam dari jam 12.
const SEGMEN: { key: StatusKey; warna: [string, string]; titik: string; keterangan: string }[] = [
  { key: 'DISETUJUI',    warna: ['#34d399', '#059669'], titik: 'bg-emerald-500', keterangan: 'Soal sudah disetujui & siap dipakai ujian' },
  { key: 'MENUNGGU',     warna: ['#fbbf24', '#d97706'], titik: 'bg-amber-500',   keterangan: 'Sudah dikirim guru, menunggu validasi' },
  { key: 'DRAFT',        warna: ['#60a5fa', '#2563eb'], titik: 'bg-blue-500',    keterangan: 'Sedang disusun guru, belum dikirim' },
  { key: 'DITOLAK',      warna: ['#fb7185', '#e11d48'], titik: 'bg-rose-500',    keterangan: 'Dikembalikan validator, perlu diperbaiki' },
  { key: 'BELUM_DIBUAT', warna: ['#cbd5e1', '#94a3b8'], titik: 'bg-slate-400',   keterangan: 'Guru belum membuat soal sama sekali' },
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

export function DonutKelengkapanSoal({ className }: { className?: string }) {
  const [rows, setRows] = useState<RowLaporan[] | null>(null)
  const [gagal, setGagal] = useState(false)
  const [dipilih, setDipilih] = useState<StatusKey | null>(null)
  const [tergambar, setTergambar] = useState(false)

  useEffect(() => {
    let batal = false
    apiRequest<LaporanResponse>('/api/admin/laporan-lengkap')
      .then(res => {
        if (batal) return
        setRows(res.data.flatMap(g => g.rows))
        // tunda sedikit supaya transisi "menggambar" terlihat
        setTimeout(() => !batal && setTergambar(true), 80)
      })
      .catch(() => !batal && setGagal(true))
    return () => { batal = true }
  }, [])

  const total = rows?.length ?? 0
  const hitung = useMemo(() => {
    const h: Record<StatusKey, number> = { DISETUJUI: 0, MENUNGGU: 0, DRAFT: 0, DITOLAK: 0, BELUM_DIBUAT: 0 }
    for (const r of rows ?? []) {
      const k = (r.pra.statusSoal in h ? r.pra.statusSoal : 'BELUM_DIBUAT') as StatusKey
      h[k]++
    }
    return h
  }, [rows])

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
    () => (dipilih && rows ? rows.filter(r => (r.pra.statusSoal in hitung ? r.pra.statusSoal : 'BELUM_DIBUAT') === dipilih) : []),
    [dipilih, rows, hitung]
  )
  const infoDipilih = SEGMEN.find(s => s.key === dipilih)

  const pilih = (k: StatusKey) => setDipilih(prev => (prev === k ? null : k))

  return (
    <div className={cn('card relative overflow-hidden', className)}>
      <style>{`
        @keyframes dks-putar { to { transform: rotate(360deg); } }
        @keyframes dks-putar-balik { to { transform: rotate(-360deg); } }
        @keyframes dks-denyut { 0%,100% { opacity:.35; transform:scale(1);} 50% { opacity:.7; transform:scale(1.04);} }
        .dks-cincin { transform-origin: 110px 110px; animation: dks-putar 70s linear infinite; }
        .dks-cincin-luar { transform-origin: 110px 110px; animation: dks-putar-balik 45s linear infinite; }
        .dks-orbit { transform-origin: 110px 110px; animation: dks-putar 9s linear infinite; }
        .dks-halo { transform-origin: 110px 110px; animation: dks-denyut 4s ease-in-out infinite; }
        .dks-wrap:hover .dks-cincin, .dks-wrap[data-pilih="1"] .dks-cincin { animation-play-state: paused; }
        .dks-seg { transition: stroke-dasharray 1.3s cubic-bezier(.22,1,.36,1), stroke-width .35s ease, opacity .35s ease, filter .35s ease; cursor: pointer; }
        @media (prefers-reduced-motion: reduce) {
          .dks-cincin,.dks-cincin-luar,.dks-orbit,.dks-halo { animation: none; }
          .dks-seg { transition: none; }
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
            <h2 className="font-semibold leading-tight text-slate-900">Kelengkapan Soal</h2>
            <p className="text-xs text-slate-400">Per mapel + kelas · klik diagram untuk detail</p>
          </div>
        </div>
        <Link href="/admin/laporan" className="inline-flex flex-shrink-0 items-center gap-1 text-xs font-medium text-brand-600 hover:underline">
          Laporan <ArrowUpRight className="h-3.5 w-3.5" />
        </Link>
      </div>

      {rows === null && !gagal ? (
        <div className="flex h-72 items-center justify-center">
          <div className="h-40 w-40 animate-pulse rounded-full border-[18px] border-slate-100" />
        </div>
      ) : gagal ? (
        <p className="py-16 text-center text-sm text-slate-400">Gagal memuat data kelengkapan soal.</p>
      ) : total === 0 ? (
        <p className="py-16 text-center text-sm text-slate-400">Belum ada kombinasi mapel + kelas.</p>
      ) : (
        <div className="relative grid items-center gap-5 md:grid-cols-[250px_1fr]">
          {/* ── Diagram ── */}
          <div className="dks-wrap relative mx-auto aspect-square w-full max-w-[250px]" data-pilih={dipilih ? '1' : '0'}>
            <svg viewBox="0 0 220 220" className="h-full w-full overflow-visible" role="img"
                 aria-label={`Kelengkapan soal ${persen} persen`}>
              <defs>
                {SEGMEN.map(s => (
                  <linearGradient key={s.key} id={`dks-g-${s.key}`} x1="0" y1="0" x2="1" y2="1">
                    <stop offset="0%" stopColor={s.warna[0]} />
                    <stop offset="100%" stopColor={s.warna[1]} />
                  </linearGradient>
                ))}
                <filter id="dks-glow" x="-30%" y="-30%" width="160%" height="160%">
                  <feGaussianBlur stdDeviation="3.5" result="b" />
                  <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
                </filter>
              </defs>

              {/* halo berdenyut */}
              <circle className="dks-halo" cx="110" cy="110" r="104" fill="none" stroke="#a5b4fc" strokeWidth="1" />
              {/* cincin putus-putus berlawanan arah */}
              <g className="dks-cincin-luar">
                <circle cx="110" cy="110" r="102" fill="none" stroke="#94a3b8" strokeOpacity=".45" strokeWidth="1" strokeDasharray="2 7" strokeLinecap="round" />
              </g>
              {/* alur */}
              <circle cx="110" cy="110" r={R} fill="none" stroke="#f1f5f9" strokeWidth="22" />

              {/* segmen — berputar pelan */}
              <g className="dks-cincin">
                <g transform="rotate(-90 110 110)">
                  {segmen.map(s => s.jumlah > 0 && (
                    <circle
                      key={s.key}
                      className="dks-seg"
                      cx="110" cy="110" r={R}
                      fill="none"
                      stroke={`url(#dks-g-${s.key})`}
                      strokeWidth={dipilih === s.key ? 30 : 22}
                      strokeLinecap="butt"
                      strokeDasharray={`${tergambar ? s.panjang : 0} ${KELILING}`}
                      strokeDashoffset={-s.mulai}
                      opacity={dipilih && dipilih !== s.key ? 0.3 : 1}
                      filter={dipilih === s.key ? 'url(#dks-glow)' : undefined}
                      onClick={() => pilih(s.key)}
                    >
                      <title>{`${STATUS_SOAL_LABEL[s.key]}: ${s.jumlah} dari ${total}`}</title>
                    </circle>
                  ))}
                </g>
              </g>

              {/* titik cahaya mengorbit */}
              <g className="dks-orbit">
                <circle cx="110" cy="6" r="3" fill="#6366f1" filter="url(#dks-glow)" />
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
                    {STATUS_SOAL_LABEL[infoDipilih.key]}
                  </span>
                  <span className="text-[10px] tabular-nums text-slate-400">{Math.round((hitung[infoDipilih.key] / total) * 100)}%</span>
                </>
              ) : (
                <>
                  <span className="text-4xl font-extrabold leading-none tabular-nums text-slate-800">
                    {persenTampil}<span className="text-xl text-slate-400">%</span>
                  </span>
                  <span className="mt-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">Lengkap</span>
                  <span className="text-[10px] text-slate-400">{hitung.DISETUJUI}/{total} disetujui</span>
                </>
              )}
            </button>
          </div>

          {/* ── Legenda + detail ── */}
          <div className="min-w-0 space-y-3">
            <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
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
                  <span className="min-w-0 flex-1 truncate font-medium text-slate-700">{STATUS_SOAL_LABEL[s.key]}</span>
                  <span className="font-bold tabular-nums text-slate-800">{hitung[s.key]}</span>
                </button>
              ))}
            </div>

            {infoDipilih ? (
              <div className="rounded-xl border border-slate-100 bg-white/80 p-3 animate-fade-in">
                <div className="mb-2 flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-800">
                      {STATUS_SOAL_LABEL[infoDipilih.key]} · {detail.length} mapel+kelas
                    </p>
                    <p className="text-[11px] text-slate-400">{infoDipilih.keterangan}</p>
                  </div>
                  <button type="button" onClick={() => setDipilih(null)} className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600" aria-label="Tutup detail">
                    <X className="h-4 w-4" />
                  </button>
                </div>
                <div className="max-h-44 space-y-1 overflow-y-auto pr-1">
                  {detail.map(r => (
                    <div key={`${r.mapelId}-${r.kelasId}`} className="flex items-center justify-between gap-2 rounded-lg bg-slate-50 px-2.5 py-1.5 text-xs">
                      <div className="min-w-0">
                        <span className="font-medium text-slate-700">{r.namaMapel}</span>
                        <span className="text-slate-400"> · {r.namaKelas}</span>
                        <div className="truncate text-[11px] text-slate-400">
                          {r.namaGuru}
                          {infoDipilih.key === 'DITOLAK' && r.pra.catatanPenolakan ? ` — ${r.pra.catatanPenolakan}` : ''}
                        </div>
                      </div>
                      {r.pra.jumlahSoal > 0 && (
                        <span className="flex-shrink-0 rounded-full bg-white px-2 py-0.5 text-[11px] font-semibold tabular-nums text-slate-500 ring-1 ring-slate-200">
                          {r.pra.jumlahSoal} soal
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
                  <b className="text-slate-700">{total - hitung.DISETUJUI}</b> dari {total} kombinasi mapel+kelas belum disetujui.
                  Klik bagian diagram atau daftar di atas untuk melihat mapel, kelas, dan gurunya.
                </span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
