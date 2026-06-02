'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { BookOpen, BarChart3, Calendar, Trophy, Clock, ArrowRight } from 'lucide-react'
import { StatCard, PageLoader, StatusBadge } from '@/components/ui'
import { apiRequest, formatDate, nilaiColor } from '@/lib/utils'
import { Nilai, Jadwal } from '@/types'

interface SiswaDashData {
  stats: { totalUjian: number; rataRata: number; nilaiTertinggi: number; nilaiTerendah: number }
  nilaiTerbaru: Nilai[]
  jadwalMendatang: Jadwal[]
}

export default function SiswaDashboard() {
  const [data, setData] = useState<SiswaDashData | null>(null)
  const [loading, setLoading] = useState(true)
  const [nama, setNama] = useState('')
  const [kelas, setKelas] = useState('')

  useEffect(() => {
    const u = localStorage.getItem('user')
    if (u) { const p = JSON.parse(u); setNama(p.nama); setKelas(p.kelas) }
  }, [])

  const load = useCallback(async () => {
    try {
      const res = await apiRequest<SiswaDashData>('/api/siswa/dashboard')
      setData(res)
    } catch (e) { console.error(e) }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  if (loading) return <PageLoader />

  const stats = data?.stats

  return (
    <div className="space-y-8 animate-fade-in">
      {/* Welcome */}
      <div className="card bg-gradient-to-br from-brand-600 to-brand-700 text-white border-0">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-brand-200 text-sm font-medium">Selamat Datang</p>
            <h1 className="text-2xl font-bold mt-1">{nama}</h1>
            <p className="text-brand-200 text-sm mt-1">Kelas {kelas}</p>
          </div>
          <div className="w-12 h-12 rounded-2xl bg-white/20 backdrop-blur flex items-center justify-center">
            <Trophy className="w-6 h-6 text-white" />
          </div>
        </div>
        <div className="mt-6 flex gap-3">
          <Link href="/siswa/ujian" className="btn bg-white text-brand-700 hover:bg-brand-50 font-semibold">
            <BookOpen className="w-4 h-4" /> Mulai Ujian
          </Link>
          <Link href="/siswa/nilai" className="btn bg-white/20 text-white hover:bg-white/30">
            <BarChart3 className="w-4 h-4" /> Lihat Nilai
          </Link>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Total Ujian" value={stats?.totalUjian ?? 0} icon={BookOpen} color="bg-brand-500" />
        <StatCard label="Rata-rata" value={stats?.rataRata ?? 0} icon={BarChart3} color="bg-emerald-500" />
        <StatCard label="Nilai Tertinggi" value={stats?.nilaiTertinggi ?? 0} icon={Trophy} color="bg-amber-500" />
        <StatCard label="Nilai Terendah" value={stats?.nilaiTerendah ?? 0} icon={Clock} color="bg-slate-500" />
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        {/* Nilai Terbaru */}
        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-slate-900 flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-brand-600" /> Nilai Terbaru
            </h2>
            <Link href="/siswa/nilai" className="text-xs text-brand-600 hover:text-brand-700 flex items-center gap-1">
              Lihat semua <ArrowRight className="w-3 h-3" />
            </Link>
          </div>
          <div className="space-y-2">
            {(data?.nilaiTerbaru ?? []).map((n, i) => (
              <div key={i} className="flex items-center gap-3 p-3 rounded-xl hover:bg-slate-50 transition-colors">
                <div className={`w-9 h-9 rounded-xl flex items-center justify-center text-xs font-bold flex-shrink-0
                  ${n.grade === 'A' ? 'bg-emerald-100 text-emerald-700' :
                    n.grade === 'B' ? 'bg-blue-100 text-blue-700' :
                    n.grade === 'C' ? 'bg-yellow-100 text-yellow-700' :
                    'bg-red-100 text-red-700'}`}>
                  {n.grade}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-slate-800 truncate">{n.nama_mapel}</div>
                  <div className="text-xs text-slate-400">{formatDate(n.timestamp)}</div>
                </div>
                <div className="text-right flex-shrink-0">
                  <div className={`text-base font-bold ${nilaiColor(n.nilai)}`}>{n.nilai}</div>
                  <div className="text-xs text-slate-400">{n.benar}/{n.total}</div>
                </div>
              </div>
            ))}
            {!data?.nilaiTerbaru?.length && (
              <p className="text-sm text-slate-400 text-center py-8">Belum ada nilai ujian</p>
            )}
          </div>
        </div>

        {/* Jadwal Mendatang */}
        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-slate-900 flex items-center gap-2">
              <Calendar className="w-4 h-4 text-brand-600" /> Jadwal Ujian
            </h2>
            <Link href="/siswa/jadwal" className="text-xs text-brand-600 hover:text-brand-700 flex items-center gap-1">
              Lihat semua <ArrowRight className="w-3 h-3" />
            </Link>
          </div>
          <div className="space-y-2">
            {(data?.jadwalMendatang ?? []).map((j) => (
              <div key={j.id} className="flex items-center gap-3 p-3 rounded-xl hover:bg-slate-50 transition-colors border border-slate-100">
                <div className="w-10 h-10 rounded-xl bg-brand-50 flex flex-col items-center justify-center flex-shrink-0">
                  <span className="text-brand-700 text-xs font-bold leading-tight">
                    {new Date(j.tanggal).getDate()}
                  </span>
                  <span className="text-brand-400 text-[10px] leading-tight">
                    {new Date(j.tanggal).toLocaleDateString('id-ID', { month: 'short' })}
                  </span>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-slate-800 truncate">{j.nama_mapel}</div>
                  <div className="text-xs text-slate-400">{j.jam_mulai} – {j.jam_selesai} · {j.durasi} menit</div>
                </div>
                <StatusBadge status={j.status} />
              </div>
            ))}
            {!data?.jadwalMendatang?.length && (
              <p className="text-sm text-slate-400 text-center py-8">Tidak ada jadwal mendatang</p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
