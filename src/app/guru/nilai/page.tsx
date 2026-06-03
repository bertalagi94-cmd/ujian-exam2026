'use client'

import { useState, useEffect, useCallback } from 'react'
import { Download, BarChart3, Trophy, TrendingUp, Users, CheckCircle } from 'lucide-react'
import { PageLoader, EmptyState, SearchInput, StatCard } from '@/components/ui'
import { apiRequest, formatDateTime, nilaiColor } from '@/lib/utils'
import { Nilai, Mapel } from '@/types'

interface Stats {
  total: number
  rataRata: number
  tertinggi: number
  terendah: number
  lulus: number
  tidakLulus: number
}

export default function GuruNilaiPage() {
  const [nilaiList, setNilaiList] = useState<Nilai[]>([])
  const [mapelList, setMapelList] = useState<Mapel[]>([])
  const [stats, setStats] = useState<Stats | null>(null)
  const [loading, setLoading] = useState(true)
  const [filterMapel, setFilterMapel] = useState('')
  const [filterKelas, setFilterKelas] = useState('')
  const [search, setSearch] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({
        ...(filterMapel && { mapel_id: filterMapel }),
        ...(filterKelas && { kelas: filterKelas }),
      })
      const res = await apiRequest<{ data: Nilai[]; stats: Stats; mapelList: Mapel[] }>(
        `/api/guru/nilai?${params}`
      )
      setNilaiList(res.data ?? [])
      setStats(res.stats)
      if (res.mapelList?.length) setMapelList(res.mapelList)
    } finally {
      setLoading(false)
    }
  }, [filterMapel, filterKelas])

  useEffect(() => { load() }, [load])

  const kelasList = [...new Set(nilaiList.map(n => n.kelas))].sort()

  const filtered = nilaiList.filter(n =>
    !search || (n.nama_siswa ?? '').toLowerCase().includes(search.toLowerCase())
  )

  function exportCSV() {
    const header = ['Nama Siswa', 'Kelas', 'Mata Pelajaran', 'Nilai', 'Grade', 'Benar', 'Total', 'KKM', 'Status', 'Tanggal']
    const rows = filtered.map(n => [
      n.nama_siswa, n.kelas, n.nama_mapel, n.nilai, n.grade,
      n.benar, n.total, n.kkm, n.lulus ? 'Lulus' : 'Tidak Lulus', n.timestamp,
    ])
    const csv = [header, ...rows].map(r => r.join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `rekap-nilai-guru-${Date.now()}.csv`
    a.click()
  }

  if (loading) return <PageLoader />

  const persenLulus = stats && stats.total > 0
    ? Math.round((stats.lulus / stats.total) * 100)
    : 0

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="page-title">Rekap Nilai</h1>
          <p className="page-subtitle">Nilai siswa dari mata pelajaran yang Anda ampu</p>
        </div>
        {filtered.length > 0 && (
          <button onClick={exportCSV} className="btn-secondary btn-sm">
            <Download className="w-4 h-4" /> Export CSV
          </button>
        )}
      </div>

      {stats && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard label="Total Ujian" value={stats.total} icon={Users} color="bg-brand-500" />
          <StatCard label="Rata-rata Nilai" value={stats.rataRata} icon={BarChart3} color="bg-emerald-500" />
          <StatCard label="Nilai Tertinggi" value={stats.tertinggi} icon={Trophy} color="bg-amber-500" />
          <StatCard label="Persentase Lulus" value={`${persenLulus}%`} icon={CheckCircle} color="bg-cyan-500" />
        </div>
      )}

      {/* Filter */}
      <div className="card py-4 flex gap-3 flex-wrap">
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder="Cari nama siswa..."
          className="flex-1 min-w-[180px]"
        />
        <select
          value={filterMapel}
          onChange={e => setFilterMapel(e.target.value)}
          className="select w-44"
        >
          <option value="">Semua Mapel</option>
          {mapelList.map(m => <option key={m.id} value={m.id}>{m.nama}</option>)}
        </select>
        <select
          value={filterKelas}
          onChange={e => setFilterKelas(e.target.value)}
          className="select w-36"
        >
          <option value="">Semua Kelas</option>
          {kelasList.map(k => <option key={k} value={k}>{k}</option>)}
        </select>
      </div>

      <div className="card p-0 overflow-hidden">
        {filtered.length === 0 ? (
          <EmptyState message="Belum ada data nilai" icon={BarChart3} />
        ) : (
          <div className="table-wrapper">
            <table className="table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Nama Siswa</th>
                  <th>Kelas</th>
                  <th>Mata Pelajaran</th>
                  <th>Nilai</th>
                  <th>Grade</th>
                  <th>Benar/Total</th>
                  <th>KKM</th>
                  <th>Status</th>
                  <th>Tanggal</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((n, i) => (
                  <tr key={n.id}>
                    <td className="text-slate-400 text-xs">{i + 1}</td>
                    <td className="font-medium text-slate-800">{n.nama_siswa}</td>
                    <td><span className="badge-blue text-xs">{n.kelas}</span></td>
                    <td className="text-sm text-slate-600">{n.nama_mapel}</td>
                    <td>
                      <span className={`text-lg font-bold ${nilaiColor(n.nilai)}`}>{n.nilai}</span>
                    </td>
                    <td>
                      <span className={`badge font-bold ${
                        n.grade === 'A' ? 'badge-green' :
                        n.grade === 'B' ? 'badge-blue' :
                        n.grade === 'C' ? 'badge-yellow' : 'badge-red'
                      }`}>{n.grade}</span>
                    </td>
                    <td className="text-slate-600 text-sm">{n.benar}/{n.total}</td>
                    <td className="text-slate-500 text-sm">{n.kkm}</td>
                    <td>
                      <span className={`badge ${n.lulus ? 'badge-green' : 'badge-red'}`}>
                        {n.lulus ? '✓ Lulus' : '✗ Tidak Lulus'}
                      </span>
                    </td>
                    <td className="text-xs text-slate-400">{formatDateTime(n.timestamp)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
