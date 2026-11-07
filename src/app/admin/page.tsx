'use client'

import { useState, useEffect, useCallback } from 'react'
import type { LucideIcon } from 'lucide-react'
import {
  Users, BookOpen, GraduationCap, BarChart3, Calendar, ClipboardCheck,
  TrendingUp, AlertCircle, School, Library,
} from 'lucide-react'
import { PageLoader, StatusBadge } from '@/components/ui'
import { apiRequest, cn, nilaiColor, fetchPublik } from '@/lib/utils'
import { SesiBelumDitutupAdmin } from '@/components/shared/SesiBelumDitutupAdmin'

interface DashboardData {
  stats: {
    totalSiswa: number
    totalGuru: number
    totalSoal: number
    totalPaketSoal: number
    totalNilai: number
    totalMapel: number
    totalKelas: number
    jadwalAktif: number
    paketMenunggu: number
    rataRataNilai: number
  }
  recentNilai: Array<{
    nama_siswa: string
    nama_mapel: string
    nilai: number
    grade: string
    lulus: boolean
    timestamp: string
    kelas: string
  }>
  nilaiPerMapel: Array<{
    nama: string
    rata: number
    total: number
  }>
}

// ── Kartu informasi ringkas ─────────────────────────────────────────────────
// Tinggi dibuat tetap ±2 cm (76px) dengan gradasi warna per kartu. Kelas
// gradient ditulis lengkap (bukan dirakit dari string) supaya terbaca Tailwind.
function DashCard({
  label, value, sub, icon: Icon, gradient, className,
}: {
  label: string
  value: string | number
  sub?: string
  icon: LucideIcon
  gradient: string
  className?: string
}) {
  return (
    <div
      className={cn(
        'group relative h-[76px] overflow-hidden rounded-2xl px-4 flex items-center gap-3 text-white',
        'bg-gradient-to-br shadow-md shadow-slate-900/10 ring-1 ring-white/25',
        'transition-all duration-300 hover:-translate-y-0.5 hover:shadow-xl',
        gradient,
        className,
      )}
    >
      {/* dekorasi latar */}
      <span aria-hidden className="pointer-events-none absolute -right-6 -top-10 h-28 w-28 rounded-full bg-white/15" />
      <span aria-hidden className="pointer-events-none absolute right-10 -bottom-12 h-20 w-20 rounded-full bg-white/10" />
      <Icon
        aria-hidden
        className="pointer-events-none absolute right-3 bottom-1.5 h-12 w-12 -rotate-12 text-white/20 transition-transform duration-300 group-hover:scale-110 group-hover:-rotate-6"
      />

      {/* kotak ikon disembunyikan di HP agar label tidak terpotong */}
      <div className="relative hidden h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-white/20 ring-1 ring-white/30 backdrop-blur-sm sm:flex">
        <Icon className="h-5 w-5" />
      </div>
      <div className="relative min-w-0 flex-1">
        <div className="truncate text-[11px] font-semibold uppercase tracking-wide text-white/85">{label}</div>
        <div className="flex items-baseline gap-1.5">
          <span className="text-2xl font-extrabold leading-tight tabular-nums">{value}</span>
          {sub && <span className="hidden truncate text-[10px] font-medium text-white/75 sm:inline">{sub}</span>}
        </div>
      </div>
    </div>
  )
}

// Judul panel dengan ikon bergradasi (warna tema brand tetap dipakai)
function PanelTitle({ icon: Icon, title, caption }: { icon: LucideIcon; title: string; caption?: string }) {
  return (
    <div className="mb-4 flex items-center gap-3">
      <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 text-white shadow-sm shadow-brand-600/30">
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0">
        <h2 className="font-semibold leading-tight text-slate-900">{title}</h2>
        {caption && <p className="text-xs text-slate-400">{caption}</p>}
      </div>
    </div>
  )
}

const GRADE_STYLE: Record<string, string> = {
  A: 'from-emerald-400 to-emerald-600',
  B: 'from-blue-400 to-blue-600',
  C: 'from-yellow-400 to-amber-500',
  D: 'from-orange-400 to-orange-600',
}

export default function AdminDashboard() {
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [siteInfo, setSiteInfo] = useState({ namaSekolah: '', tahunAjaran: '' })

  const load = useCallback(async () => {
    try {
      const res = await apiRequest<DashboardData>('/api/admin/dashboard')
      setData(res)
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }, [])

  const loadSiteInfo = useCallback(() => {
    fetchPublik('/api/public/pengaturan')
      .then(r => r.json())
      .then(json => {
        if (json?.data) setSiteInfo({
          namaSekolah: json.data.namaSekolah ?? '',
          tahunAjaran: json.data.tahunAjaran ?? '',
        })
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    load()
    loadSiteInfo()
    window.addEventListener('pengaturan-changed', loadSiteInfo)
    return () => window.removeEventListener('pengaturan-changed', loadSiteInfo)
  }, [load, loadSiteInfo])

  if (loading) return <PageLoader />

  const stats = data?.stats
  const hariIni = new Date().toLocaleDateString('id-ID', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  })

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="page-title">Dashboard Admin</h1>
          <p className="page-subtitle">
            {siteInfo.namaSekolah
              ? `${siteInfo.namaSekolah}${siteInfo.tahunAjaran ? ' · Tahun Ajaran ' + siteInfo.tahunAjaran : ''}`
              : 'Ringkasan data ujian'}
          </p>
        </div>
        <div className="inline-flex items-center gap-2 rounded-full border border-white/60 bg-white/70 px-3.5 py-1.5 text-xs font-medium text-slate-600 shadow-sm backdrop-blur">
          <Calendar className="h-3.5 w-3.5 text-brand-600" />
          {hariIni}
        </div>
      </div>

      {/* Sesi yang sudah lewat waktunya tapi belum ditutup pengawas (null jika tidak ada) */}
      <SesiBelumDitutupAdmin />

      {/* Kartu informasi (tinggi ±2 cm) */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        <DashCard label="Total Siswa" value={stats?.totalSiswa ?? 0} icon={GraduationCap} gradient="from-brand-500 to-brand-700" />
        <DashCard label="Total Guru" value={stats?.totalGuru ?? 0} icon={Users} gradient="from-emerald-500 to-teal-600" />
        <DashCard label="Jumlah Kelas" value={stats?.totalKelas ?? 0} icon={School} gradient="from-blue-500 to-indigo-600" sub="Rombel" />
        <DashCard label="Mata Pelajaran" value={stats?.totalMapel ?? 0} icon={Library} gradient="from-orange-400 to-orange-600" />
        <DashCard label="Bank Soal" value={stats?.totalPaketSoal ?? 0} icon={BookOpen} gradient="from-fuchsia-500 to-purple-600" sub="Paket soal" />
        <DashCard label="Jadwal Aktif" value={stats?.jadwalAktif ?? 0} icon={Calendar} gradient="from-sky-400 to-sky-600" sub="Ujian mendatang" />
        <DashCard label="Paket Menunggu" value={stats?.paketMenunggu ?? 0} icon={ClipboardCheck} gradient="from-amber-400 to-amber-600" sub="Perlu validasi" />
        <DashCard label="Total Nilai" value={stats?.totalNilai ?? 0} icon={TrendingUp} gradient="from-indigo-500 to-violet-600" sub="Ujian selesai" />
        <DashCard label="Rata-rata Nilai" value={`${stats?.rataRataNilai ?? 0}`} icon={BarChart3} gradient="from-rose-500 to-pink-600" sub="Semua ujian" className="col-span-2 md:col-span-1" />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Nilai per Mapel */}
        <div className="card lg:col-span-1">
          <PanelTitle icon={BarChart3} title="Rata-rata per Mapel" caption="8 mapel teratas" />
          <div className="space-y-3.5">
            {(data?.nilaiPerMapel ?? []).slice(0, 8).map((m, i) => (
              <div key={m.nama}>
                <div className="mb-1 flex items-center justify-between gap-2 text-xs">
                  <span className="flex min-w-0 items-center gap-2 text-slate-600">
                    <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-md bg-brand-50 text-[10px] font-bold text-brand-700">{i + 1}</span>
                    <span className="truncate" title={m.nama}>{m.nama}</span>
                  </span>
                  <span className={`flex-shrink-0 font-bold ${nilaiColor(m.rata)}`}>{m.rata}</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-brand-400 to-brand-600 transition-all duration-700"
                    style={{ width: `${Math.min(m.rata, 100)}%` }}
                  />
                </div>
              </div>
            ))}
            {(data?.nilaiPerMapel?.length ?? 0) === 0 && (
              <p className="py-6 text-center text-sm text-slate-400">Belum ada data nilai</p>
            )}
          </div>
        </div>

        {/* Recent Nilai */}
        <div className="card lg:col-span-2">
          <PanelTitle icon={TrendingUp} title="Nilai Terbaru" caption="Aktivitas ujian terakhir" />
          <div className="space-y-2">
            {(data?.recentNilai ?? []).slice(0, 8).map((n, i) => (
              <div
                key={i}
                className="flex items-center gap-3 rounded-xl border border-slate-100 p-2.5 transition-colors hover:border-brand-200 hover:bg-brand-50/40"
              >
                <div className={cn(
                  'flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-gradient-to-br text-sm font-bold text-white shadow-sm',
                  GRADE_STYLE[n.grade] ?? 'from-red-400 to-red-600',
                )}>
                  {n.grade}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-slate-800">{n.nama_siswa}</div>
                  <div className="truncate text-xs text-slate-400">{n.nama_mapel} · Kelas {n.kelas}</div>
                </div>
                <div className="flex-shrink-0 text-right">
                  <div className={`text-base font-bold leading-tight ${nilaiColor(n.nilai)}`}>{n.nilai}</div>
                  <StatusBadge status={n.lulus ? 'LULUS' : 'TIDAK_LULUS'} />
                </div>
              </div>
            ))}
            {(data?.recentNilai?.length ?? 0) === 0 && (
              <div className="flex items-center justify-center gap-2 py-6 text-slate-400">
                <AlertCircle className="h-4 w-4" />
                <span className="text-sm">Belum ada data nilai</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
