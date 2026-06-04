'use client'

import { useState, useEffect, useCallback } from 'react'
import { Plus, Pencil, Trash2, Calendar, Printer, FileText, Download } from 'lucide-react'
import { Modal, Confirm, StatusBadge, SearchInput, EmptyState, Spinner, Toast, Pagination } from '@/components/ui'
import { apiRequest, formatDate } from '@/lib/utils'
import { Jadwal, Mapel, Kelas, User } from '@/types'

const PER_PAGE = 20

export default function AdminJadwalPage() {
  const [jadwal, setJadwal] = useState<Jadwal[]>([])
  const [mapelList, setMapelList] = useState<Mapel[]>([])
  const [kelasList, setKelasList] = useState<Kelas[]>([])
  const [guruList, setGuruList] = useState<User[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [page, setPage] = useState(1)
  const [modalOpen, setModalOpen] = useState(false)
  const [editData, setEditData] = useState<Partial<Jadwal> | null>(null)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [selectedMapelId, setSelectedMapelId] = useState<string>('')
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null)

  // State untuk modal cetak massal
  const [cetakMassalOpen, setCetakMassalOpen] = useState(false)
  const [cetakMode, setCetakMode] = useState<{ daftarHadir: boolean; beritaAcara: boolean }>({ daftarHadir: true, beritaAcara: true })
  const [cetakTanggal, setCetakTanggal] = useState('')
  const [tanggalList, setTanggalList] = useState<string[]>([])

  const showToast = (msg: string, type: 'success' | 'error' = 'success') => setToast({ msg, type })

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await apiRequest<{ data: Jadwal[] }>('/api/admin/jadwal')
      setJadwal(res.data)
      // Kumpulkan daftar tanggal unik untuk picker cetak massal
      const dates = [...new Set(res.data.map(j => j.tanggal.slice(0, 10)))].sort().reverse()
      setTanggalList(dates)
      if (dates.length > 0) setCetakTanggal(dates[0])
    } finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])
  useEffect(() => {
    Promise.all([
      apiRequest<{ data: Mapel[] }>('/api/admin/mapel'),
      apiRequest<{ data: Kelas[] }>('/api/admin/kelas'),
      apiRequest<{ data: User[] }>('/api/admin/users'),
    ]).then(([m, k, u]) => {
      setMapelList(m.data)
      setKelasList(k.data)
      setGuruList(u.data.filter(u => u.role === 'GURU'))
    })
  }, [])

  const filtered = jadwal.filter(j => {
    const matchSearch = !search || (j.nama_mapel ?? '').toLowerCase().includes(search.toLowerCase())
    const matchStatus = !filterStatus || j.status === filterStatus
    return matchSearch && matchStatus
  })

  const paginated = filtered.slice((page - 1) * PER_PAGE, page * PER_PAGE)

  async function handleSave(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    const payload = Object.fromEntries(fd.entries())
    setSaving(true)
    try {
      if (editData?.id) {
        await apiRequest('/api/admin/jadwal', { method: 'PUT', body: JSON.stringify({ id: editData.id, ...payload }) })
        showToast('Jadwal berhasil diperbarui')
      } else {
        await apiRequest('/api/admin/jadwal', { method: 'POST', body: JSON.stringify(payload) })
        showToast('Jadwal berhasil ditambahkan')
      }
      setModalOpen(false)
      load()
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Gagal menyimpan', 'error')
    } finally { setSaving(false) }
  }

  async function handleDelete() {
    if (!deleteId) return
    setSaving(true)
    try {
      await apiRequest('/api/admin/jadwal', { method: 'DELETE', body: JSON.stringify({ id: deleteId }) })
      showToast('Jadwal berhasil dihapus')
      setDeleteId(null)
      load()
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Gagal menghapus', 'error')
    } finally { setSaving(false) }
  }

  // Buka tab cetak — per jadwal
  function cetakSatu(jadwal: Jadwal, mode: 'daftar-hadir' | 'berita-acara') {
    const url = `/admin/cetak?tanggal=${jadwal.tanggal.slice(0, 10)}&mode=${mode}&id=${jadwal.id}`
    window.open(url, '_blank')
  }

  // Buka tab cetak massal
  function cetakMassal() {
    if (!cetakTanggal) return
    if (cetakMode.daftarHadir) window.open(`/admin/cetak?tanggal=${cetakTanggal}&mode=daftar-hadir`, '_blank')
    if (cetakMode.beritaAcara) window.open(`/admin/cetak?tanggal=${cetakTanggal}&mode=berita-acara`, '_blank')
    setCetakMassalOpen(false)
  }

  return (
    <div className="space-y-6 animate-fade-in">
      {toast && <Toast message={toast.msg} type={toast.type} onClose={() => setToast(null)} />}

      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="page-title">Jadwal Ujian</h1>
          <p className="page-subtitle">{jadwal.length} jadwal terdaftar</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button
            onClick={() => setCetakMassalOpen(true)}
            className="btn-secondary btn-sm"
          >
            <Printer className="w-4 h-4" /> Cetak Massal
          </button>
          <button onClick={() => { setEditData({}); setSelectedMapelId(''); setModalOpen(true) }} className="btn-primary btn-sm">
            <Plus className="w-4 h-4" /> Tambah Jadwal
          </button>
        </div>
      </div>

      <div className="card py-4 flex gap-3 flex-wrap">
        <SearchInput value={search} onChange={v => { setSearch(v); setPage(1) }}
          placeholder="Cari mata pelajaran..." className="flex-1 min-w-[200px]" />
        <select value={filterStatus} onChange={e => { setFilterStatus(e.target.value); setPage(1) }} className="select w-40">
          <option value="">Semua Status</option>
          {['AKTIF', 'BERJALAN', 'SELESAI'].map(s => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
      </div>

      <div className="card p-0 overflow-hidden">
        <div className="table-wrapper">
          {loading ? (
            <div className="flex justify-center py-20"><Spinner size="lg" /></div>
          ) : paginated.length === 0 ? (
            <EmptyState message="Tidak ada jadwal ditemukan" icon={Calendar} />
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Tanggal</th>
                  <th>Mata Pelajaran</th>
                  <th>Kelas</th>
                  <th>Waktu</th>
                  <th>Durasi</th>
                  <th>Status</th>
                  <th>Aksi</th>
                </tr>
              </thead>
              <tbody>
                {paginated.map(j => (
                  <tr key={j.id}>
                    <td>
                      <div className="font-medium text-slate-800">{formatDate(j.tanggal)}</div>
                      <div className="text-xs text-slate-400">Sesi {j.sesi}</div>
                    </td>
                    <td className="font-medium text-slate-800">{j.nama_mapel ?? j.mapel_id}</td>
                    <td><span className="badge-blue">{j.kelas}</span></td>
                    <td className="text-sm text-slate-600">{j.jam_mulai} – {j.jam_selesai}</td>
                    <td className="text-sm text-slate-600">{j.durasi} menit</td>
                    <td><StatusBadge status={j.status} /></td>
                    <td>
                      <div className="flex gap-1 flex-wrap">
                        {/* Tombol cetak daftar hadir */}
                        <button
                          onClick={() => cetakSatu(j, 'daftar-hadir')}
                          className="btn-ghost btn-icon btn-sm text-emerald-600 hover:bg-emerald-50"
                          title="Cetak Daftar Hadir"
                        >
                          <FileText className="w-3.5 h-3.5" />
                        </button>
                        {/* Tombol cetak berita acara */}
                        <button
                          onClick={() => cetakSatu(j, 'berita-acara')}
                          className="btn-ghost btn-icon btn-sm text-blue-600 hover:bg-blue-50"
                          title="Cetak Berita Acara"
                        >
                          <Download className="w-3.5 h-3.5" />
                        </button>
                        {j.status === 'AKTIF' && (
                          <>
                            <button onClick={() => { setEditData(j); setSelectedMapelId(j.mapel_id ?? ''); setModalOpen(true) }}
                              className="btn-ghost btn-icon btn-sm text-slate-600 hover:bg-slate-50">
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                            <button onClick={() => setDeleteId(j.id)}
                              className="btn-ghost btn-icon btn-sm text-red-600 hover:bg-red-50">
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <div className="px-4 py-2 border-t border-slate-100">
          <Pagination page={page} totalPages={Math.ceil(filtered.length / PER_PAGE)}
            onPage={setPage} total={filtered.length} perPage={PER_PAGE} />
        </div>
      </div>

      {/* Modal Cetak Massal */}
      <Modal
        open={cetakMassalOpen}
        onClose={() => setCetakMassalOpen(false)}
        title="Cetak Dokumen Massal"
        size="sm"
        footer={
          <>
            <button onClick={() => setCetakMassalOpen(false)} className="btn-secondary">Batal</button>
            <button onClick={cetakMassal} className="btn-primary" disabled={!cetakTanggal || (!cetakMode.daftarHadir && !cetakMode.beritaAcara)}>
              <Printer className="w-4 h-4" /> Cetak Semua
            </button>
          </>
        }
      >
        <div className="space-y-4">
          <p className="text-sm text-slate-500">
            Pilih tanggal dan jenis dokumen. Semua jadwal pada tanggal tersebut akan dicetak sekaligus dalam satu file.
          </p>
          <div>
            <label className="label">Tanggal Ujian</label>
            <select
              value={cetakTanggal}
              onChange={e => setCetakTanggal(e.target.value)}
              className="select w-full"
            >
              {tanggalList.length === 0 && <option value="">-- Belum ada jadwal --</option>}
              {tanggalList.map(t => (
                <option key={t} value={t}>{formatDate(t)}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Jenis Dokumen</label>
            <div className="flex gap-4">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={cetakMode.daftarHadir}
                  onChange={e => setCetakMode(prev => ({ ...prev, daftarHadir: e.target.checked }))}
                  className="accent-brand-600 w-4 h-4"
                />
                <span className="text-sm text-slate-700">Daftar Hadir</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={cetakMode.beritaAcara}
                  onChange={e => setCetakMode(prev => ({ ...prev, beritaAcara: e.target.checked }))}
                  className="accent-brand-600 w-4 h-4"
                />
                <span className="text-sm text-slate-700">Berita Acara</span>
              </label>
            </div>
            {!cetakMode.daftarHadir && !cetakMode.beritaAcara && (
              <p className="mt-1.5 text-xs text-red-500">Pilih minimal satu jenis dokumen.</p>
            )}
          </div>
          {cetakTanggal && (
            <div className="bg-slate-50 rounded-xl px-4 py-3 text-sm text-slate-600">
              Akan mencetak{' '}
              <strong>{jadwal.filter(j => j.tanggal.slice(0, 10) === cetakTanggal).length} jadwal</strong>
              {' '}pada <strong>{formatDate(cetakTanggal)}</strong>
            </div>
          )}
        </div>
      </Modal>

      {/* Modal Tambah/Edit */}
      <Modal open={modalOpen} onClose={() => setModalOpen(false)}
        title={editData?.id ? 'Edit Jadwal' : 'Tambah Jadwal Baru'}
        footer={
          <>
            <button onClick={() => setModalOpen(false)} className="btn-secondary" disabled={saving}>Batal</button>
            <button form="jadwal-form" type="submit" className="btn-primary" disabled={saving}>
              {saving ? <Spinner size="sm" /> : (editData?.id ? 'Simpan' : 'Tambah')}
            </button>
          </>
        }
      >
        <form id="jadwal-form" onSubmit={handleSave} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Tanggal *</label>
              <input name="tanggal" type="date" className="input" required defaultValue={editData?.tanggal?.slice(0, 10)} />
            </div>
            <div>
              <label className="label">Sesi</label>
              <select name="sesi" className="select" defaultValue={editData?.sesi ?? 1}>
                {[1, 2, 3, 4].map(s => <option key={s} value={s}>Sesi {s}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="label">Mata Pelajaran *</label>
            <select
              name="mapel_id"
              className="select"
              required
              defaultValue={editData?.mapel_id ?? ''}
              onChange={e => setSelectedMapelId(e.target.value)}
            >
              <option value="">Pilih Mapel</option>
              {mapelList.map(m => <option key={m.id} value={m.id}>{m.nama}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Kelas *</label>
            <select name="kelas" className="select" required defaultValue={editData?.kelas ?? ''}>
              <option value="">Pilih Kelas</option>
              {kelasList.map(k => <option key={k.id} value={k.nama}>{k.nama}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="label">Jam Mulai *</label>
              <input name="jam_mulai" type="time" className="input" required defaultValue={editData?.jam_mulai} />
            </div>
            <div>
              <label className="label">Jam Selesai *</label>
              <input name="jam_selesai" type="time" className="input" required defaultValue={editData?.jam_selesai} />
            </div>
            <div>
              <label className="label">Durasi (menit)</label>
              <input name="durasi" type="number" className="input" defaultValue={editData?.durasi ?? 90} min={15} max={240} />
            </div>
          </div>
          <div>
            <label className="label">Pengawas</label>
            {(() => {
              const guruMapel = selectedMapelId
                ? mapelList.find(m => m.id === selectedMapelId)?.guru_id
                : null
              const available = guruList.filter(g => g.username !== guruMapel)
              const excluded = guruList.find(g => g.username === guruMapel)
              return (
                <>
                  <select name="pengawas" className="select" defaultValue={editData?.pengawas ?? ''}>
                    <option value="">- Pilih Pengawas -</option>
                    {available.map(p => (
                      <option key={p.username} value={p.username}>{p.nama}</option>
                    ))}
                  </select>
                  {excluded && selectedMapelId && (
                    <p className="mt-1.5 text-xs text-amber-600">
                      ⚠ <strong>{excluded.nama}</strong> tidak tersedia karena mengampu mata pelajaran ini.
                    </p>
                  )}
                  {available.length === 0 && (
                    <p className="mt-1.5 text-xs text-slate-400">Tidak ada guru yang tersedia sebagai pengawas.</p>
                  )}
                </>
              )
            })()}
          </div>
        </form>
      </Modal>

      <Confirm open={!!deleteId} onClose={() => setDeleteId(null)} onConfirm={handleDelete}
        title="Hapus Jadwal" message="Jadwal ini akan dihapus permanen. Lanjutkan?"
        confirmLabel="Ya, Hapus" loading={saving} />
    </div>
  )
}
