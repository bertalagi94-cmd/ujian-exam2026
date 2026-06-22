'use client'
import { useState, useEffect, useCallback } from 'react'
import { ShieldAlert, Search, RefreshCw, Key, Lock, Trash2, CheckCircle, XCircle, Clock, Filter, ChevronDown } from 'lucide-react'
import { Modal, Confirm, SearchInput, Pagination, EmptyState, Spinner, Toast, Badge } from '@/components/ui'
import { apiRequest, formatDateTime } from '@/lib/utils'

type StatusPelanggaran = 'BELUM_DITINDAKLANJUTI' | 'SUDAH_DITINDAKLANJUTI' | 'DIABAIKAN'

interface Pelanggaran {
  id: string
  sesi_id: string
  nis: string
  nama_siswa: string
  kelas: string
  nama_mapel: string
  jenis: string
  level: number
  detail: string
  status: StatusPelanggaran
  created_at: string
}

interface Stats {
  belum: number
  sudah: number
  diabaikan: number
  total: number
}

const PER_PAGE = 20

const STATUS_LABEL: Record<StatusPelanggaran, string> = {
  BELUM_DITINDAKLANJUTI: 'Belum Ditindak',
  SUDAH_DITINDAKLANJUTI: 'Sudah Ditindak',
  DIABAIKAN: 'Diabaikan',
}

const STATUS_COLOR: Record<StatusPelanggaran, 'red' | 'green' | 'yellow' | 'slate' | 'blue' | 'purple' | 'orange'> = {
  BELUM_DITINDAKLANJUTI: 'red',
  SUDAH_DITINDAKLANJUTI: 'green',
  DIABAIKAN: 'yellow',
}

type ModalAction = {
  type: 'bypass' | 'kunci' | 'hapus' | 'reset_semua' | 'update_status'
  item: Pelanggaran
  newStatus?: StatusPelanggaran
} | null

export default function AdminPelanggaranPage() {
  const [data, setData] = useState<Pelanggaran[]>([])
  const [stats, setStats] = useState<Stats | null>(null)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [filterJenis, setFilterJenis] = useState('')
  const [filterTanggal, setFilterTanggal] = useState('')
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [modal, setModal] = useState<ModalAction>(null)
  const [catatan, setCatatan] = useState('')
  const [kodeResult, setKodeResult] = useState<string | null>(null)
  const [acting, setActing] = useState(false)
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null)

  const showToast = (msg: string, type: 'success' | 'error' = 'success') => {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 3500)
  }

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({
        page: String(page),
        per_page: String(PER_PAGE),
        ...(search && { search }),
        ...(filterStatus && { status: filterStatus }),
        ...(filterJenis && { jenis: filterJenis }),
        ...(filterTanggal && { tanggal: filterTanggal }),
      })
      const res = await apiRequest<{ data: Pelanggaran[]; total: number; stats: Stats }>(
        `/api/admin/pelanggaran?${params}`
      )
      setData(res.data)
      setTotal(res.total)
      setStats(res.stats)
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Gagal memuat data', 'error')
    } finally {
      setLoading(false)
    }
  }, [page, search, filterStatus, filterJenis, filterTanggal])

  useEffect(() => { load() }, [load])
  useEffect(() => { setPage(1) }, [search, filterStatus, filterJenis, filterTanggal])

  const doAction = async () => {
    if (!modal) return
    setActing(true)
    try {
      let body: Record<string, string> = { action: '', id: modal.item.id, nis: modal.item.nis, sesiId: modal.item.sesi_id, catatan }

      if (modal.type === 'bypass') body.action = 'bypass_reset'
      else if (modal.type === 'kunci') body.action = 'kunci_permanen'
      else if (modal.type === 'hapus') body.action = 'hapus'
      else if (modal.type === 'reset_semua') body.action = 'reset_semua'
      else if (modal.type === 'update_status') {
        body.action = 'update_status'
        body.status = modal.newStatus!
      }

      const res = await apiRequest<{ success: boolean; kode_reset?: string; message: string }>(
        '/api/admin/pelanggaran', { method: 'PATCH', body: JSON.stringify(body) }
      )

      if (modal.type === 'bypass' && res.kode_reset) {
        setKodeResult(res.kode_reset)
      } else {
        showToast(res.message)
        setModal(null)
        setCatatan('')
        load()
      }
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Gagal melakukan tindakan', 'error')
    } finally {
      setActing(false)
    }
  }

  const jenisOptions = ['BUKA_TAB', 'RESIZE_WINDOW', 'COPY_PASTE', 'SCREENSHOT', 'DEV_TOOLS', 'LAINNYA']

  return (
    <div className="space-y-6 animate-fade-in">
      {toast && <Toast message={toast.msg} type={toast.type} onClose={() => setToast(null)} />}

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="page-title flex items-center gap-2">
            <ShieldAlert className="w-6 h-6 text-red-500" />
            Manajemen Pelanggaran
          </h1>
          <p className="page-subtitle">Monitor & tindak lanjut pelanggaran siswa saat ujian</p>
        </div>
        <button className="btn-secondary flex items-center gap-2" onClick={load}>
          <RefreshCw className="w-4 h-4" /> Refresh
        </button>
      </div>

      {/* Stat Cards */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="card p-4 text-center">
            <p className="text-2xl font-bold text-red-500">{stats.belum}</p>
            <p className="text-sm text-muted mt-1">Belum Ditindak</p>
          </div>
          <div className="card p-4 text-center">
            <p className="text-2xl font-bold text-green-500">{stats.sudah}</p>
            <p className="text-sm text-muted mt-1">Sudah Ditindak</p>
          </div>
          <div className="card p-4 text-center">
            <p className="text-2xl font-bold text-yellow-500">{stats.diabaikan}</p>
            <p className="text-sm text-muted mt-1">Diabaikan</p>
          </div>
          <div className="card p-4 text-center">
            <p className="text-2xl font-bold">{stats.total}</p>
            <p className="text-sm text-muted mt-1">Total Semua</p>
          </div>
        </div>
      )}

      {/* Filter Bar */}
      <div className="card p-4">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder="Cari nama / NIS / jenis..."
          />
          <select
            className="input"
            value={filterStatus}
            onChange={e => setFilterStatus(e.target.value)}
          >
            <option value="">Semua Status</option>
            <option value="BELUM_DITINDAKLANJUTI">Belum Ditindak</option>
            <option value="SUDAH_DITINDAKLANJUTI">Sudah Ditindak</option>
            <option value="DIABAIKAN">Diabaikan</option>
          </select>
          <select
            className="input"
            value={filterJenis}
            onChange={e => setFilterJenis(e.target.value)}
          >
            <option value="">Semua Jenis</option>
            {jenisOptions.map(j => <option key={j} value={j}>{j.replace(/_/g, ' ')}</option>)}
          </select>
          <input
            type="date"
            className="input"
            value={filterTanggal}
            onChange={e => setFilterTanggal(e.target.value)}
            title="Filter tanggal"
          />
        </div>
      </div>

      {/* Table */}
      <div className="card overflow-hidden">
        {loading ? (
          <div className="flex justify-center py-16"><Spinner /></div>
        ) : data.length === 0 ? (
          <EmptyState icon={ShieldAlert} title="Tidak ada pelanggaran" description="Tidak ada data pelanggaran sesuai filter." />
        ) : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Siswa</th>
                  <th>Kelas</th>
                  <th>Mapel</th>
                  <th>Jenis</th>
                  <th>Level</th>
                  <th>Status</th>
                  <th>Waktu</th>
                  <th>Aksi</th>
                </tr>
              </thead>
              <tbody>
                {data.map((p, i) => (
                  <tr key={p.id}>
                    <td className="text-muted text-sm">{(page - 1) * PER_PAGE + i + 1}</td>
                    <td>
                      <div className="font-medium">{p.nama_siswa}</div>
                      <div className="text-xs text-muted">{p.nis}</div>
                    </td>
                    <td>{p.kelas}</td>
                    <td className="text-sm">{p.nama_mapel}</td>
                    <td>
                      <span className="badge badge-error text-xs">{p.jenis?.replace(/_/g, ' ')}</span>
                    </td>
                    <td>
                      <span className={`font-bold ${p.level >= 3 ? 'text-red-500' : p.level === 2 ? 'text-yellow-500' : 'text-blue-500'}`}>
                        Ke-{p.level}
                      </span>
                    </td>
                    <td>
                      <Badge variant={STATUS_COLOR[p.status]}>{STATUS_LABEL[p.status]}</Badge>
                    </td>
                    <td className="text-xs text-muted whitespace-nowrap">{formatDateTime(p.created_at)}</td>
                    <td>
                      <div className="flex gap-1 flex-wrap">
                        {/* Bypass Reset */}
                        <button
                          className="btn-sm btn-warning flex items-center gap-1"
                          title="Bypass — generate kode reset tanpa pengawas"
                          onClick={() => { setModal({ type: 'bypass', item: p }); setCatatan('') }}
                        >
                          <Key className="w-3 h-3" /> Bypass
                        </button>
                        {/* Kunci Permanen */}
                        <button
                          className="btn-sm btn-error flex items-center gap-1"
                          title="Kunci permanen & nilai 0"
                          onClick={() => { setModal({ type: 'kunci', item: p }); setCatatan('') }}
                        >
                          <Lock className="w-3 h-3" /> Kunci
                        </button>
                        {/* Ubah Status */}
                        <div className="relative group">
                          <button className="btn-sm btn-secondary flex items-center gap-1">
                            <CheckCircle className="w-3 h-3" /> Status <ChevronDown className="w-3 h-3" />
                          </button>
                          <div className="absolute right-0 top-full mt-1 bg-white border border-border rounded-lg shadow-lg z-10 min-w-[180px] hidden group-hover:block">
                            {(['SUDAH_DITINDAKLANJUTI', 'DIABAIKAN', 'BELUM_DITINDAKLANJUTI'] as StatusPelanggaran[]).map(s => (
                              <button
                                key={s}
                                className="block w-full text-left px-3 py-2 text-sm hover:bg-surface transition-colors"
                                onClick={() => setModal({ type: 'update_status', item: p, newStatus: s })}
                              >
                                {STATUS_LABEL[s]}
                              </button>
                            ))}
                          </div>
                        </div>
                        {/* Reset Semua Pelanggaran */}
                        <button
                          className="btn-sm btn-secondary flex items-center gap-1"
                          title="Hapus semua pelanggaran siswa di sesi ini"
                          onClick={() => { setModal({ type: 'reset_semua', item: p }); setCatatan('') }}
                        >
                          <RefreshCw className="w-3 h-3" /> Bersihkan
                        </button>
                        {/* Hapus */}
                        <button
                          className="btn-sm btn-ghost flex items-center gap-1 text-red-500"
                          title="Hapus catatan ini"
                          onClick={() => setModal({ type: 'hapus', item: p })}
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {!loading && total > PER_PAGE && (
          <div className="p-4 border-t border-border">
            <Pagination page={page} totalPages={Math.ceil(total / PER_PAGE)} onPage={setPage} />
          </div>
        )}
      </div>

      {/* Modal Aksi */}
      {modal && !kodeResult && (
        <Modal
          open
          title={
            modal.type === 'bypass' ? '🔑 Bypass Reset Siswa' :
            modal.type === 'kunci' ? '🔒 Kunci Permanen Siswa' :
            modal.type === 'hapus' ? '🗑️ Hapus Pelanggaran' :
            modal.type === 'reset_semua' ? '♻️ Bersihkan Pelanggaran Siswa' :
            '✏️ Ubah Status'
          }
          onClose={() => { setModal(null); setCatatan('') }}
        >
          <div className="space-y-4">
            <div className="bg-surface rounded-lg p-3 text-sm space-y-1">
              <div><span className="text-muted">Siswa:</span> <strong>{modal.item.nama_siswa}</strong> ({modal.item.nis})</div>
              <div><span className="text-muted">Kelas:</span> {modal.item.kelas} — {modal.item.nama_mapel}</div>
              <div><span className="text-muted">Jenis:</span> {modal.item.jenis?.replace(/_/g, ' ')} <span className="text-muted">(level {modal.item.level})</span></div>
            </div>

            {modal.type === 'bypass' && (
              <p className="text-sm text-muted">Admin akan men-generate kode reset 7 digit untuk siswa ini <strong>tanpa perlu menunggu pengawas</strong>. Siswa harus memasukkan kode untuk melanjutkan ujian.</p>
            )}
            {modal.type === 'kunci' && (
              <p className="text-sm text-red-500 font-medium">⚠️ Siswa akan dikunci permanen dari sesi ini dan nilainya akan menjadi 0. Tindakan ini tidak dapat dibatalkan.</p>
            )}
            {modal.type === 'reset_semua' && (
              <p className="text-sm text-muted">Semua catatan pelanggaran siswa ini pada sesi ini akan dihapus dan akses ujian dikembalikan ke AKTIF.</p>
            )}
            {modal.type === 'hapus' && (
              <p className="text-sm text-muted">Hanya catatan pelanggaran ini yang akan dihapus dari database.</p>
            )}
            {modal.type === 'update_status' && (
              <p className="text-sm text-muted">Status akan diubah menjadi: <strong>{STATUS_LABEL[modal.newStatus!]}</strong></p>
            )}

            {modal.type !== 'hapus' && modal.type !== 'update_status' && (
              <div>
                <label className="label">Catatan (opsional)</label>
                <textarea
                  className="input w-full"
                  rows={2}
                  placeholder="Alasan tindakan..."
                  value={catatan}
                  onChange={e => setCatatan(e.target.value)}
                />
              </div>
            )}

            <div className="flex gap-2 justify-end">
              <button className="btn-secondary" onClick={() => { setModal(null); setCatatan('') }}>Batal</button>
              <button
                className={modal.type === 'kunci' || modal.type === 'hapus' ? 'btn-error' : 'btn-primary'}
                onClick={doAction}
                disabled={acting}
              >
                {acting ? <Spinner size="sm" /> : 'Konfirmasi'}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Modal Kode Bypass Result */}
      {kodeResult && modal && (
        <Modal open title="✅ Kode Bypass Berhasil Dibuat" onClose={() => { setKodeResult(null); setModal(null); setCatatan(''); load() }}>
          <div className="space-y-4 text-center">
            <p className="text-sm text-muted">Berikan kode berikut kepada <strong>{modal.item.nama_siswa}</strong>:</p>
            <div className="bg-surface border-2 border-primary rounded-xl py-6 px-8">
              <p className="text-4xl font-mono font-bold tracking-widest text-primary">{kodeResult}</p>
            </div>
            <p className="text-xs text-muted">Kode ini hanya berlaku sekali. Siswa harus memasukkan kode ini di layar ujian untuk melanjutkan.</p>
            <button
              className="btn-primary w-full"
              onClick={() => {
                navigator.clipboard.writeText(kodeResult).catch(() => {})
                showToast('Kode disalin!')
              }}
            >
              Salin Kode
            </button>
            <button
              className="btn-secondary w-full"
              onClick={() => { setKodeResult(null); setModal(null); setCatatan(''); load() }}
            >
              Tutup
            </button>
          </div>
        </Modal>
      )}
    </div>
  )
}
