'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { BarChart3, Trophy, Users, TrendingDown, TrendingUp, Medal } from 'lucide-react'
import { apiRequest, nilaiColor, gradeColor } from '@/lib/utils'
import { PageLoader, EmptyState, StatCard } from '@/components/ui'

interface OpsiResponse {
  kelasList: string[]
  mapelPerKelas: Record<string, { id: string; nama: string }[]>
}

interface NilaiRow {
  id: string
  nis: string
  nama_siswa: string
  nilai: number
  grade: string
  benar: number
  total: number
  lulus: boolean
  kkm: number
  rank: number
}

interface NilaiResponse {
  data: NilaiRow[]
  nama_mapel: string
  summary: {
    jumlahSiswa: number
    rataRata: number
    nilaiTertinggi: number
    nilaiTerendah: number
    jumlahLulus: number
    jumlahTidakLulus: number
  }
}

export default function KepsekNilaiPage() {
  const [opsi, setOpsi] = useState<OpsiResponse | null>(null)
  const [kelas, setKelas] = useState('')
  const [mapelId, setMapelId] = useState('')
  const [result, setResult] = useState<NilaiResponse | null>(null)
  const [loadingOpsi, setLoadingOpsi] = useState(true)
  const [loadingResult, setLoadingResult] = useState(false)

  useEffect(() => {
    (async () => {
      try {
        const res = await apiRequest<OpsiResponse>('/api/kepsek/nilai?mode=opsi')
        setOpsi(res)
        if (res.kelasList.length) setKelas(res.kelasList[0])
      } finally { setLoadingOpsi(false) }
    })()
  }, [])

  const mapelOptions = useMemo(() => opsi?.mapelPerKelas[kelas] ?? [], [opsi, kelas])

  useEffect(() => {
    if (mapelOptions.length) setMapelId(mapelOptions[0].id)
    else setMapelId('')
  }, [mapelOptions])

  const loadResult = useCallback(async () => {
    if (!kelas || !mapelId) { setResult(null); return }
    setLoadingResult(true)
    try {
      const res = await apiRequest<NilaiResponse>(`/api/kepsek/nilai?kelas=${encodeURIComponent(kelas)}&mapel_id=${encodeURIComponent(mapelId)}`)
      setResult(res)
    } finally { setLoadingResult(false) }
  }, [kelas, mapelId])

  useEffect(() => { loadResult() }, [loadResult])

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="page-title">Hasil Ujian</h1>
        <p className="page-subtitle">Rekap nilai per kelas untuk mapel yang sudah dilaksanakan ujiannya</p>
      </div>

      {loadingOpsi ? <PageLoader /> : !opsi?.kelasList.length ? (
        <div className="card"><EmptyState message="Belum ada data nilai untuk ditampilkan" icon={BarChart3} /></div>
      ) : (
        <>
          <div className="flex flex-wrap gap-3">
            <select className="select w-auto" value={kelas} onChange={e => setKelas(e.target.value)}>
              {opsi.kelasList.map(k => <option key={k} value={k}>Kelas {k}</option>)}
            </select>
            <select className="select w-auto" value={mapelId} onChange={e => setMapelId(e.target.value)} disabled={!mapelOptions.length}>
              {mapelOptions.length === 0 && <option value="">Belum ada mapel diujiankan</option>}
              {mapelOptions.map(m => <option key={m.id} value={m.id}>{m.nama}</option>)}
            </select>
          </div>

          {loadingResult ? <PageLoader /> : !result || !mapelOptions.length ? (
            <div className="card"><EmptyState message="Pilih kelas dan mapel untuk melihat hasil ujian" icon={BarChart3} /></div>
          ) : (
            <>
              <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
                <StatCard label="Jumlah Siswa" value={result.summary.jumlahSiswa} icon={Users} color="bg-brand-500" />
                <StatCard label="Rata-rata" value={result.summary.rataRata} icon={BarChart3} color="bg-purple-500" />
                <StatCard label="Nilai Tertinggi" value={result.summary.nilaiTertinggi} icon={TrendingUp} color="bg-emerald-500" />
                <StatCard label="Nilai Terendah" value={result.summary.nilaiTerendah} icon={TrendingDown} color="bg-orange-500" />
                <StatCard
                  label="Lulus / Tidak Lulus"
                  value={`${result.summary.jumlahLulus} / ${result.summary.jumlahTidakLulus}`}
                  icon={Trophy}
                  color="bg-amber-500"
                />
              </div>

              <div className="card">
                <h2 className="font-semibold text-slate-900 mb-4 flex items-center gap-2">
                  <BarChart3 className="w-4 h-4 text-brand-600" /> Tabel Hasil Ujian — {result.nama_mapel} (Kelas {kelas})
                </h2>
                {!result.data.length ? (
                  <EmptyState message="Belum ada nilai untuk kombinasi ini" icon={BarChart3} />
                ) : (
                  <div className="table-wrapper">
                    <table className="table">
                      <thead>
                        <tr>
                          <th>Rank</th>
                          <th>Nama Siswa</th>
                          <th>Benar</th>
                          <th>Nilai</th>
                          <th>Grade</th>
                          <th>Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {result.data.map(r => (
                          <tr key={r.id}>
                            <td>
                              {r.rank <= 3 ? (
                                <span className="inline-flex items-center gap-1 font-semibold text-amber-600">
                                  <Medal className="w-3.5 h-3.5" /> {r.rank}
                                </span>
                              ) : r.rank}
                            </td>
                            <td className="font-medium text-slate-800">{r.nama_siswa}</td>
                            <td className="text-slate-500">{r.benar}/{r.total}</td>
                            <td className={`font-bold ${nilaiColor(r.nilai)}`}>{r.nilai}</td>
                            <td><span className={`badge ${gradeColor(r.grade)}`}>{r.grade}</span></td>
                            <td>
                              <span className={`badge ${r.lulus ? 'badge-green' : 'badge-red'}`}>{r.lulus ? 'Lulus' : 'Tidak Lulus'}</span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </>
          )}
        </>
      )}
    </div>
  )
}
