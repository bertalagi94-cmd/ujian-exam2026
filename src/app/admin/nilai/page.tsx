'use client'

import { useState, useEffect, useCallback } from 'react'
import { Download, BarChart3, RotateCcw } from 'lucide-react'
import { PageLoader, EmptyState, Spinner, Pagination, SearchInput, Modal } from '@/components/ui'
import { apiRequest, formatDateTime, nilaiColor } from '@/lib/utils'
import { Nilai, Mapel, Kelas } from '@/types'

const PER_PAGE = 30

export default function AdminNilaiPage() {
  const [nilaiList, setNilaiList] = useState<Nilai[]>([])
  const [mapelList, setMapelList] = useState<Mapel[]>([])
  const [kelasList, setKelasList] = useState<Kelas[]>([])
  const [loading, setLoading] = useState(true)
  const [filterMapel, setFilterMapel] = useState('')
  const [filterKelas, setFilterKelas] = useState('')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [resetTarget, setResetTarget] = useState<Nilai | null>(null)
  const [resetting, setResetting] = useState(false)
  const [resetMsg, setResetMsg] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({
        page: String(page), per_page: String(PER_PAGE),
        ...(filterMapel && { mapel_id: filterMapel }),
        ...(filterKelas && { kelas: filterKelas }),
      })
      const res = await apiRequest<{ data: Nilai[]; total: number }>(`/api/admin/nilai?${params}`)
      setNilaiList(res.data)
      setTotal(res.total)
    } finally { setLoading(false) }
  }, [page, filterMapel, filterKelas])

  useEffect(() => { load() }, [load])
  useEffect(() => {
    Promise.all([
      apiRequest<{ data: Mapel[] }>('/api/admin/mapel'),
      apiRequest<{ data: Kelas[] }>('/api/admin/kelas'),
    ]).then(([m, k]) => { setMapelList(m.data); setKelasList(k.data) })
  }, [])

  const filtered = nilaiList.filter(n =>
    !search || (n.nama_siswa ?? '').toLowerCase().includes(search.toLowerCase())
  )

  function exportCSV() {
    const header = ['Nama Siswa', 'Kelas', 'Mata Pelajaran', 'Nilai', 'Grade', 'Benar', 'Total', 'KKM', 'Status', 'Tanggal']
    const rows = filtered.map(n => [
      n.nama_siswa, n.kelas, n.nama_mapel, n.nilai, n.grade,
      n.benar, n.total, n.kkm, n.lulus ? 'Lulus' : 'Tidak Lulus', n.timestamp
    ])
    const csv = [header, ...rows].map(r => r.join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = `rekap-nilai-${Date.now()}.csv`
    a.click()
  }

  // Summary stats
  const nums = filtered.map(n => n.nilai)
  const rata = nums.length ? Math.round(nums.reduce((a, b) => a + b, 0) / nums.length) : 0
  const lulus = filtered.filter(n => n.lulus).length
  const persenLulus = filtered.length ? Math.round((lulus / filtered.length) * 100) : 0

  async function handleReset() {
    if (!resetTarget) return
    setResetting(true)
    setResetMsg('')
    try {
      const res = await apiRequest<{ success: boolean; message: string }>(
        '/api/admin/nilai',
        { method: 'PATCH', body: JSON.stringify({ action: 'reset_ujian', nis: resetTarget.nis, sesi_id: resetTarget.sesi_id }) }
      )
      setResetMsg(res.message)
      await load()
    } catch (e) {
      setResetMsg(e instanceof Error ? e.message : 'Reset gagal')
    } finally {
      setResetting(false)
    }
  }

  function closeResetModal() {
    setResetTarget(null)
    setResetMsg('')
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="page-title">Rekap Nilai</h1>
          <p className="page-subtitle">{total} data nilai ujian</p>
        </div>
        <button onClick={exportCSV} className="btn-secondary btn-sm">
          <Download className="w-4 h-4" /> Export CSV
        </button>
      </div>

      {/* Summary row */}
      {filtered.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {[
            { label: 'Rata-rata Nilai', value: rata, color: nilaiColor(rata) },
            { label: 'Siswa Lulus', value: `${lulus}/${filtered.length}`, color: 'text-emerald-600' },
            { label: 'Persentase Lulus', value: `${persenLulus}%`, color: persenLulus >= 75 ? 'text-emerald-600' : 'text-red-500' },
          ].map(s => (
            <div key={s.label} className="card-sm text-center">
              <div className={`text-2xl font-bold ${s.color}`}>{s.value}</div>
              <div className="text-xs text-slate-500 mt-1">{s.label}</div>
            </div>
          ))}
        </div>
      )}

      {/* Filters */}
      <div className="card py-4 flex gap-3 flex-wrap">
        <SearchInput value={search} onChange={setSearch} placeholder="Cari nama siswa..." className="flex-1 min-w-[200px]" />
        <select value={filterMapel} onChange={e => { setFilterMapel(e.target.value); setPage(1) }} className="select w-full sm:w-44">
          <option value="">Semua Mapel</option>
          {mapelList.map(m => <option key={m.id} value={m.id}>{m.nama}</option>)}
        </select>
        <select value={filterKelas} onChange={e => { setFilterKelas(e.target.value); setPage(1) }} className="select w-36">
          <option value="">Semua Kelas</option>
          {kelasList.map(k => <option key={k.id} value={k.nama}>{k.nama}</option>)}
        </select>
      </div>

      <div className="card p-0 overflow-hidden">
        <div className="table-wrapper">
          {loading ? (
            <div className="flex justify-center py-20"><Spinner size="lg" /></div>
          ) : filtered.length === 0 ? (
            <EmptyState message="Tidak ada data nilai" icon={BarChart3} />
          ) : (
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
                  <th>Aksi</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((n, i) => (
                  <tr key={n.id}>
                    <td className="text-slate-400 text-xs">{(page - 1) * PER_PAGE + i + 1}</td>
                    <td className="font-medium text-slate-800">{n.nama_siswa}</td>
                    <td><span className="badge-blue text-xs">{n.kelas}</span></td>
                    <td className="text-sm text-slate-600">{n.nama_mapel}</td>
                    <td>
                      <span className={`text-lg font-bold ${nilaiColor(n.nilai)}`}>{n.nilai}</span>
                    </td>
                    <td>
                      <span className={`badge font-bold ${
                        n.grade === 'A' ? 'badge-green' : n.grade === 'B' ? 'badge-blue' :
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
                    <td>
                      <button
                        onClick={() => setResetTarget(n)}
                        className="btn-secondary btn-sm whitespace-nowrap"
                        title="Reset nilai agar siswa dapat ujian ulang"
                      >
                        <RotateCcw className="w-3.5 h-3.5" /> Ujian Ulang
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <div className="px-4 py-2 border-t border-slate-100">
          <Pagination page={page} totalPages={Math.ceil(total / PER_PAGE)}
            onPage={setPage} total={total} perPage={PER_PAGE} />
        </div>
      </div>

      <Modal
        open={!!resetTarget}
        onClose={closeResetModal}
        title="Reset Nilai & Buka Ujian Ulang"
        footer={
          resetMsg ? (
            <button onClick={closeResetModal} className="btn-secondary btn-sm">Tutup</button>
          ) : (
            <>
              <button onClick={closeResetModal} className="btn-secondary btn-sm" disabled={resetting}>Batal</button>
              <button onClick={handleReset} className="btn-danger btn-sm" disabled={resetting}>
                {resetting ? <Spinner size="sm" /> : 'Ya, Reset Nilai Mapel ini'}
              </button>
            </>
          )
        }
      >
        {resetTarget && !resetMsg && (
          <div className="space-y-3 text-sm text-slate-600">
            <p>
              Anda akan menghapus nilai <span className="font-semibold text-slate-800">{resetTarget.nama_siswa}</span> untuk
              mata pelajaran <span className="font-semibold text-slate-800">{resetTarget.nama_mapel}</span>, beserta seluruh
              jawaban dan riwayat pelanggarannya di sesi tersebut.
            </p>
            <p>
              Sesi ujian <span className="font-semibold">TIDAK</span> akan dibuka secara otomatis. Setelah direset,
              siswa ini akan tampak seperti belum pernah ujian — Anda perlu membuka akses ujian ulang secara manual
              sendiri saat siap (misalnya lewat fitur sesi susulan, atau membuka kembali sesi yang bersangkutan).
            </p>
            <p className="text-amber-600 font-medium">Tindakan ini tidak dapat dibatalkan.</p>
          </div>
        )}
        {resetMsg && (
          <p className="text-sm text-slate-700">{resetMsg}</p>
        )}
      </Modal>
    </div>
  )
}
