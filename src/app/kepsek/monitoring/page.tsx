'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { Eye, Users, CheckCircle2, AlertCircle, ChevronDown, ChevronUp } from 'lucide-react'
import { apiRequest, formatDateTime } from '@/lib/utils'
import { PageLoader, EmptyState } from '@/components/ui'

interface MonitoringRow {
  kelas: string
  mapel_id: string
  nama_mapel: string
  waktu_selesai: string
  totalSiswa: number
  jumlahSudah: number
  jumlahBelum: number
  siswaBelum: { nis: string; nama: string }[]
}

interface MonitoringResponse {
  kelasList: string[]
  data: MonitoringRow[]
}

export default function KepsekMonitoringPage() {
  const [data, setData] = useState<MonitoringRow[]>([])
  const [kelasList, setKelasList] = useState<string[]>([])
  const [kelasFilter, setKelasFilter] = useState('')
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (kelasFilter) params.set('kelas', kelasFilter)
      const res = await apiRequest<MonitoringResponse>(`/api/kepsek/monitoring?${params}`)
      setData(res.data ?? [])
      setKelasList(res.kelasList ?? [])
    } finally { setLoading(false) }
  }, [kelasFilter])

  useEffect(() => { load() }, [load])

  const grouped = useMemo(() => {
    const map: Record<string, MonitoringRow[]> = {}
    for (const r of data) {
      if (!map[r.kelas]) map[r.kelas] = []
      map[r.kelas].push(r)
    }
    return Object.entries(map).sort(([a], [b]) => a.localeCompare(b))
  }, [data])

  const totalBelum = useMemo(() => data.reduce((sum, r) => sum + r.jumlahBelum, 0), [data])

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="page-title">Monitoring Ujian</h1>
        <p className="page-subtitle">Status pelaksanaan ujian per kelas dan daftar siswa yang belum mengikuti</p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <div className="card-sm">
          <p className="text-xs text-slate-500">Kombinasi Kelas + Mapel</p>
          <p className="text-xl font-bold text-slate-900 mt-0.5">{data.length}</p>
        </div>
        <div className="card-sm">
          <p className="text-xs text-slate-500">Total Siswa Belum Ujian</p>
          <p className={`text-xl font-bold mt-0.5 ${totalBelum > 0 ? 'text-amber-600' : 'text-emerald-600'}`}>{totalBelum}</p>
        </div>
        <div className="card-sm">
          <p className="text-xs text-slate-500">Jumlah Kelas Termonitor</p>
          <p className="text-xl font-bold text-slate-900 mt-0.5">{grouped.length}</p>
        </div>
      </div>

      <div className="flex flex-wrap gap-3">
        <select className="select w-auto" value={kelasFilter} onChange={e => setKelasFilter(e.target.value)}>
          <option value="">Semua Kelas</option>
          {kelasList.map(k => <option key={k} value={k}>Kelas {k}</option>)}
        </select>
      </div>

      {loading ? <PageLoader /> : !data.length ? (
        <div className="card"><EmptyState message="Belum ada mapel yang selesai diujiankan" icon={Eye} /></div>
      ) : (
        <div className="space-y-8">
          {grouped.map(([kelasNama, rows]) => (
            <div key={kelasNama}>
              <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-wide mb-3">Kelas {kelasNama}</h3>
              <div className="space-y-2.5">
                {rows.map(r => {
                  const key = `${r.kelas}__${r.mapel_id}`
                  const isOpen = expanded === key
                  const persen = r.totalSiswa > 0 ? Math.round((r.jumlahSudah / r.totalSiswa) * 100) : 0
                  const lengkap = r.jumlahBelum === 0
                  return (
                    <div key={key} className="rounded-2xl bg-white border border-slate-100 overflow-hidden transition-all hover:shadow-card-md">
                      <button
                        onClick={() => setExpanded(isOpen ? null : key)}
                        className="w-full flex items-center gap-4 p-4 text-left"
                      >
                        <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${lengkap ? 'bg-emerald-100' : 'bg-amber-100'}`}>
                          {lengkap ? <CheckCircle2 className="w-5 h-5 text-emerald-600" /> : <AlertCircle className="w-5 h-5 text-amber-600" />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-semibold text-slate-900">{r.nama_mapel}</span>
                            <span className="text-xs text-slate-400">selesai {formatDateTime(r.waktu_selesai)}</span>
                          </div>
                          <div className="flex items-center gap-3 mt-1.5">
                            <div className="h-1.5 flex-1 max-w-[200px] bg-slate-100 rounded-full overflow-hidden">
                              <div
                                className={`h-full rounded-full ${lengkap ? 'bg-emerald-500' : 'bg-amber-500'}`}
                                style={{ width: `${persen}%` }}
                              />
                            </div>
                            <span className="text-xs text-slate-500 flex items-center gap-1 flex-shrink-0">
                              <Users className="w-3 h-3" /> {r.jumlahSudah}/{r.totalSiswa} sudah ujian
                            </span>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          {r.jumlahBelum > 0 && (
                            <span className="badge bg-amber-50 text-amber-700 ring-1 ring-amber-600/20">{r.jumlahBelum} belum ujian</span>
                          )}
                          {isOpen ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
                        </div>
                      </button>
                      {isOpen && (
                        <div className="px-4 pb-4 animate-slide-up">
                          {r.siswaBelum.length === 0 ? (
                            <p className="text-sm text-emerald-600 bg-emerald-50 rounded-xl px-3 py-2.5">Semua siswa sudah mengikuti ujian ini.</p>
                          ) : (
                            <div className="table-wrapper">
                              <table className="table">
                                <thead>
                                  <tr><th>NIS</th><th>Nama Siswa</th></tr>
                                </thead>
                                <tbody>
                                  {r.siswaBelum.map(s => (
                                    <tr key={s.nis}>
                                      <td className="text-slate-500">{s.nis}</td>
                                      <td className="font-medium text-slate-800">{s.nama}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
