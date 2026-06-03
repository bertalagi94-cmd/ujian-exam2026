'use client'

import { useState, useEffect, useCallback } from 'react'
import { BarChart3, BookOpen, TrendingUp, AlertTriangle, CheckCircle } from 'lucide-react'
import { PageLoader, EmptyState, StatCard } from '@/components/ui'
import { apiRequest } from '@/lib/utils'
import { Mapel } from '@/types'

interface AnalisisSoal {
  id: string
  teks: string
  nama_mapel: string
  tingkat: string
  kunci: string
  totalDijawab: number
  benar: number
  persenBenar: number | null
  distribusi: Record<string, number>
}

interface Ringkasan {
  totalSoal: number
  soalPernahDijawab: number
  rataPersenBenar: number
  soalMudah: number
  soalSedang: number
  soalSulit: number
}

function DistribusiBar({ distribusi, kunci, total }: {
  distribusi: Record<string, number>
  kunci: string
  total: number
}) {
  const opsi = ['A', 'B', 'C', 'D', 'E'].filter(o => distribusi[o] !== undefined && (distribusi[o] > 0 || o === kunci))
  if (total === 0) return <span className="text-xs text-slate-400">Belum ada yang menjawab</span>
  return (
    <div className="flex gap-1 items-end h-8">
      {opsi.map(o => {
        const pct = total > 0 ? Math.round((distribusi[o] / total) * 100) : 0
        const isKunci = o === kunci
        return (
          <div key={o} className="flex flex-col items-center gap-0.5" style={{ minWidth: 24 }}>
            <span className="text-[10px] text-slate-500">{pct}%</span>
            <div
              className={`w-5 rounded-sm transition-all ${isKunci ? 'bg-emerald-500' : 'bg-slate-300'}`}
              style={{ height: Math.max(4, (pct / 100) * 28) }}
              title={`Opsi ${o}: ${distribusi[o]} siswa (${pct}%)`}
            />
            <span className={`text-[10px] font-medium ${isKunci ? 'text-emerald-600' : 'text-slate-500'}`}>{o}</span>
          </div>
        )
      })}
    </div>
  )
}

function TingkatBadge({ persen }: { persen: number | null }) {
  if (persen === null) return <span className="badge badge-gray text-xs">Belum diuji</span>
  if (persen >= 70) return <span className="badge badge-green text-xs">Mudah ({persen}%)</span>
  if (persen >= 40) return <span className="badge badge-yellow text-xs">Sedang ({persen}%)</span>
  return <span className="badge badge-red text-xs">Sulit ({persen}%)</span>
}

export default function GuruAnalisisPage() {
  const [data, setData] = useState<AnalisisSoal[]>([])
  const [mapelList, setMapelList] = useState<Mapel[]>([])
  const [ringkasan, setRingkasan] = useState<Ringkasan | null>(null)
  const [loading, setLoading] = useState(true)
  const [filterMapel, setFilterMapel] = useState('')
  const [filterKesulitan, setFilterKesulitan] = useState<'semua' | 'mudah' | 'sedang' | 'sulit'>('semua')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams(filterMapel ? { mapel_id: filterMapel } : {})
      const res = await apiRequest<{ data: AnalisisSoal[]; mapelList: Mapel[]; ringkasan: Ringkasan }>(
        `/api/guru/analisis?${params}`
      )
      setData(res.data ?? [])
      setMapelList(res.mapelList ?? [])
      setRingkasan(res.ringkasan ?? null)
    } finally {
      setLoading(false)
    }
  }, [filterMapel])

  useEffect(() => { load() }, [load])

  const filtered = data.filter(a => {
    if (filterKesulitan === 'semua') return true
    if (filterKesulitan === 'mudah') return a.persenBenar !== null && a.persenBenar >= 70
    if (filterKesulitan === 'sedang') return a.persenBenar !== null && a.persenBenar >= 40 && a.persenBenar < 70
    if (filterKesulitan === 'sulit') return a.persenBenar !== null && a.persenBenar < 40
    return true
  })

  if (loading) return <PageLoader />

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="page-title">Analisis Soal</h1>
        <p className="page-subtitle">Tingkat kesulitan aktual berdasarkan jawaban siswa</p>
      </div>

      {ringkasan && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard label="Total Soal Disetujui" value={ringkasan.totalSoal} icon={BookOpen} color="bg-brand-500" />
          <StatCard label="Rata-rata Benar" value={`${ringkasan.rataPersenBenar}%`} icon={BarChart3} color="bg-emerald-500" />
          <StatCard label="Soal Mudah" value={ringkasan.soalMudah} icon={CheckCircle} color="bg-emerald-400" />
          <StatCard label="Soal Sulit" value={ringkasan.soalSulit} icon={AlertTriangle} color="bg-red-500" />
        </div>
      )}

      {/* Filter */}
      <div className="card py-4 flex gap-3 flex-wrap items-center">
        <select
          value={filterMapel}
          onChange={e => setFilterMapel(e.target.value)}
          className="select w-48"
        >
          <option value="">Semua Mata Pelajaran</option>
          {mapelList.map(m => <option key={m.id} value={m.id}>{m.nama}</option>)}
        </select>

        <div className="flex gap-1">
          {(['semua', 'mudah', 'sedang', 'sulit'] as const).map(k => (
            <button
              key={k}
              onClick={() => setFilterKesulitan(k)}
              className={`btn-sm px-3 capitalize ${filterKesulitan === k ? 'btn-primary' : 'btn-secondary'}`}
            >
              {k}
            </button>
          ))}
        </div>

        <span className="text-xs text-slate-400 ml-auto">{filtered.length} soal</span>
      </div>

      {filtered.length === 0 ? (
        <div className="card">
          <EmptyState
            message={data.length === 0
              ? 'Belum ada soal yang disetujui. Kirim soal ke admin terlebih dahulu.'
              : 'Tidak ada soal yang sesuai filter.'}
            icon={BarChart3}
          />
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((soal, i) => (
            <div key={soal.id} className="card">
              <div className="flex items-start gap-3">
                <span className="w-7 h-7 rounded-lg bg-slate-100 text-slate-500 text-xs font-bold flex items-center justify-center flex-shrink-0 mt-0.5">
                  {i + 1}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-slate-800 leading-relaxed mb-3">{soal.teks}</p>
                  <div className="flex flex-wrap items-center gap-4">
                    {/* Tingkat aktual */}
                    <TingkatBadge persen={soal.persenBenar} />

                    {/* Kunci */}
                    <span className="text-xs text-slate-500">
                      Kunci: <span className="font-bold text-emerald-600">{soal.kunci}</span>
                    </span>

                    {/* Total dijawab */}
                    <span className="text-xs text-slate-500">
                      Dijawab: <span className="font-medium text-slate-700">{soal.totalDijawab} siswa</span>
                    </span>

                    {soal.totalDijawab > 0 && (
                      <span className="text-xs text-slate-500">
                        Benar: <span className="font-medium text-emerald-600">{soal.benar}</span>
                      </span>
                    )}

                    {/* Tingkat dari guru */}
                    <span className={`text-xs px-2 py-0.5 rounded-full ${
                      soal.tingkat === 'Mudah' ? 'bg-emerald-50 text-emerald-600' :
                      soal.tingkat === 'Sedang' ? 'bg-amber-50 text-amber-600' :
                      'bg-red-50 text-red-600'
                    }`}>
                      Guru: {soal.tingkat}
                    </span>
                  </div>

                  {/* Distribusi jawaban */}
                  {soal.totalDijawab > 0 && (
                    <div className="mt-3">
                      <p className="text-xs text-slate-400 mb-1">Distribusi jawaban siswa</p>
                      <DistribusiBar
                        distribusi={soal.distribusi}
                        kunci={soal.kunci}
                        total={soal.totalDijawab}
                      />
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
