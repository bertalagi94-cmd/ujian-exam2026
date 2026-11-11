'use client'

import { useState, useEffect, useCallback } from 'react'
import { ShieldAlert, RefreshCw } from 'lucide-react'
import { SearchInput, Pagination, EmptyState, PageLoader, Toast, ScopeWarningBanner } from '@/components/ui'
import { apiRequest, formatDateTime } from '@/lib/utils'
import { terjemahJenisPelanggaran } from '@/lib/pelanggaran-shared'

type StatusPelanggaran = 'BELUM_DITINDAKLANJUTI' | 'SUDAH_DITINDAKLANJUTI' | 'DIABAIKAN'

interface Pelanggaran {
  id: string
  nis: string
  nama_siswa: string
  kelas: string
  nama_mapel: string
  jenis: string
  level: number
  detail: string | null
  status: StatusPelanggaran
  created_at: string
  total_pelanggaran_siswa: number
}

interface Stats { belum: number; sudah: number; diabaikan: number; total: number }

interface ListResponse {
  data: Pelanggaran[]
  total: number
  kelasList: string[]
  stats: Stats
  scopeWarning?: string
}

const PER_PAGE = 20

// Status yang sama dengan menu Pelanggaran Admin; hanya istilahnya yang disesuaikan
// untuk pembinaan ("Sudah Dikonseling" = SUDAH_DITINDAKLANJUTI).
const STATUS_LABEL: Record<StatusPelanggaran, string> = {
  BELUM_DITINDAKLANJUTI: 'Belum Ditindaklanjuti',
  SUDAH_DITINDAKLANJUTI: 'Sudah Dikonseling',
  DIABAIKAN: 'Diabaikan',
}
const STATUS_WARNA: Record<StatusPelanggaran, string> = {
  BELUM_DITINDAKLANJUTI: 'border-amber-300 bg-amber-50 text-amber-800',
  SUDAH_DITINDAKLANJUTI: 'border-emerald-300 bg-emerald-50 text-emerald-800',
  DIABAIKAN: 'border-slate-300 bg-slate-50 text-slate-600',
}

const JENIS_OPSI = [
  'WINDOW_BLUR', 'EXIT_FULLSCREEN', 'TAB_SWITCH', 'COPY_PASTE',
  'CONTEXT_MENU', 'KEYBOARD_BLOCK', 'DRAG_DROP', 'LOCK_RELEASED',
]

export default function BkPelanggaranPage() {
  const [res, setRes] = useState<ListResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filterKelas, setFilterKelas] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [filterJenis, setFilterJenis] = useState('')
  const [page, setPage] = useState(1)
  const [menyimpan, setMenyimpan] = useState<string | null>(null)
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({
        page: String(page),
        per_page: String(PER_PAGE),
        ...(search && { search }),
        ...(filterKelas && { kelas: filterKelas }),
        ...(filterStatus && { status: filterStatus }),
        ...(filterJenis && { jenis: filterJenis }),
      })
      setRes(await apiRequest<ListResponse>(`/api/bk/pelanggaran?${params}`))
    } catch (e) {
      setToast({ msg: e instanceof Error ? e.message : 'Gagal memuat data', type: 'error' })
    } finally {
      setLoading(false)
    }
  }, [page, search, filterKelas, filterStatus, filterJenis])

  useEffect(() => { load() }, [load])
  useEffect(() => { setPage(1) }, [search, filterKelas, filterStatus, filterJenis])

  async function ubahStatus(item: Pelanggaran, status: StatusPelanggaran) {
    if (status === item.status) return
    setMenyimpan(item.id)
    try {
      await apiRequest('/api/bk/pelanggaran', { method: 'PATCH', body: JSON.stringify({ id: item.id, status }) })
      setToast({ msg: `Status diubah: ${STATUS_LABEL[status]}`, type: 'success' })
      load()
    } catch (e) {
      setToast({ msg: e instanceof Error ? e.message : 'Gagal mengubah status', type: 'error' })
    } finally {
      setMenyimpan(null)
    }
  }

  const data = res?.data ?? []
  const total = res?.total ?? 0
  const stats = res?.stats
  const totalPages = Math.max(Math.ceil(total / PER_PAGE), 1)

  return (
    <div className="space-y-6 animate-fade-in">
      {toast && <Toast message={toast.msg} type={toast.type} onClose={() => setToast(null)} />}

      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="page-title flex items-center gap-2">
            <ShieldAlert className="w-6 h-6 text-red-500" /> Pelanggaran Siswa
          </h1>
          <p className="page-subtitle">Riwayat pelanggaran saat ujian di kelas binaan Anda, untuk bahan pembinaan</p>
        </div>
        <button className="btn-secondary flex items-center gap-2" onClick={load}>
          <RefreshCw className="w-4 h-4" /> Refresh
        </button>
      </div>

      {res?.scopeWarning && <ScopeWarningBanner title="Kelas binaan belum diatur" message={res.scopeWarning} />}

      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="card p-4 text-center">
            <p className="text-2xl font-bold text-amber-500">{stats.belum}</p>
            <p className="text-sm text-muted mt-1">Belum Ditindaklanjuti</p>
          </div>
          <div className="card p-4 text-center">
            <p className="text-2xl font-bold text-emerald-500">{stats.sudah}</p>
            <p className="text-sm text-muted mt-1">Sudah Dikonseling</p>
          </div>
          <div className="card p-4 text-center">
            <p className="text-2xl font-bold text-slate-500">{stats.diabaikan}</p>
            <p className="text-sm text-muted mt-1">Diabaikan</p>
          </div>
          <div className="card p-4 text-center">
            <p className="text-2xl font-bold">{stats.total}</p>
            <p className="text-sm text-muted mt-1">Total</p>
          </div>
        </div>
      )}

      <div className="card p-4">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <SearchInput value={search} onChange={setSearch} placeholder="Cari nama atau NISN siswa..." />
          <select className="input" value={filterKelas} onChange={e => setFilterKelas(e.target.value)}>
            <option value="">Semua Kelas Binaan</option>
            {(res?.kelasList ?? []).map(k => <option key={k} value={k}>Kelas {k}</option>)}
          </select>
          <select className="input" value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
            <option value="">Semua Status</option>
            {(Object.keys(STATUS_LABEL) as StatusPelanggaran[]).map(s => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
          </select>
          <select className="input" value={filterJenis} onChange={e => setFilterJenis(e.target.value)}>
            <option value="">Semua Jenis</option>
            {JENIS_OPSI.map(j => <option key={j} value={j}>{terjemahJenisPelanggaran(j)}</option>)}
          </select>
        </div>
      </div>

      {loading && !res ? <PageLoader /> : (
        <div className="card p-0 overflow-hidden">
          {data.length === 0 ? (
            <EmptyState message="Tidak ada pelanggaran yang cocok" icon={ShieldAlert} />
          ) : (
            <div className="table-wrapper">
              <table className="table">
                <thead>
                  <tr>
                    <th>Waktu</th>
                    <th>Siswa</th>
                    <th>Kelas</th>
                    <th>Mapel</th>
                    <th>Jenis</th>
                    <th>Total Siswa Ini</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {data.map(p => (
                    <tr key={p.id} className={loading ? 'opacity-60' : undefined}>
                      <td className="text-xs text-slate-500 whitespace-nowrap">{formatDateTime(p.created_at)}</td>
                      <td>
                        <div className="font-medium text-slate-800">{p.nama_siswa}</div>
                        <div className="text-xs text-slate-400">{p.nis}</div>
                      </td>
                      <td className="text-slate-600">{p.kelas}</td>
                      <td className="text-slate-600">{p.nama_mapel}</td>
                      <td title={p.detail ?? undefined}>
                        <span className="text-slate-700">{terjemahJenisPelanggaran(p.jenis)}</span>
                        {p.level > 1 && <span className="ml-1.5 badge-slate">Level {p.level}</span>}
                      </td>
                      <td>
                        <span className={p.total_pelanggaran_siswa >= 3 ? 'badge-red' : 'badge-slate'}>
                          {p.total_pelanggaran_siswa}×
                        </span>
                      </td>
                      <td>
                        <select
                          className={`text-xs rounded-lg border px-2 py-1 font-medium ${STATUS_WARNA[p.status]}`}
                          value={p.status}
                          disabled={menyimpan === p.id}
                          onChange={e => ubahStatus(p, e.target.value as StatusPelanggaran)}
                          aria-label={`Status pelanggaran ${p.nama_siswa}`}
                        >
                          {(Object.keys(STATUS_LABEL) as StatusPelanggaran[]).map(s => (
                            <option key={s} value={s}>{STATUS_LABEL[s]}</option>
                          ))}
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="px-4">
            <Pagination page={page} totalPages={totalPages} onPage={setPage} total={total} perPage={PER_PAGE} />
          </div>
        </div>
      )}
    </div>
  )
}
