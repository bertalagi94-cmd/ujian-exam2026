'use client'

import { useState, useEffect, useCallback } from 'react'
import { BookOpen, ClipboardList, BarChart3, CheckCircle, Clock, XCircle, TrendingUp } from 'lucide-react'
import { StatCard, PageLoader, StatusBadge, Badge } from '@/components/ui'
import { apiRequest, formatDate, nilaiColor } from '@/lib/utils'

interface GuruDashData {
  stats: {
    totalSoal: number
    soalDisetujui: number
    soalMenunggu: number
    soalDitolak: number
    totalPaket: number
    totalNilai: number
    rataRataNilai: number
  }
  paketTerbaru: Array<{
    id: string
    nama_mapel: string
    nama_kelas: string
    status: string
    jumlah_soal: number
    tanggal: string
  }>
  nilaiTerbaru: Array<{
    nama_siswa: string
    nama_mapel: string
    nilai: number
    grade: string
    kelas: string
    timestamp: string
  }>
}

export default function GuruDashboard() {
  const [data, setData] = useState<GuruDashData | null>(null)
  const [loading, setLoading] = useState(true)
  const [namaGuru, setNamaGuru] = useState('')

  useEffect(() => {
    const user = localStorage.getItem('user')
    if (user) setNamaGuru(JSON.parse(user).nama ?? '')
  }, [])

  const load = useCallback(async () => {
    try {
      const res = await apiRequest<GuruDashData>('/api/guru/dashboard')
      setData(res)
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  if (loading) return <PageLoader />

  const stats = data?.stats

  return (
    <div className="space-y-8 animate-fade-in">
      <div>
        <h1 className="page-title">Selamat Datang, {namaGuru.split(' ')[0]}</h1>
        <p className="page-subtitle">Kelola soal dan pantau perkembangan siswa Anda</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Total Soal" value={stats?.totalSoal ?? 0} icon={BookOpen} color="bg-brand-500" />
        <StatCard label="Soal Disetujui" value={stats?.soalDisetujui ?? 0} icon={CheckCircle} color="bg-emerald-500" />
        <StatCard label="Menunggu Validasi" value={stats?.soalMenunggu ?? 0} icon={Clock} color="bg-amber-500" />
        <StatCard label="Ditolak" value={stats?.soalDitolak ?? 0} icon={XCircle} color="bg-red-500" />
      </div>

      <div className="grid grid-cols-3 gap-4">
        <StatCard label="Total Paket" value={stats?.totalPaket ?? 0} icon={ClipboardList} color="bg-purple-500" />
        <StatCard label="Rekap Nilai" value={stats?.totalNilai ?? 0} icon={BarChart3} color="bg-cyan-500" />
        <StatCard label="Rata-rata Nilai" value={stats?.rataRataNilai ?? 0} icon={TrendingUp} color="bg-indigo-500" />
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        {/* Paket Terbaru */}
        <div className="card">
          <h2 className="font-semibold text-slate-900 mb-4 flex items-center gap-2">
            <ClipboardList className="w-4 h-4 text-brand-600" />
            Paket Soal Terbaru
          </h2>
          <div className="space-y-2">
            {(data?.paketTerbaru ?? []).map(p => (
              <div key={p.id} className="flex items-center justify-between p-3 rounded-xl hover:bg-slate-50 transition-colors">
                <div>
                  <div className="text-sm font-medium text-slate-800">{p.nama_mapel}</div>
                  <div className="text-xs text-slate-400">Kelas {p.nama_kelas} · {p.jumlah_soal} soal · {formatDate(p.tanggal)}</div>
                </div>
                <StatusBadge status={p.status} />
              </div>
            ))}
            {!data?.paketTerbaru?.length && (
              <p className="text-sm text-slate-400 text-center py-6">Belum ada paket soal</p>
            )}
          </div>
        </div>

        {/* Nilai Terbaru */}
        <div className="card">
          <h2 className="font-semibold text-slate-900 mb-4 flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-brand-600" />
            Nilai Terbaru Siswa
          </h2>
          <div className="space-y-2">
            {(data?.nilaiTerbaru ?? []).map((n, i) => (
              <div key={i} className="flex items-center gap-3 p-3 rounded-xl hover:bg-slate-50 transition-colors">
                <div className={`w-9 h-9 rounded-xl flex items-center justify-center text-xs font-bold flex-shrink-0 ${
                  n.grade === 'A' ? 'bg-emerald-100 text-emerald-700' :
                  n.grade === 'B' ? 'bg-blue-100 text-blue-700' :
                  n.grade === 'C' ? 'bg-yellow-100 text-yellow-700' :
                  'bg-red-100 text-red-700'
                }`}>{n.grade}</div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-slate-800 truncate">{n.nama_siswa}</div>
                  <div className="text-xs text-slate-400">{n.nama_mapel} · Kelas {n.kelas}</div>
                </div>
                <span className={`text-base font-bold flex-shrink-0 ${nilaiColor(n.nilai)}`}>{n.nilai}</span>
              </div>
            ))}
            {!data?.nilaiTerbaru?.length && (
              <p className="text-sm text-slate-400 text-center py-6">Belum ada data nilai</p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
