'use client'

import { useState, useEffect, useCallback } from 'react'
import { Users, BookOpen, GraduationCap, BarChart3, Calendar, ClipboardCheck, TrendingUp, AlertCircle } from 'lucide-react'
import { StatCard, PageLoader, Badge, StatusBadge } from '@/components/ui'
import { apiRequest, formatDateTime, nilaiColor } from '@/lib/utils'

interface DashboardData {
  stats: {
    totalSiswa: number
    totalGuru: number
    totalSoal: number
    totalNilai: number
    totalMapel: number
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
    fetch('/api/public/pengaturan?t=' + Date.now(), { cache: 'no-store' })
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

  return (
    <div className="space-y-8 animate-fade-in">
      {/* Header */}
      <div>
        <h1 className="page-title">Dashboard Admin</h1>
        <p className="page-subtitle">
          {siteInfo.namaSekolah
            ? `${siteInfo.namaSekolah}${siteInfo.tahunAjaran ? ' · Tahun Ajaran ' + siteInfo.tahunAjaran : ''}`
            : 'Dashboard Admin'}
        </p>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Total Siswa" value={stats?.totalSiswa ?? 0} icon={GraduationCap} color="bg-brand-500" />
        <StatCard label="Total Guru" value={stats?.totalGuru ?? 0} icon={Users} color="bg-emerald-500" />
        <StatCard label="Bank Soal" value={stats?.totalSoal ?? 0} icon={BookOpen} color="bg-purple-500" />
        <StatCard label="Mata Pelajaran" value={stats?.totalMapel ?? 0} icon={BarChart3} color="bg-orange-500" />
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Jadwal Aktif" value={stats?.jadwalAktif ?? 0} icon={Calendar} color="bg-cyan-500" sub="Ujian mendatang" />
        <StatCard label="Paket Menunggu" value={stats?.paketMenunggu ?? 0} icon={ClipboardCheck} color="bg-amber-500" sub="Perlu validasi" />
        <StatCard label="Total Nilai" value={stats?.totalNilai ?? 0} icon={TrendingUp} color="bg-indigo-500" sub="Ujian selesai" />
        <StatCard label="Rata-rata Nilai" value={`${stats?.rataRataNilai ?? 0}`} icon={BarChart3} color="bg-rose-500" sub="Semua ujian" />
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        {/* Nilai per Mapel */}
        <div className="card lg:col-span-1">
          <h2 className="font-semibold text-slate-900 mb-4 flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-brand-600" />
            Rata-rata per Mapel
          </h2>
          <div className="space-y-3">
            {(data?.nilaiPerMapel ?? []).slice(0, 8).map((m) => (
              <div key={m.nama}>
                <div className="flex items-center justify-between text-xs mb-1">
                  <span className="text-slate-600 truncate max-w-[140px]" title={m.nama}>{m.nama}</span>
                  <span className={`font-semibold ${nilaiColor(m.rata)}`}>{m.rata}</span>
                </div>
                <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-brand-500 rounded-full transition-all duration-700"
                    style={{ width: `${Math.min(m.rata, 100)}%` }}
                  />
                </div>
              </div>
            ))}
            {(data?.nilaiPerMapel?.length ?? 0) === 0 && (
              <p className="text-sm text-slate-400 text-center py-6">Belum ada data nilai</p>
            )}
          </div>
        </div>

        {/* Recent Nilai */}
        <div className="card lg:col-span-2">
          <h2 className="font-semibold text-slate-900 mb-4 flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-brand-600" />
            Nilai Terbaru
          </h2>
          <div className="space-y-2">
            {(data?.recentNilai ?? []).slice(0, 8).map((n, i) => (
              <div key={i} className="flex items-center gap-3 p-3 rounded-xl hover:bg-slate-50 transition-colors">
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-sm font-bold flex-shrink-0 ${
                  n.grade === 'A' ? 'bg-emerald-100 text-emerald-700' :
                  n.grade === 'B' ? 'bg-blue-100 text-blue-700' :
                  n.grade === 'C' ? 'bg-yellow-100 text-yellow-700' :
                  n.grade === 'D' ? 'bg-orange-100 text-orange-700' :
                  'bg-red-100 text-red-700'
                }`}>
                  {n.grade}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-slate-800 truncate">{n.nama_siswa}</div>
                  <div className="text-xs text-slate-400">{n.nama_mapel} · Kelas {n.kelas}</div>
                </div>
                <div className="text-right flex-shrink-0">
                  <div className={`text-base font-bold ${nilaiColor(n.nilai)}`}>{n.nilai}</div>
                  <StatusBadge status={n.lulus ? 'LULUS' : 'TIDAK_LULUS'} />
                </div>
              </div>
            ))}
            {(data?.recentNilai?.length ?? 0) === 0 && (
              <div className="flex items-center gap-2 text-slate-400 py-6 justify-center">
                <AlertCircle className="w-4 h-4" />
                <span className="text-sm">Belum ada data nilai</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
