'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { Users, School, ChevronDown, AlertTriangle, UserCircle2 } from 'lucide-react'
import { apiRequest } from '@/lib/utils'
import { PageLoader, EmptyState, ScopeWarningBanner, SearchInput } from '@/components/ui'

interface SiswaRow {
  nis: string
  nama: string
}

interface KelasRow {
  id: string
  nama: string
  jurusan: string | null
  wali_kelas: string | null
  wali_kelas_nama: string | null
  jumlah_siswa: number
  siswa: SiswaRow[]
}

export default function KepsekKelasPage() {
  const [data, setData] = useState<KelasRow[]>([])
  const [loading, setLoading] = useState(true)
  const [scopeWarning, setScopeWarning] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  // Default-nya kelas pertama saja yang terbuka, sisanya tertutup —
  // supaya halaman tidak terlalu panjang kalau jenjangnya punya banyak kelas.
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await apiRequest<{ data: KelasRow[]; scopeWarning?: string }>('/api/kepsek/kelas')
      setData(res.data ?? [])
      setScopeWarning(res.scopeWarning ?? null)
      if (res.data?.length === 1) setExpanded(new Set([res.data[0].id]))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  function toggle(id: string) {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const filtered = useMemo(() => {
    if (!search.trim()) return data
    const q = search.trim().toLowerCase()
    return data
      .map(k => ({
        ...k,
        siswa: k.siswa.filter(s => s.nama.toLowerCase().includes(q) || s.nis.includes(q)),
      }))
      .filter(k => k.nama.toLowerCase().includes(q) || k.siswa.length > 0)
  }, [data, search])

  const totalSiswa = useMemo(() => data.reduce((acc, k) => acc + k.jumlah_siswa, 0), [data])
  const totalTanpaWali = useMemo(() => data.filter(k => !k.wali_kelas).length, [data])

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="page-title">Data Kelas</h1>
        <p className="page-subtitle">Wali kelas dan daftar siswa untuk setiap kelas di jenjang Anda</p>
      </div>

      {scopeWarning && <ScopeWarningBanner message={scopeWarning} />}

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <div className="card-sm">
          <p className="text-xs text-slate-500">Total Kelas</p>
          <p className="text-xl font-bold text-slate-900 mt-0.5">{data.length}</p>
        </div>
        <div className="card-sm">
          <p className="text-xs text-slate-500">Total Siswa</p>
          <p className="text-xl font-bold text-slate-900 mt-0.5">{totalSiswa}</p>
        </div>
        <div className="card-sm">
          <p className="text-xs text-slate-500">Belum Ada Wali Kelas</p>
          <p className={`text-xl font-bold mt-0.5 ${totalTanpaWali > 0 ? 'text-amber-600' : 'text-emerald-600'}`}>
            {totalTanpaWali}
          </p>
        </div>
      </div>

      {data.length > 0 && (
        <SearchInput value={search} onChange={setSearch} placeholder="Cari nama kelas atau nama siswa..." />
      )}

      {loading ? (
        <PageLoader />
      ) : !data.length ? (
        <div className="card"><EmptyState message="Belum ada kelas di jenjang Anda" icon={School} /></div>
      ) : !filtered.length ? (
        <div className="card"><EmptyState message="Tidak ada kelas atau siswa yang cocok dengan pencarian" icon={Users} /></div>
      ) : (
        <div className="space-y-3">
          {filtered.map(k => {
            const isOpen = expanded.has(k.id)
            return (
              <div key={k.id} className="card p-0 overflow-hidden">
                <button
                  onClick={() => toggle(k.id)}
                  className="w-full flex items-center justify-between gap-3 p-4 hover:bg-slate-50 transition-colors text-left"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-10 h-10 rounded-xl bg-purple-50 text-purple-600 flex items-center justify-center flex-shrink-0">
                      <School className="w-5 h-5" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-slate-900">Kelas {k.nama}</span>
                        {k.jurusan && k.jurusan !== '-' && (
                          <span className="badge-slate">{k.jurusan}</span>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5 text-xs text-slate-500 mt-0.5">
                        <UserCircle2 className="w-3.5 h-3.5 flex-shrink-0" />
                        {k.wali_kelas_nama ? (
                          <span>Wali Kelas: <span className="text-slate-700 font-medium">{k.wali_kelas_nama}</span></span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-amber-600 font-medium">
                            <AlertTriangle className="w-3 h-3" /> Belum ada wali kelas
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 flex-shrink-0">
                    <span className="badge-blue">{k.jumlah_siswa} siswa</span>
                    <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                  </div>
                </button>

                {isOpen && (
                  <div className="border-t border-slate-100">
                    {k.siswa.length === 0 ? (
                      <p className="text-sm text-slate-400 text-center py-6">Belum ada siswa aktif di kelas ini</p>
                    ) : (
                      <div className="table-wrapper">
                        <table className="table">
                          <thead>
                            <tr>
                              <th className="w-12">#</th>
                              <th>NIS</th>
                              <th>Nama Siswa</th>
                            </tr>
                          </thead>
                          <tbody>
                            {k.siswa.map((s, i) => (
                              <tr key={s.nis}>
                                <td className="text-slate-400 text-xs">{i + 1}</td>
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
      )}
    </div>
  )
}
