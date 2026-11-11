'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { BarChart3, Users, TrendingDown, TrendingUp, AlertTriangle } from 'lucide-react'
import { apiRequest, nilaiColor, gradeColor } from '@/lib/utils'
import { PageLoader, EmptyState, StatCard, ScopeWarningBanner } from '@/components/ui'

interface OpsiResponse {
  kelasList: string[]
  mapelPerKelas: Record<string, { id: string; nama: string }[]>
  scopeWarning?: string
}

interface NilaiRow {
  id: string
  nis: string
  nama_siswa: string
  nilai: number
  nilai_efektif: number
  grade: string
  benar: number
  total: number
  lulus: boolean
  kkm: number
  rank: number
  selisih_rata: number
  perlu_perhatian: boolean
  essay_aktif?: boolean
  essay_belum_dirilis?: boolean
}

interface NilaiResponse {
  data: NilaiRow[]
  nama_mapel: string
  selisihPerhatian: number
  summary: {
    jumlahSiswa: number
    rataRata: number
    nilaiTertinggi: number
    nilaiTerendah: number
    jumlahLulus: number
    jumlahTidakLulus: number
    jumlahPerluPerhatian: number
  }
}

export default function BkNilaiPage() {
  const [opsi, setOpsi] = useState<OpsiResponse | null>(null)
  const [kelas, setKelas] = useState('')
  const [mapelId, setMapelId] = useState('')
  const [result, setResult] = useState<NilaiResponse | null>(null)
  const [loadingOpsi, setLoadingOpsi] = useState(true)
  const [loadingResult, setLoadingResult] = useState(false)
  const [hanyaPerhatian, setHanyaPerhatian] = useState(false)

  useEffect(() => {
    (async () => {
      try {
        const res = await apiRequest<OpsiResponse>('/api/bk/nilai?mode=opsi')
        setOpsi(res)
        if (res.kelasList.length) setKelas(res.kelasList[0])
      } finally { setLoadingOpsi(false) }
    })()
  }, [])

  const mapelOptions = useMemo(() => opsi?.mapelPerKelas[kelas] ?? [], [opsi, kelas])

  // Saat kelas berubah, reset mapel di sini (bukan di effect terpisah) supaya tidak
  // ada fetch dengan kombinasi kelas-baru + mapel-lama (pola yang sama dengan halaman Kepsek).
  const [pendingKelas, setPendingKelas] = useState('')
  useEffect(() => {
    if (kelas === pendingKelas) return
    setPendingKelas(kelas)
    const validId = mapelOptions.length ? mapelOptions[0].id : ''
    setMapelId(validId)
    if (!validId) setResult(null)
  }, [kelas, pendingKelas, mapelOptions])

  const loadResult = useCallback(async () => {
    if (!kelas || !mapelId || kelas !== pendingKelas) return
    setLoadingResult(true)
    try {
      setResult(await apiRequest<NilaiResponse>(`/api/bk/nilai?kelas=${encodeURIComponent(kelas)}&mapel_id=${encodeURIComponent(mapelId)}`))
    } finally { setLoadingResult(false) }
  }, [kelas, mapelId, pendingKelas])

  useEffect(() => { loadResult() }, [loadResult])

  const baris = useMemo(
    () => (result?.data ?? []).filter(r => !hanyaPerhatian || r.perlu_perhatian),
    [result, hanyaPerhatian]
  )

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="page-title">Hasil & Nilai Siswa</h1>
        <p className="page-subtitle">
          Nilai per kelas binaan (hanya lihat). Siswa yang nilainya di bawah KKM atau jauh di bawah rata-rata kelas ditandai.
        </p>
      </div>

      {opsi?.scopeWarning && <ScopeWarningBanner title="Kelas binaan belum diatur" message={opsi.scopeWarning} />}

      {loadingOpsi ? <PageLoader /> : !opsi?.kelasList.length ? (
        <div className="card"><EmptyState message="Belum ada data nilai untuk ditampilkan" icon={BarChart3} /></div>
      ) : (
        <>
          <div className="flex flex-wrap gap-3 items-center">
            <select className="select w-auto" value={kelas} onChange={e => setKelas(e.target.value)}>
              {opsi.kelasList.map(k => <option key={k} value={k}>Kelas {k}</option>)}
            </select>
            <select className="select w-auto" value={mapelId} onChange={e => setMapelId(e.target.value)} disabled={!mapelOptions.length}>
              {mapelOptions.length === 0 && <option value="">Belum ada mapel diujiankan</option>}
              {mapelOptions.map(m => <option key={m.id} value={m.id}>{m.nama}</option>)}
            </select>
            <label className="flex items-center gap-2 text-sm text-slate-600 cursor-pointer">
              <input type="checkbox" checked={hanyaPerhatian} onChange={e => setHanyaPerhatian(e.target.checked)} />
              Hanya yang perlu perhatian
            </label>
          </div>

          {loadingResult ? <PageLoader /> : !result || !mapelOptions.length ? (
            <div className="card"><EmptyState message="Pilih kelas dan mapel untuk melihat nilai" icon={BarChart3} /></div>
          ) : (
            <>
              <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
                <StatCard label="Jumlah Siswa" value={result.summary.jumlahSiswa} icon={Users} color="bg-brand-500" />
                <StatCard label="Rata-rata Kelas" value={result.summary.rataRata} icon={BarChart3} color="bg-green-600" />
                <StatCard label="Nilai Tertinggi" value={result.summary.nilaiTertinggi} icon={TrendingUp} color="bg-emerald-500" />
                <StatCard label="Nilai Terendah" value={result.summary.nilaiTerendah} icon={TrendingDown} color="bg-orange-500" />
                <StatCard label="Perlu Perhatian" value={result.summary.jumlahPerluPerhatian} icon={AlertTriangle} color="bg-amber-500" />
              </div>

              <div className="card">
                <h2 className="font-semibold text-slate-900 mb-1 flex items-center gap-2">
                  <BarChart3 className="w-4 h-4 text-green-600" /> {result.nama_mapel} (Kelas {kelas})
                </h2>
                <p className="text-xs text-slate-500 mb-4">
                  Ditandai bila nilai akhir di bawah KKM, atau tertinggal {result.selisihPerhatian} poin atau lebih dari rata-rata kelas.
                </p>
                {!baris.length ? (
                  <EmptyState message={hanyaPerhatian ? 'Tidak ada siswa yang perlu perhatian' : 'Belum ada nilai untuk kombinasi ini'} icon={BarChart3} />
                ) : (
                  <div className="table-wrapper">
                    <table className="table">
                      <thead>
                        <tr>
                          <th>Rank</th>
                          <th>Nama Siswa</th>
                          <th>Benar</th>
                          <th>Nilai PG</th>
                          <th>Nilai Akhir</th>
                          <th>Selisih Rata-rata</th>
                          <th>Grade</th>
                          <th>Keterangan</th>
                        </tr>
                      </thead>
                      <tbody>
                        {baris.map(r => (
                          <tr key={r.id} className={r.perlu_perhatian ? 'bg-amber-50/60' : undefined}>
                            <td className="text-slate-500">{r.rank}</td>
                            <td>
                              <div className="font-medium text-slate-800">{r.nama_siswa}</div>
                              <div className="text-xs text-slate-400">{r.nis}</div>
                            </td>
                            <td className="text-slate-500">{r.benar}/{r.total}</td>
                            <td className="text-slate-600">{r.nilai}</td>
                            <td className={`font-bold ${nilaiColor(r.nilai_efektif)}`}>
                              {r.nilai_efektif}
                              {r.essay_belum_dirilis && <span className="ml-1.5 badge-yellow text-xs" title="Nilai essay belum dirilis; angka ini belum final">belum final</span>}
                            </td>
                            <td className={r.selisih_rata < 0 ? 'text-red-600' : 'text-emerald-600'}>
                              {r.selisih_rata > 0 ? '+' : ''}{r.selisih_rata}
                            </td>
                            <td><span className={`badge ${gradeColor(r.grade)}`}>{r.grade}</span></td>
                            <td>
                              <div className="flex flex-wrap gap-1">
                                <span className={`badge ${r.lulus ? 'badge-green' : 'badge-red'}`}>{r.lulus ? 'Lulus' : 'Tidak Lulus'}</span>
                                {r.perlu_perhatian && <span className="badge-yellow">Perlu perhatian</span>}
                              </div>
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
