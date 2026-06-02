'use client'

import { useState, useEffect, useCallback } from 'react'
import { BarChart3, Users, BookOpen, TrendingUp } from 'lucide-react'
import { StatCard, PageLoader } from '@/components/ui'
import { apiRequest, nilaiColor } from '@/lib/utils'

interface KepsekData {
  stats: { totalSiswa: number; totalGuru: number; totalUjian: number; rataRata: number }
  nilaiPerKelas: Array<{ kelas: string; rata: number; total: number; lulus: number }>
  nilaiPerMapel: Array<{ nama: string; rata: number; total: number }>
}

export default function KepsekDashboard() {
  const [data, setData] = useState<KepsekData | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    try {
      const res = await apiRequest<KepsekData>('/api/kepsek/dashboard')
      setData(res)
    } finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  if (loading) return <PageLoader />

  return (
    <div className="space-y-8 animate-fade-in">
      <div>
        <h1 className="page-title">Dashboard Kepala Sekolah</h1>
        <p className="page-subtitle">Ringkasan akademik MTS Alkhairaat Tatakalai</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Total Siswa" value={data?.stats.totalSiswa ?? 0} icon={Users} color="bg-brand-500" />
        <StatCard label="Total Guru" value={data?.stats.totalGuru ?? 0} icon={Users} color="bg-emerald-500" />
        <StatCard label="Total Ujian" value={data?.stats.totalUjian ?? 0} icon={BookOpen} color="bg-purple-500" />
        <StatCard label="Rata-rata Nilai" value={data?.stats.rataRata ?? 0} icon={TrendingUp} color="bg-amber-500" />
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        {/* Per Kelas */}
        <div className="card">
          <h2 className="font-semibold text-slate-900 mb-4 flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-brand-600" /> Rata-rata per Kelas
          </h2>
          <div className="space-y-3">
            {(data?.nilaiPerKelas ?? []).map(k => (
              <div key={k.kelas}>
                <div className="flex items-center justify-between text-sm mb-1">
                  <span className="font-medium text-slate-700">Kelas {k.kelas}</span>
                  <div className="flex items-center gap-3 text-xs text-slate-500">
                    <span>{k.total} siswa</span>
                    <span className="text-emerald-600">{Math.round((k.lulus / k.total) * 100)}% lulus</span>
                    <span className={`font-bold text-sm ${nilaiColor(k.rata)}`}>{k.rata}</span>
                  </div>
                </div>
                <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                  <div className="h-full bg-brand-500 rounded-full" style={{ width: `${Math.min(k.rata, 100)}%` }} />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Per Mapel */}
        <div className="card">
          <h2 className="font-semibold text-slate-900 mb-4 flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-brand-600" /> Rata-rata per Mapel
          </h2>
          <div className="space-y-3">
            {(data?.nilaiPerMapel ?? []).slice(0, 10).map(m => (
              <div key={m.nama}>
                <div className="flex items-center justify-between text-xs mb-1">
                  <span className="text-slate-600 truncate max-w-[160px]" title={m.nama}>{m.nama}</span>
                  <span className={`font-bold text-sm ${nilaiColor(m.rata)}`}>{m.rata}</span>
                </div>
                <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                  <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${Math.min(m.rata, 100)}%` }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
