'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import {
  Users, BookOpen, ChevronDown, UserCircle2, GraduationCap,
  CheckCircle, Clock, AlertCircle, XCircle, HelpCircle, AlertTriangle,
} from 'lucide-react'
import { apiRequest } from '@/lib/utils'
import { PageLoader, EmptyState, ScopeWarningBanner, SearchInput } from '@/components/ui'

interface KelasItem { nama_kelas: string; status_soal: string }
interface MapelItem { mapel_id: string; nama_mapel: string; kkm: number | null; kelas: KelasItem[] }
interface GuruRow { username: string; nama: string; status: string; mapel: MapelItem[] }
interface MapelTanpaGuru { mapel_id: string; nama_mapel: string; kelas: string[] }

// Badge status soal — label & warna sama persis dengan menu Jadwal Ujian Admin,
// supaya Kepsek melihat istilah & arti status yang konsisten di seluruh aplikasi.
function SoalStatusBadge({ status }: { status?: string }) {
  switch (status) {
    case 'DISETUJUI':
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-100 text-emerald-700 whitespace-nowrap">
          <CheckCircle className="w-3 h-3" /> Soal Siap
        </span>
      )
    case 'MENUNGGU':
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-amber-100 text-amber-700 whitespace-nowrap">
          <Clock className="w-3 h-3" /> Menunggu Persetujuan
        </span>
      )
    case 'DRAFT':
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-blue-100 text-blue-700 whitespace-nowrap">
          <AlertCircle className="w-3 h-3" /> Sedang Dibuat
        </span>
      )
    case 'DITOLAK':
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-red-100 text-red-700 whitespace-nowrap">
          <XCircle className="w-3 h-3" /> Ditolak
        </span>
      )
    default:
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-slate-100 text-slate-500 whitespace-nowrap">
          <HelpCircle className="w-3 h-3" /> Belum Ada Soal
        </span>
      )
  }
}

export default function KepsekGuruPage() {
  const [data, setData] = useState<GuruRow[]>([])
  const [mapelTanpaGuru, setMapelTanpaGuru] = useState<MapelTanpaGuru[]>([])
  const [loading, setLoading] = useState(true)
  const [scopeWarning, setScopeWarning] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await apiRequest<{ data: GuruRow[]; mapelTanpaGuru?: MapelTanpaGuru[]; scopeWarning?: string }>('/api/kepsek/guru-mapel')
      setData(res.data ?? [])
      setMapelTanpaGuru(res.mapelTanpaGuru ?? [])
      setScopeWarning(res.scopeWarning ?? null)
      if (res.data?.length === 1) setExpanded(new Set([res.data[0].username]))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  function toggle(username: string) {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(username)) next.delete(username)
      else next.add(username)
      return next
    })
  }

  const filtered = useMemo(() => {
    if (!search.trim()) return data
    const q = search.trim().toLowerCase()
    return data.filter(g =>
      g.nama.toLowerCase().includes(q) ||
      g.mapel.some(m => m.nama_mapel.toLowerCase().includes(q) || m.kelas.some(k => k.nama_kelas.toLowerCase().includes(q)))
    )
  }, [data, search])

  const totalMapelDiampu = useMemo(() => data.reduce((acc, g) => acc + g.mapel.length, 0), [data])
  const totalKombinasi = useMemo(
    () => data.reduce((acc, g) => acc + g.mapel.reduce((a, m) => a + m.kelas.length, 0), 0),
    [data]
  )
  const totalSoalBelumSiap = useMemo(
    () => data.reduce((acc, g) => acc + g.mapel.reduce((a, m) => a + m.kelas.filter(k => k.status_soal !== 'DISETUJUI').length, 0), 0),
    [data]
  )

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="page-title">Guru &amp; Mata Pelajaran</h1>
        <p className="page-subtitle">Daftar guru, mata pelajaran yang diampu per kelas, dan status kesiapan soalnya</p>
      </div>

      {scopeWarning && <ScopeWarningBanner message={scopeWarning} />}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="card-sm">
          <p className="text-xs text-slate-500">Total Guru</p>
          <p className="text-xl font-bold text-slate-900 mt-0.5">{data.length}</p>
        </div>
        <div className="card-sm">
          <p className="text-xs text-slate-500">Mapel Diampu</p>
          <p className="text-xl font-bold text-slate-900 mt-0.5">{totalMapelDiampu}</p>
        </div>
        <div className="card-sm">
          <p className="text-xs text-slate-500">Kombinasi Mapel × Kelas</p>
          <p className="text-xl font-bold text-slate-900 mt-0.5">{totalKombinasi}</p>
        </div>
        <div className="card-sm">
          <p className="text-xs text-slate-500">Soal Belum Siap</p>
          <p className={`text-xl font-bold mt-0.5 ${totalSoalBelumSiap > 0 ? 'text-amber-600' : 'text-emerald-600'}`}>
            {totalSoalBelumSiap}
          </p>
        </div>
      </div>

      {data.length > 0 && (
        <SearchInput value={search} onChange={setSearch} placeholder="Cari nama guru, mapel, atau kelas..." />
      )}

      {loading ? (
        <PageLoader />
      ) : !data.length ? (
        <div className="card"><EmptyState message="Belum ada guru yang mengampu mapel di jenjang Anda" icon={GraduationCap} /></div>
      ) : !filtered.length ? (
        <div className="card"><EmptyState message="Tidak ada guru, mapel, atau kelas yang cocok dengan pencarian" icon={Users} /></div>
      ) : (
        <div className="space-y-3">
          {filtered.map(g => {
            const isOpen = expanded.has(g.username)
            const jumlahKelas = g.mapel.reduce((a, m) => a + m.kelas.length, 0)
            const belumSiap = g.mapel.reduce((a, m) => a + m.kelas.filter(k => k.status_soal !== 'DISETUJUI').length, 0)
            return (
              <div key={g.username} className="card p-0 overflow-hidden">
                <button
                  onClick={() => toggle(g.username)}
                  className="w-full flex items-center justify-between gap-3 p-4 hover:bg-slate-50 transition-colors text-left"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-10 h-10 rounded-xl bg-purple-50 text-purple-600 flex items-center justify-center flex-shrink-0">
                      <UserCircle2 className="w-5 h-5" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-slate-900">{g.nama}</span>
                        {g.status === 'NONAKTIF' && <span className="badge-slate">Nonaktif</span>}
                      </div>
                      <div className="flex items-center gap-1.5 text-xs text-slate-500 mt-0.5">
                        <BookOpen className="w-3.5 h-3.5 flex-shrink-0" />
                        <span>
                          Mengampu <span className="text-slate-700 font-medium">{g.mapel.length} mapel</span> di{' '}
                          <span className="text-slate-700 font-medium">{jumlahKelas} kelas</span>
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 flex-shrink-0">
                    {belumSiap > 0 ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-700">
                        <AlertTriangle className="w-3 h-3" /> {belumSiap} belum siap
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-700">
                        <CheckCircle className="w-3 h-3" /> Semua siap
                      </span>
                    )}
                    <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                  </div>
                </button>

                {isOpen && (
                  <div className="border-t border-slate-100 divide-y divide-slate-100">
                    {g.mapel.map(m => (
                      <div key={m.mapel_id} className="p-4">
                        <div className="flex items-center gap-2 mb-2.5 flex-wrap">
                          <span className="font-semibold text-slate-800 text-sm">{m.nama_mapel}</span>
                          {m.kkm != null && <span className="badge-slate">KKM {m.kkm}</span>}
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {m.kelas.map(k => (
                            <div
                              key={k.nama_kelas}
                              className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg border border-slate-200 bg-slate-50"
                            >
                              <span className="text-xs font-medium text-slate-600">Kelas {k.nama_kelas}</span>
                              <SoalStatusBadge status={k.status_soal} />
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {mapelTanpaGuru.length > 0 && (
        <div className="card">
          <div className="flex items-center gap-2 mb-3">
            <AlertTriangle className="w-4 h-4 text-amber-500" />
            <h2 className="font-semibold text-slate-800 text-sm">Mapel Belum Ada Guru Pengampu</h2>
          </div>
          <p className="text-xs text-slate-500 mb-3">
            Mata pelajaran berikut belum ditugaskan ke guru manapun oleh Admin, sehingga soal belum bisa dibuat.
          </p>
          <div className="space-y-2">
            {mapelTanpaGuru.map(m => (
              <div key={m.mapel_id} className="flex items-center justify-between gap-3 p-2.5 rounded-lg bg-amber-50 border border-amber-200">
                <span className="text-sm font-medium text-amber-800">{m.nama_mapel}</span>
                <span className="text-xs text-amber-600">Kelas: {m.kelas.join(', ')}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
