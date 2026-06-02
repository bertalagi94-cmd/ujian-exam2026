'use client'

import { useState, useEffect, useCallback } from 'react'
import { Plus, Pencil, Trash2, Search, Filter, Send, Eye } from 'lucide-react'
import { Modal, Confirm, StatusBadge, SearchInput, Pagination, EmptyState, Spinner, Toast, Badge } from '@/components/ui'
import { apiRequest } from '@/lib/utils'
import { Soal, Mapel, Kelas } from '@/types'

const PER_PAGE = 15

export default function GuruSoalPage() {
  const [soalList, setSoalList] = useState<Soal[]>([])
  const [mapelList, setMapelList] = useState<Mapel[]>([])
  const [kelasList, setKelasList] = useState<Kelas[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [filterMapel, setFilterMapel] = useState('')
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [modalOpen, setModalOpen] = useState(false)
  const [editData, setEditData] = useState<Partial<Soal> | null>(null)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null)
  const [jumlahOpsi, setJumlahOpsi] = useState(4)

  const showToast = (msg: string, type: 'success' | 'error' = 'success') =>
    setToast({ msg, type })

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({
        page: String(page), per_page: String(PER_PAGE),
        ...(search && { search }),
        ...(filterStatus && { status: filterStatus }),
        ...(filterMapel && { mapel_id: filterMapel }),
      })
      const res = await apiRequest<{ data: Soal[]; total: number }>(`/api/guru/soal?${params}`)
      setSoalList(res.data)
      setTotal(res.total)
    } finally { setLoading(false) }
  }, [page, search, filterStatus, filterMapel])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    Promise.all([
      apiRequest<{ data: Mapel[] }>('/api/admin/mapel'),
      apiRequest<{ data: Kelas[] }>('/api/admin/kelas'),
    ]).then(([m, k]) => { setMapelList(m.data); setKelasList(k.data) })
  }, [])

  function openAdd() {
    setEditData({ jumlah_opsi: 4, tingkat: 'Sedang', acak: 'YA', kunci: 'A' })
    setJumlahOpsi(4)
    setModalOpen(true)
  }

  function openEdit(s: Soal) {
    setEditData(s)
    setJumlahOpsi(s.jumlah_opsi || 4)
    setModalOpen(true)
  }

  async function handleSave(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    const payload = Object.fromEntries(fd.entries())
    payload.jumlah_opsi = String(jumlahOpsi)
    setSaving(true)
    try {
      if (editData?.id) {
        await apiRequest(`/api/guru/soal/${editData.id}`, { method: 'PUT', body: JSON.stringify(payload) })
        showToast('Soal berhasil diperbarui')
      } else {
        await apiRequest('/api/guru/soal', { method: 'POST', body: JSON.stringify(payload) })
        showToast('Soal berhasil ditambahkan')
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
      await apiRequest(`/api/guru/soal/${deleteId}`, { method: 'DELETE' })
      showToast('Soal berhasil dihapus')
      setDeleteId(null)
      load()
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Gagal menghapus', 'error')
    } finally { setSaving(false) }
  }

  const tingkatColor: Record<string, string> = {
    Mudah: 'badge-green', Sedang: 'badge-yellow', Sulit: 'badge-red',
  }

  const opsiLabels = ['A', 'B', 'C', 'D', 'E']

  return (
    <div className="space-y-6 animate-fade-in">
      {toast && <Toast message={toast.msg} type={toast.type} onClose={() => setToast(null)} />}

      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="page-title">Bank Soal</h1>
          <p className="page-subtitle">{total} soal tersimpan</p>
        </div>
        <button onClick={openAdd} className="btn-primary btn-sm">
          <Plus className="w-4 h-4" /> Tambah Soal
        </button>
      </div>

      {/* Filters */}
      <div className="card py-4 flex gap-3 flex-wrap">
        <SearchInput value={search} onChange={v => { setSearch(v); setPage(1) }}
          placeholder="Cari teks soal..." className="flex-1 min-w-[200px]" />
        <select value={filterMapel} onChange={e => { setFilterMapel(e.target.value); setPage(1) }} className="select w-44">
          <option value="">Semua Mapel</option>
          {mapelList.map(m => <option key={m.id} value={m.id}>{m.nama}</option>)}
        </select>
        <select value={filterStatus} onChange={e => { setFilterStatus(e.target.value); setPage(1) }} className="select w-36">
          <option value="">Semua Status</option>
          {['DRAFT', 'MENUNGGU', 'DISETUJUI', 'DITOLAK'].map(s =>
            <option key={s} value={s}>{s}</option>
          )}
        </select>
      </div>

      {/* Table */}
      <div className="card p-0 overflow-hidden">
        <div className="table-wrapper">
          {loading ? (
            <div className="flex items-center justify-center py-20"><Spinner size="lg" /></div>
          ) : soalList.length === 0 ? (
            <EmptyState message="Tidak ada soal ditemukan" icon={Search} />
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Pertanyaan</th>
                  <th>Kunci</th>
                  <th>Tingkat</th>
                  <th>Status</th>
                  <th>Aksi</th>
                </tr>
              </thead>
              <tbody>
                {soalList.map((s, i) => (
                  <tr key={s.id}>
                    <td className="text-slate-400 text-xs">{(page - 1) * PER_PAGE + i + 1}</td>
                    <td className="max-w-[400px]">
                      <p className="text-sm text-slate-800 line-clamp-2">{s.teks}</p>
                      {s.gambar_url && <span className="text-xs text-brand-500 mt-1 block">📷 Ada gambar</span>}
                    </td>
                    <td>
                      <span className="w-7 h-7 rounded-lg bg-brand-100 text-brand-700 font-bold text-sm flex items-center justify-center">
                        {s.kunci}
                      </span>
                    </td>
                    <td>
                      <span className={`badge ${tingkatColor[s.tingkat] ?? 'badge-slate'}`}>{s.tingkat}</span>
                    </td>
                    <td><StatusBadge status={s.status} /></td>
                    <td>
                      <div className="flex items-center gap-1">
                        <button onClick={() => openEdit(s)} className="btn-ghost btn-icon btn-sm text-blue-600 hover:bg-blue-50">
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        {s.status === 'DRAFT' && (
                          <button onClick={() => setDeleteId(s.id)} className="btn-ghost btn-icon btn-sm text-red-600 hover:bg-red-50">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
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
          <Pagination page={page} totalPages={Math.ceil(total / PER_PAGE)}
            onPage={setPage} total={total} perPage={PER_PAGE} />
        </div>
      </div>

      {/* Soal Form Modal */}
      <Modal open={modalOpen} onClose={() => setModalOpen(false)}
        title={editData?.id ? 'Edit Soal' : 'Tambah Soal Baru'} size="xl"
        footer={
          <>
            <button onClick={() => setModalOpen(false)} className="btn-secondary" disabled={saving}>Batal</button>
            <button form="soal-form" type="submit" className="btn-primary" disabled={saving}>
              {saving ? <Spinner size="sm" /> : (editData?.id ? 'Simpan Perubahan' : 'Tambah Soal')}
            </button>
          </>
        }
      >
        <form id="soal-form" onSubmit={handleSave} className="space-y-4">
          {/* Mapel & Kelas */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Mata Pelajaran *</label>
              <select name="mapel_id" className="select" required defaultValue={editData?.mapel_id ?? ''}>
                <option value="">Pilih Mapel</option>
                {mapelList.map(m => <option key={m.id} value={m.id}>{m.nama}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Kelas *</label>
              <select name="kelas_id" className="select" required defaultValue={editData?.kelas_id ?? ''}>
                <option value="">Pilih Kelas</option>
                {kelasList.map(k => <option key={k.id} value={k.id}>{k.nama}</option>)}
              </select>
            </div>
          </div>

          {/* Pertanyaan */}
          <div>
            <label className="label">Teks Pertanyaan *</label>
            <textarea name="teks" className="textarea" rows={4} required
              placeholder="Tulis pertanyaan di sini..."
              defaultValue={editData?.teks ?? ''} />
          </div>

          {/* Jumlah Opsi & Tingkat */}
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="label">Jumlah Opsi</label>
              <select className="select" value={jumlahOpsi} onChange={e => setJumlahOpsi(Number(e.target.value))}>
                <option value={3}>3 Opsi</option>
                <option value={4}>4 Opsi</option>
                <option value={5}>5 Opsi</option>
              </select>
            </div>
            <div>
              <label className="label">Tingkat Kesulitan</label>
              <select name="tingkat" className="select" defaultValue={editData?.tingkat ?? 'Sedang'}>
                <option>Mudah</option>
                <option>Sedang</option>
                <option>Sulit</option>
              </select>
            </div>
            <div>
              <label className="label">Acak Opsi</label>
              <select name="acak" className="select" defaultValue={editData?.acak ?? 'YA'}>
                <option value="YA">Ya</option>
                <option value="TIDAK">Tidak</option>
              </select>
            </div>
          </div>

          {/* Opsi Jawaban */}
          <div className="space-y-2">
            <label className="label">Opsi Jawaban</label>
            {opsiLabels.slice(0, jumlahOpsi).map(label => (
              <div key={label} className="flex items-center gap-2">
                <span className="w-7 h-7 rounded-lg bg-slate-100 text-slate-600 font-bold text-xs flex items-center justify-center flex-shrink-0">
                  {label}
                </span>
                <input
                  name={`opsi_${label.toLowerCase()}`}
                  className="input"
                  placeholder={`Opsi ${label}`}
                  required
                  defaultValue={editData?.[`opsi_${label.toLowerCase()}` as keyof Soal] as string ?? ''}
                />
              </div>
            ))}
          </div>

          {/* Kunci & Pembahasan */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Kunci Jawaban *</label>
              <select name="kunci" className="select" required defaultValue={editData?.kunci ?? 'A'}>
                {opsiLabels.slice(0, jumlahOpsi).map(l => <option key={l} value={l}>{l}</option>)}
              </select>
            </div>
          </div>

          <div>
            <label className="label">Pembahasan (opsional)</label>
            <textarea name="pembahasan" className="textarea" rows={3}
              placeholder="Penjelasan jawaban yang benar..."
              defaultValue={editData?.pembahasan ?? ''} />
          </div>
        </form>
      </Modal>

      <Confirm open={!!deleteId} onClose={() => setDeleteId(null)} onConfirm={handleDelete}
        title="Hapus Soal" message="Soal ini akan dihapus permanen. Lanjutkan?"
        confirmLabel="Ya, Hapus" loading={saving} />
    </div>
  )
}
