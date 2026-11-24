'use client'

// ── Diagram donat "Progres Ujian" (tab kedua di beranda admin) ───────────────
// Sumber data: /api/admin/progres-ujian. Satu "unit" = ujian seorang siswa pada
// satu jadwal (siswa × jadwal). Persentase = unit SELESAI / seluruh unit, jadi
// 100% hanya tercapai bila semua siswa sudah mengikuti semua ujian terjadwal.
//
// Data TIDAK dimuat otomatis berulang: dimuat saat tab dibuka, setiap tab
// diklik lagi (lewat `refreshKey`), atau lewat tombol "Muat ulang".
// Tampilan donat sengaja mengikuti DonutKelengkapanSoal (animasi dimatikan
// otomatis bila perangkat memilih "kurangi gerakan").

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import type { LucideIcon } from 'lucide-react'
import {
  Activity, ArrowUpRight, RefreshCw, MousePointerClick, X, Award,
  Users, UserX, ShieldAlert, CalendarCheck, TrendingDown, Calendar,
} from 'lucide-react'
import { apiRequest, cn } from '@/lib/utils'
import type { ProgresUjianResponse } from '@/app/api/admin/progres-ujian/route'
import { useHitungNaik } from '@/components/admin/DonutKelengkapanSoal'

type StatusKey = 'SELESAI' | 'MENGERJAKAN' | 'TIDAK_HADIR' | 'TERKUNCI' | 'BELUM_MULAI'
type FieldHitung = 'selesai' | 'mengerjakan' | 'tidakHadir' | 'terkunci' | 'belumMulai'

// Urutan = urutan searah jarum jam dari jam 12.
const SEGMEN: {
  key: StatusKey; field: FieldHitung; label: string
  warna: [string, string]; titik: string; keterangan: string
}[] = [
  { key: 'SELESAI',     field: 'selesai',     label: 'Selesai',            warna: ['#34d399', '#059669'], titik: 'bg-emerald-500', keterangan: 'Sudah menyelesaikan ujian' },
  { key: 'MENGERJAKAN', field: 'mengerjakan', label: 'Sedang Mengerjakan', warna: ['#60a5fa', '#2563eb'], titik: 'bg-blue-500',    keterangan: 'Sedang mengerjakan pada sesi yang berjalan' },
  { key: 'TIDAK_HADIR', field: 'tidakHadir',  label: 'Tidak Hadir',        warna: ['#fbbf24', '#d97706'], titik: 'bg-amber-500',   keterangan: 'Jadwal sudah selesai tetapi belum mengikuti — perlu susulan' },
  { key: 'TERKUNCI',    field: 'terkunci',    label: 'Terkunci',           warna: ['#fb7185', '#e11d48'], titik: 'bg-rose-500',    keterangan: 'Terkunci karena pelanggaran, menunggu dibuka pengawas' },
  { key: 'BELUM_MULAI', field: 'belumMulai',  label: 'Belum Mulai',        warna: ['#cbd5e1', '#94a3b8'], titik: 'bg-slate-400',   keterangan: 'Jadwalnya belum dilaksanakan atau siswa belum memulai' },
]

const R = 84
const KELILING = 2 * Math.PI * R
const CELAH = 3 // jarak antar segmen (satuan keliling)
const PANJANG_MIN = 2 // segmen kecil tetap terlihat

function formatTanggalPendek(tanggal: string): string {
  if (!tanggal) return '-'
  const d = new Date(`${tanggal}T00:00:00`)
  if (Number.isNaN(d.getTime())) return tanggal
  return d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' })
}

function Tile({
  icon: Icon, label, value, sub, warnaAngka, href,
}: {
  icon: LucideIcon
  label: string
  value: string | number
  sub?: string
  warnaAngka: string
  href?: string
}) {
  const isi = (
    <>
      <div className="flex items-center gap-1.5 text-[10.5px] font-semibold uppercase leading-tight tracking-wide text-slate-500">
        <Icon aria-hidden className="h-3.5 w-3.5 flex-shrink-0 text-slate-400" />
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {href && <ArrowUpRight aria-hidden className="h-3 w-3 flex-shrink-0 text-slate-300" />}
      </div>
      <div className={cn('mt-1 text-xl font-extrabold leading-none tabular-nums', warnaAngka)}>{value}</div>
      {sub && <div className="mt-1 truncate text-[11px] text-slate-400" title={sub}>{sub}</div>}
    </>
  )
  const kelas = 'block rounded-xl border border-slate-100 bg-white/70 px-3 py-2.5'
  return href
    ? <Link href={href} className={cn(kelas, 'transition-colors hover:border-brand-200 hover:bg-brand-50/50')}>{isi}</Link>
    : <div className={kelas}>{isi}</div>
}

// Pengganti legenda saat semua ujian siswa sudah selesai (100%).
function PesanUjianSelesai() {
  return (
    <div className="relative overflow-hidden rounded-2xl border border-slate-100 bg-gradient-to-br from-emerald-50/80 via-white to-indigo-50/80 px-5 py-8 text-center shadow-sm animate-fade-in">
      <span aria-hidden className="pointer-events-none absolute -left-10 -top-10 h-36 w-36 rounded-full bg-emerald-200/50 blur-3xl" />
      <span aria-hidden className="pointer-events-none absolute -bottom-12 -right-10 h-40 w-40 rounded-full bg-indigo-200/50 blur-3xl" />
      <div className="relative">
        <span className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-gradient-to-br from-amber-300 to-amber-500 text-white shadow-md shadow-amber-500/30">
          <Award aria-hidden className="h-6 w-6" />
        </span>
        <h3 className="text-2xl font-extrabold leading-tight text-slate-800">Seluruh ujian telah selesai</h3>
        <p className="mx-auto mt-2 max-w-lg text-sm leading-relaxed text-slate-600">
          Semua siswa sudah mengikuti seluruh ujian yang dijadwalkan. Langkah berikutnya: pastikan nilai
          sudah dikoreksi, dirilis, dan dikirim ke wali murid.
        </p>
      </div>
    </div>
  )
}

export function DonutProgresUjian({ refreshKey, className }: { refreshKey: number; className?: string }) {
  const [data, setData] = useState<ProgresUjianResponse | null>(null)
  const [galat, setGalat] = useState<string | null>(null)
  const [memuat, setMemuat] = useState(true)
  const [dipilih, setDipilih] = useState<StatusKey | null>(null)
  const [tergambar, setTergambar] = useState(false)
  const [tanggalInput, setTanggalInput] = useState('')
  const [menyimpan, setMenyimpan] = useState(false)
  const [galatSimpan, setGalatSimpan] = useState<string | null>(null)
  const urutan = useRef(0)

  const muat = useCallback(async () => {
    const id = ++urutan.current
    setMemuat(true)
    try {
      const res = await apiRequest<ProgresUjianResponse>('/api/admin/progres-ujian', { timeoutMs: 20_000 })
      if (id !== urutan.current) return // ada permintaan yang lebih baru
      setData(res)
      setGalat(null)
      // tunda sedikit supaya transisi "menggambar" terlihat
      setTimeout(() => { if (id === urutan.current) setTergambar(true) }, 80)
    } catch (e) {
      if (id !== urutan.current) return
      setGalat(e instanceof Error ? e.message : 'Gagal memuat progres ujian.')
    } finally {
      if (id === urutan.current) setMemuat(false)
    }
  }, [])

  // Dimuat saat pertama muncul dan setiap `refreshKey` berubah (tab diklik).
  useEffect(() => { muat() }, [muat, refreshKey])

  // Kolom tanggal mengikuti nilai tersimpan di server setiap data dimuat.
  const periodeTersimpan = data?.periodeMulai ?? ''
  useEffect(() => { setTanggalInput(periodeTersimpan) }, [periodeTersimpan])

  // Simpan tanggal mulai periode ujian ('' = hapus batas), lalu muat ulang data.
  const simpanPeriode = async (nilai: string) => {
    setMenyimpan(true)
    setGalatSimpan(null)
    try {
      await apiRequest('/api/admin/progres-ujian', {
        method: 'PUT',
        body: JSON.stringify({ mulai: nilai || null }),
      })
      await muat()
    } catch (e) {
      setGalatSimpan(e instanceof Error ? e.message : 'Gagal menyimpan tanggal.')
    } finally {
      setMenyimpan(false)
    }
  }

  const r = data?.ringkasan
  const total = r?.total ?? 0
  const persen = r?.persen ?? 0
  const semuaSelesai = total > 0 && (r?.selesai ?? 0) === total
  const persenTampil = useHitungNaik(persen)

  const segmen = useMemo(() => {
    let mulai = 0
    return SEGMEN.map(s => {
      const jumlah = r ? r[s.field] : 0
      const panjangPenuh = total ? (jumlah / total) * KELILING : 0
      const kurangiCelah = jumlah > 0 && jumlah < total ? CELAH : 0
      const panjang = jumlah > 0 ? Math.max(panjangPenuh - kurangiCelah, PANJANG_MIN) : 0
      const out = { ...s, jumlah, panjang, mulai }
      mulai += panjangPenuh
      return out
    })
  }, [r, total])

  const infoDipilih = SEGMEN.find(s => s.key === dipilih)
  const detail = useMemo(() => {
    if (!infoDipilih || !data) return []
    return data.jadwal
      .map(j => ({ ...j, jumlah: j[infoDipilih.field] }))
      .filter(j => j.jumlah > 0)
      .sort((a, b) => b.jumlah - a.jumlah || a.tanggal.localeCompare(b.tanggal))
  }, [infoDipilih, data])

  const pilih = (k: StatusKey) => setDipilih(prev => (prev === k ? null : k))
  const jamDiperbarui = data
    ? new Date(data.generatedAt).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })
    : null

  return (
    <div className={cn('card relative overflow-hidden', className)}>
      <style>{`
        @keyframes dpu-putar { to { transform: rotate(360deg); } }
        @keyframes dpu-putar-balik { to { transform: rotate(-360deg); } }
        @keyframes dpu-denyut { 0%,100% { opacity:.35; transform:scale(1);} 50% { opacity:.7; transform:scale(1.04);} }
        .dpu-cincin { transform-origin: 110px 110px; animation: dpu-putar 70s linear infinite; }
        .dpu-cincin-luar { transform-origin: 110px 110px; animation: dpu-putar-balik 45s linear infinite; }
        .dpu-orbit { transform-origin: 110px 110px; animation: dpu-putar 9s linear infinite; }
        .dpu-halo { transform-origin: 110px 110px; animation: dpu-denyut 4s ease-in-out infinite; }
        .dpu-wrap { transition: transform .55s cubic-bezier(.34,1.56,.64,1), filter .55s ease; will-change: transform; }
        .dpu-wrap:hover { transform: scale(1.1); filter: drop-shadow(0 14px 24px rgba(79,70,229,.28)); z-index: 5; }
        .dpu-wrap:hover .dpu-halo { animation-duration: 1.8s; }
        .dpu-wrap:hover .dpu-orbit { animation-duration: 4s; }
        .dpu-wrap:hover .dpu-cincin, .dpu-wrap[data-pilih="1"] .dpu-cincin { animation-play-state: paused; }
        .dpu-seg { transition: stroke-dasharray 1.3s cubic-bezier(.22,1,.36,1), stroke-dashoffset 1.3s cubic-bezier(.22,1,.36,1), stroke-width .35s ease, opacity .35s ease, filter .35s ease; cursor: pointer; }
        @media (prefers-reduced-motion: reduce) {
          .dpu-cincin,.dpu-cincin-luar,.dpu-orbit,.dpu-halo { animation: none; }
          .dpu-seg { transition: none; }
          .dpu-wrap, .dpu-wrap:hover { transition: none; transform: none; }
        }
      `}</style>

      {/* dekorasi latar */}
      <span aria-hidden className="pointer-events-none absolute -right-16 -top-16 h-52 w-52 rounded-full bg-brand-100/60 blur-3xl" />
      <span aria-hidden className="pointer-events-none absolute -bottom-20 -left-10 h-48 w-48 rounded-full bg-emerald-100/60 blur-3xl" />

      <div className="relative mb-3 flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 text-white shadow-sm shadow-brand-600/30">
            <Activity className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <h2 className="font-semibold leading-tight text-slate-900">Progres Ujian</h2>
            <p className="text-xs text-slate-400">
              Ujian siswa per jadwal · klik diagram untuk detail
              {jamDiperbarui && <> · diperbarui {jamDiperbarui}</>}
            </p>
          </div>
        </div>
        <div className="flex flex-shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={muat}
            disabled={memuat}
            className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white/80 px-2 py-1 text-xs font-medium text-slate-600 transition-colors hover:border-brand-200 hover:text-brand-700 disabled:opacity-60"
            title="Muat ulang data progres ujian"
          >
            <RefreshCw className={cn('h-3.5 w-3.5', memuat && 'animate-spin')} />
            <span className="hidden sm:inline">Muat ulang</span>
          </button>
          <Link href="/admin/laporan" className="inline-flex items-center gap-1 text-xs font-medium text-brand-600 hover:underline">
            Laporan <ArrowUpRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      </div>

      {data !== null && (
        <div className="relative mb-3 rounded-xl border border-slate-100 bg-white/70 px-3 py-2">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-slate-600">
            <label htmlFor="dpu-mulai" className="inline-flex items-center gap-1.5 font-medium">
              <Calendar aria-hidden className="h-3.5 w-3.5 text-slate-400" />
              Periode ujian dihitung mulai
            </label>
            <input
              id="dpu-mulai"
              type="date"
              value={tanggalInput}
              onChange={e => setTanggalInput(e.target.value)}
              className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700"
            />
            <button
              type="button"
              onClick={() => simpanPeriode(tanggalInput)}
              disabled={menyimpan || tanggalInput === periodeTersimpan}
              className="rounded-lg bg-brand-600 px-2.5 py-1 font-medium text-white transition-colors hover:bg-brand-700 disabled:opacity-40"
            >
              {menyimpan ? 'Menyimpan…' : 'Terapkan'}
            </button>
            {periodeTersimpan && (
              <button
                type="button"
                onClick={() => simpanPeriode('')}
                disabled={menyimpan}
                className="font-medium text-slate-500 underline-offset-2 hover:underline disabled:opacity-40"
              >
                Hapus batas
              </button>
            )}
          </div>
          <p className="mt-1.5 text-[11px] leading-snug text-slate-400">
            {periodeTersimpan
              ? 'Jadwal dan nilai sebelum tanggal ini tidak dihitung (mis. sisa simulasi).'
              : 'Belum diatur: semua jadwal dan riwayat ikut dihitung, termasuk sisa simulasi. Isi tanggal hari pertama ujian sungguhan.'}
            {data.riwayatSelesai > 0 && (
              <> Termasuk <b className="text-slate-500">{data.riwayatSelesai}</b> ujian siswa dari jadwal yang sudah dihapus.</>
            )}
          </p>
          {galatSimpan && <p className="mt-1 text-[11px] text-rose-600">{galatSimpan}</p>}
        </div>
      )}

      {data === null && !galat ? (
        <div className="flex h-72 items-center justify-center">
          <div className="h-40 w-40 animate-pulse rounded-full border-[18px] border-slate-100" />
        </div>
      ) : data === null ? (
        <div className="py-16 text-center">
          <p className="text-sm text-slate-500">{galat}</p>
          <button type="button" onClick={muat} className="mt-3 text-xs font-medium text-brand-600 hover:underline">Coba lagi</button>
        </div>
      ) : total === 0 ? (
        <p className="py-16 text-center text-sm text-slate-400">Belum ada jadwal ujian dengan peserta.</p>
      ) : (
        <div className="relative">
          {galat && (
            <p className="mb-2 rounded-lg bg-rose-50 px-3 py-1.5 text-xs text-rose-600">
              Pembaruan gagal ({galat}). Data di bawah adalah data terakhir yang berhasil dimuat.
            </p>
          )}
          <div className="grid items-center gap-5 md:grid-cols-[250px_1fr]">
            {/* ── Diagram ── */}
            <div className="dpu-wrap relative mx-auto aspect-square w-full max-w-[250px]" data-pilih={dipilih ? '1' : '0'}>
              <svg viewBox="0 0 220 220" className="h-full w-full overflow-visible" role="img"
                   aria-label={`Progres ujian ${persen} persen selesai`}>
                <defs>
                  {SEGMEN.map(s => (
                    <linearGradient key={s.key} id={`dpu-g-${s.key}`} x1="0" y1="0" x2="1" y2="1">
                      <stop offset="0%" stopColor={s.warna[0]} />
                      <stop offset="100%" stopColor={s.warna[1]} />
                    </linearGradient>
                  ))}
                  <filter id="dpu-glow" x="-30%" y="-30%" width="160%" height="160%">
                    <feGaussianBlur stdDeviation="3.5" result="b" />
                    <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
                  </filter>
                </defs>

                <circle className="dpu-halo" cx="110" cy="110" r="104" fill="none" stroke="#a5b4fc" strokeWidth="1" />
                <g className="dpu-cincin-luar">
                  <circle cx="110" cy="110" r="102" fill="none" stroke="#94a3b8" strokeOpacity=".45" strokeWidth="1" strokeDasharray="2 7" strokeLinecap="round" />
                </g>
                <circle cx="110" cy="110" r={R} fill="none" stroke="#f1f5f9" strokeWidth="22" />

                <g className="dpu-cincin">
                  <g transform="rotate(-90 110 110)">
                    {segmen.map(s => s.jumlah > 0 && (
                      <circle
                        key={s.key}
                        className="dpu-seg"
                        cx="110" cy="110" r={R}
                        fill="none"
                        stroke={`url(#dpu-g-${s.key})`}
                        strokeWidth={dipilih === s.key ? 30 : 22}
                        strokeLinecap="butt"
                        strokeDasharray={`${tergambar ? s.panjang : 0} ${KELILING}`}
                        strokeDashoffset={-s.mulai}
                        opacity={dipilih && dipilih !== s.key ? 0.3 : 1}
                        filter={dipilih === s.key ? 'url(#dpu-glow)' : undefined}
                        onClick={() => pilih(s.key)}
                      >
                        <title>{`${s.label}: ${s.jumlah} dari ${total} ujian siswa`}</title>
                      </circle>
                    ))}
                  </g>
                </g>

                <g className="dpu-orbit">
                  <circle cx="110" cy="6" r="3" fill="#6366f1" filter="url(#dpu-glow)" />
                </g>
              </svg>

              {/* angka tengah (tidak ikut berputar) */}
              <button
                type="button"
                onClick={() => setDipilih(null)}
                className="absolute left-1/2 top-1/2 flex h-[54%] w-[54%] -translate-x-1/2 -translate-y-1/2 flex-col items-center justify-center rounded-full bg-white/85 shadow-inner ring-1 ring-slate-100 backdrop-blur-sm"
                title={dipilih ? 'Klik untuk kembali ke ringkasan' : undefined}
              >
                {infoDipilih && r ? (
                  <>
                    <span className="text-3xl font-extrabold leading-none tabular-nums text-slate-800">{r[infoDipilih.field]}</span>
                    <span className="mt-1 px-2 text-center text-[10px] font-semibold uppercase leading-tight tracking-wide text-slate-500">
                      {infoDipilih.label}
                    </span>
                    <span className="text-[10px] tabular-nums text-slate-400">{Math.round((r[infoDipilih.field] / total) * 100)}%</span>
                  </>
                ) : (
                  <>
                    <span className="text-4xl font-extrabold leading-none tabular-nums text-slate-800">
                      {persenTampil}<span className="text-xl text-slate-400">%</span>
                    </span>
                    <span className="mt-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">Selesai</span>
                    <span className="text-[10px] tabular-nums text-slate-400">{r?.selesai}/{total} ujian siswa</span>
                  </>
                )}
              </button>
            </div>

            {/* ── Legenda + detail + info tambahan ── */}
            <div className="min-w-0 space-y-3">
              {semuaSelesai ? (
                <>
                  <PesanUjianSelesai />
                  {data.pelanggaranBelumDitindak > 0 && (
                    <Link href="/admin/pelanggaran" className="flex items-center gap-2 rounded-xl border border-rose-100 bg-rose-50/70 px-3 py-2 text-xs text-rose-700 hover:bg-rose-50">
                      <ShieldAlert className="h-4 w-4 flex-shrink-0" />
                      <span><b>{data.pelanggaranBelumDitindak}</b> pelanggaran masih menunggu ditindaklanjuti.</span>
                    </Link>
                  )}
                </>
              ) : (
                <>
                  <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                    {segmen.map(s => (
                      <button
                        key={s.key}
                        type="button"
                        onClick={() => pilih(s.key)}
                        disabled={s.jumlah === 0}
                        className={cn(
                          'flex items-center gap-2 rounded-xl border px-2.5 py-1.5 text-left text-xs transition-all',
                          'disabled:cursor-default disabled:opacity-40',
                          dipilih === s.key
                            ? 'border-brand-300 bg-brand-50 shadow-sm'
                            : 'border-slate-100 bg-white/70 hover:border-brand-200 hover:bg-brand-50/50',
                        )}
                      >
                        <span className={cn('h-2.5 w-2.5 flex-shrink-0 rounded-full', s.titik)} />
                        <span className="min-w-0 flex-1 truncate font-medium text-slate-700">{s.label}</span>
                        <span className="font-bold tabular-nums text-slate-800">{s.jumlah}</span>
                      </button>
                    ))}
                  </div>

                  {infoDipilih ? (
                    <div className="rounded-xl border border-slate-100 bg-white/80 p-3 animate-fade-in">
                      <div className="mb-2 flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-slate-800">
                            {infoDipilih.label} · {detail.length} jadwal
                          </p>
                          <p className="text-[11px] text-slate-400">{infoDipilih.keterangan}</p>
                        </div>
                        <button type="button" onClick={() => setDipilih(null)} className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600" aria-label="Tutup detail">
                          <X className="h-4 w-4" />
                        </button>
                      </div>
                      <div className="max-h-44 space-y-1 overflow-y-auto pr-1">
                        {detail.map(j => (
                          <div key={j.id} className="flex items-center justify-between gap-2 rounded-lg bg-slate-50 px-2.5 py-1.5 text-xs">
                            <div className="min-w-0">
                              <span className="font-medium text-slate-700">{j.mapel}</span>
                              <span className="text-slate-400"> · {j.kelas}</span>
                              <div className="truncate text-[11px] text-slate-400">
                                {formatTanggalPendek(j.tanggal)}{j.sesi ? ` · sesi ${j.sesi}` : ''}{j.riwayat ? ' · jadwal sudah dihapus' : ''}
                              </div>
                            </div>
                            <span className="flex-shrink-0 rounded-full bg-white px-2 py-0.5 text-[11px] font-semibold tabular-nums text-slate-500 ring-1 ring-slate-200">
                              {j.jumlah} siswa
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="grid grid-cols-2 gap-2">
                        <Tile
                          icon={Users}
                          label="Sedang ujian"
                          value={data.sedangUjian.siswa}
                          sub={`${data.sedangUjian.sesi} sesi berjalan`}
                          warnaAngka="text-blue-600"
                        />
                        <Tile
                          icon={UserX}
                          label="Perlu susulan"
                          value={data.perluSusulan.siswa}
                          sub={data.perluSusulan.total > 0
                            ? `siswa · ${data.perluSusulan.total} ujian tak diikuti`
                            : 'tidak ada'}
                          warnaAngka={data.perluSusulan.siswa > 0 ? 'text-amber-600' : 'text-slate-700'}
                        />
                        <Tile
                          icon={ShieldAlert}
                          label="Pelanggaran"
                          value={data.pelanggaranBelumDitindak}
                          sub="belum ditindaklanjuti"
                          warnaAngka={data.pelanggaranBelumDitindak > 0 ? 'text-rose-600' : 'text-slate-700'}
                          href="/admin/pelanggaran"
                        />
                        <Tile
                          icon={CalendarCheck}
                          label="Jadwal hari ini"
                          value={data.hariIni.total > 0 ? `${data.hariIni.selesai}/${data.hariIni.total}` : '0'}
                          sub={data.hariIni.total > 0
                            ? `${data.hariIni.berjalan} berjalan · ${data.hariIni.akanDatang} akan datang`
                            : 'tidak ada jadwal'}
                          warnaAngka="text-emerald-600"
                        />
                      </div>

                      {data.kelasTertinggal.length > 0 && (
                        <div className="rounded-xl border border-slate-100 bg-white/70 p-3">
                          <div className="mb-2 flex items-center gap-1.5">
                            <TrendingDown aria-hidden className="h-3.5 w-3.5 text-slate-400" />
                            <p className="text-xs font-semibold text-slate-700">Kelas paling tertinggal</p>
                            <span className="text-[11px] text-slate-400">· dari ujian yang seharusnya sudah tuntas</span>
                          </div>
                          <div className="space-y-2">
                            {data.kelasTertinggal.map(k => (
                              <div key={k.kelas}>
                                <div className="mb-1 flex items-center justify-between gap-2 text-xs">
                                  <span className="min-w-0 truncate font-medium text-slate-700">{k.kelas}</span>
                                  <span className="flex-shrink-0 text-slate-500">
                                    <b className="tabular-nums text-slate-800">{k.persen}%</b> · {k.belumTuntas} belum tuntas dari {k.total}
                                  </span>
                                </div>
                                <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
                                  <div
                                    className={cn(
                                      'h-full rounded-full transition-all duration-700',
                                      k.persen < 50 ? 'bg-rose-500' : k.persen < 80 ? 'bg-amber-500' : 'bg-emerald-500',
                                    )}
                                    style={{ width: `${k.persen}%` }}
                                  />
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      <div className="flex items-center gap-2 rounded-xl border border-dashed border-slate-200 px-3 py-2 text-xs text-slate-500">
                        <MousePointerClick className="h-4 w-4 flex-shrink-0 text-brand-500" />
                        <span>Klik bagian diagram atau daftar di atas untuk melihat jadwal, kelas, dan jumlah siswanya.</span>
                      </div>
                    </>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
