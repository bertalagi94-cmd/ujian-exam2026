'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { Plus, Pencil, Trash2, Search, Eye, Lock, ImagePlus, X } from 'lucide-react'
import { Modal, Confirm, StatusBadge, SearchInput, Pagination, EmptyState, Spinner, Toast } from '@/components/ui'
import { apiRequest } from '@/lib/utils'
import { Soal, Mapel, Kelas } from '@/types'

const PER_PAGE = 15

interface SoalWithMapel extends Soal {
  nama_mapel?: string
  gambar_pertanyaan?: string
  gambar_opsi_a?: string
  gambar_opsi_b?: string
  gambar_opsi_c?: string
  gambar_opsi_d?: string
  gambar_opsi_e?: string
}

export default function GuruSoalPage() {
  const [soalList, setSoalList] = useState<SoalWithMapel[]>([])
  const [mapelList, setMapelList] = useState<Mapel[]>([])
  const [kelasList, setKelasList] = useState<Kelas[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [filterMapel, setFilterMapel] = useState('')
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [modalOpen, setModalOpen] = useState(false)
  const [viewData, setViewData] = useState<SoalWithMapel | null>(null)
  const [editData, setEditData] = useState<Partial<SoalWithMapel> | null>(null)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null)
  const [jumlahOpsi, setJumlahOpsi] = useState(4)

  // Image state
  const [imgPertanyaan, setImgPertanyaan] = useState<string>('')
  const [imgOpsi, setImgOpsi] = useState<Record<string, string>>({})
  const [uploadingImg, setUploadingImg] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [pendingUploadKey, setPendingUploadKey] = useState<string | null>(null)

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
      const res = await apiRequest<{ data: SoalWithMapel[]; total: number }>(`/api/guru/soal?${params}`)
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
    setEditData({ jumlah_opsi: 4, tingkat: 'Sedang', kunci: 'A' })
    setJumlahOpsi(4)
    setImgPertanyaan('')
    setImgOpsi({})
    setModalOpen(true)
  }

  function openEdit(s: SoalWithMapel) {
    setEditData(s)
    setJumlahOpsi(s.jumlah_opsi || 4)
    setImgPertanyaan((s as Record<string, unknown>).gambar_pertanyaan as string || '')
    const opsiImgs: Record<string, string> = {}
    for (const l of ['a','b','c','d','e']) {
      const v = (s as Record<string, unknown>)[`gambar_opsi_${l}`] as string
      if (v) opsiImgs[l] = v
    }
    setImgOpsi(opsiImgs)
    setModalOpen(true)
  }

  async function uploadImage(key: string, file: File) {
    setUploadingImg(key)
    try {
      const formData = new FormData()
      formData.append('file', file)
      const token = localStorage.getItem('token')
      const res = await fetch('/api/guru/soal/upload', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Upload gagal')
      if (key === 'pertanyaan') {
        setImgPertanyaan(data.url)
      } else {
        setImgOpsi(prev => ({ ...prev, [key]: data.url }))
      }
    } catch (e: unknown) {
      showToast(e instanceof Error ? e.message : 'Upload gambar gagal', 'error')
    } finally {
      setUploadingImg(null)
    }
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file || !pendingUploadKey) return
    uploadImage(pendingUploadKey, file)
    e.target.value = ''
  }

  function triggerUpload(key: string) {
    setPendingUploadKey(key)
    setTimeout(() => fileInputRef.current?.click(), 50)
  }

  async function handleSave(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    const payload: Record<string, unknown> = Object.fromEntries(fd.entries())
    payload.jumlah_opsi = String(jumlahOpsi)
    payload.gambar_pertanyaan = imgPertanyaan || null
    for (const l of ['a','b','c','d','e']) {
      payload[`gambar_opsi_${l}`] = imgOpsi[l] || null
    }
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

  const isReadOnly = (s: SoalWithMapel) => ['DISETUJUI', 'MENUNGGU'].includes(s.status)

  const tingkatColor: Record<string, string> = {
    Mudah: 'badge-green', Sedang: 'badge-yellow', Sulit: 'badge-red',
  }
  const opsiLabels = ['A', 'B', 'C', 'D', 'E']

  return (
    <div className="space-y-6 animate-fade-in">
      {toast && <Toast message={toast.msg} type={toast.type} onClose={() => setToast(null)} />}
      <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleFileChange} />

      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="page-title">Bank Soal</h1>
          <p className="page-subtitle">{total} soal tersimpan · Soal yang sudah dikirim/disetujui hanya bisa dilihat</p>
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
                  <th>Mapel</th>
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
                    <td className="max-w-[360px]">
                      <p className="text-sm text-slate-800 line-clamp-2">{s.teks}</p>
                      {(s as Record<string, unknown>).gambar_pertanyaan && <span className="text-xs text-brand-500 mt-1 block">📷 Ada gambar</span>}
                    </td>
                    <td className="text-sm text-slate-600 whitespace-nowrap">{s.nama_mapel ?? s.mapel_id}</td>
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
                        {isReadOnly(s) ? (
                          <>
                            <button onClick={() => setViewData(s)} className="btn-ghost btn-icon btn-sm text-slate-500 hover:bg-slate-100" title="Lihat soal">
                              <Eye className="w-3.5 h-3.5" />
                            </button>
                            <span title="Soal tidak bisa diedit" className="btn-ghost btn-icon btn-sm text-slate-300 cursor-not-allowed">
                              <Lock className="w-3.5 h-3.5" />
                            </span>
                          </>
                        ) : (
                          <>
                            <button onClick={() => openEdit(s)} className="btn-ghost btn-icon btn-sm text-blue-600 hover:bg-blue-50" title="Edit soal">
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                            <button onClick={() => setDeleteId(s.id)} className="btn-ghost btn-icon btn-sm text-red-600 hover:bg-red-50" title="Hapus soal">
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
          <Pagination page={page} totalPages={Math.ceil(total / PER_PAGE)}
            onPage={setPage} total={total} perPage={PER_PAGE} />
        </div>
      </div>

      {/* View Modal (read-only) */}
      <Modal open={!!viewData} onClose={() => setViewData(null)}
        title="Detail Soal" size="xl">
        {viewData && (
          <div className="space-y-4">
            <div className="alert-info text-xs flex items-center gap-2">
              <Lock className="w-3.5 h-3.5 flex-shrink-0" />
              Soal ini sudah dikirim ke admin dan tidak bisa diedit atau dihapus.
            </div>
            <div>
              <p className="label mb-1">Pertanyaan</p>
              <p className="text-sm text-slate-800 leading-relaxed">{viewData.teks}</p>
              {(viewData as Record<string, unknown>).gambar_pertanyaan && (
                <img src={(viewData as Record<string, unknown>).gambar_pertanyaan as string} alt="Gambar pertanyaan" className="mt-2 max-h-48 rounded-lg border border-slate-200" />
              )}
            </div>
            <div className="space-y-1.5">
              <p className="label mb-1">Pilihan Jawaban</p>
              {opsiLabels.slice(0, viewData.jumlah_opsi).map(l => {
                const opsiText = (viewData as Record<string, unknown>)[`opsi_${l.toLowerCase()}`] as string
                const opsiImg = (viewData as Record<string, unknown>)[`gambar_opsi_${l.toLowerCase()}`] as string
                const isKunci = viewData.kunci === l
                return (
                  <div key={l} className={`flex items-start gap-2 text-sm px-3 py-2 rounded-lg ${isKunci ? 'bg-emerald-50 text-emerald-800 font-medium' : 'text-slate-600'}`}>
                    <span className={`w-6 h-6 rounded flex items-center justify-center text-xs font-bold flex-shrink-0 mt-0.5 ${isKunci ? 'bg-emerald-500 text-white' : 'bg-slate-100 text-slate-500'}`}>{l}</span>
                    <div>
                      <span>{opsiText}</span>
                      {opsiImg && <img src={opsiImg} alt={`Gambar opsi ${l}`} className="mt-1 max-h-24 rounded border border-slate-200" />}
                    </div>
                    {isKunci && <span className="ml-auto text-emerald-600 text-xs">✓ Kunci</span>}
                  </div>
                )
              })}
            </div>
            {viewData.pembahasan && (
              <div>
                <p className="label mb-1">Pembahasan</p>
                <p className="text-sm text-slate-700">{viewData.pembahasan}</p>
              </div>
            )}
          </div>
        )}
      </Modal>

      {/* Add/Edit Modal */}
      <Modal open={modalOpen} onClose={() => setModalOpen(false)}
        title={editData?.id ? 'Edit Soal' : 'Tambah Soal Baru'} size="xl"
        footer={
          <>
            <button onClick={() => setModalOpen(false)} className="btn-secondary" disabled={saving}>Batal</button>
            <button form="soal-form" type="submit" className="btn-primary" disabled={saving || !!uploadingImg}>
              {saving ? <Spinner size="sm" /> : (editData?.id ? 'Simpan Perubahan' : 'Tambah Soal')}
            </button>
          </>
        }
      >
        <form id="soal-form" onSubmit={handleSave} className="space-y-4">
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

          <div>
            <label className="label">Teks Pertanyaan *</label>
            <textarea name="teks" className="textarea" rows={3} required
              placeholder="Tulis pertanyaan di sini..."
              defaultValue={editData?.teks ?? ''} />
            <div className="mt-2">
              {imgPertanyaan ? (
                <div className="relative inline-block">
                  <img src={imgPertanyaan} alt="Gambar pertanyaan" className="max-h-32 rounded-lg border border-slate-200" />
                  <button type="button" onClick={() => setImgPertanyaan('')}
                    className="absolute -top-1.5 -right-1.5 bg-red-500 text-white rounded-full w-5 h-5 flex items-center justify-center">
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ) : (
                <button type="button" onClick={() => triggerUpload('pertanyaan')}
                  className="btn-secondary btn-sm text-xs" disabled={!!uploadingImg}>
                  {uploadingImg === 'pertanyaan' ? <Spinner size="sm" /> : <><ImagePlus className="w-3.5 h-3.5" /> Tambah Gambar Pertanyaan</>}
                </button>
              )}
            </div>
          </div>

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
              <label className="label">Kunci Jawaban *</label>
              <select name="kunci" className="select" required defaultValue={editData?.kunci ?? 'A'}>
                {opsiLabels.slice(0, jumlahOpsi).map(l => <option key={l} value={l}>{l}</option>)}
              </select>
            </div>
          </div>

          <div className="space-y-2">
            <label className="label">Opsi Jawaban</label>
            {opsiLabels.slice(0, jumlahOpsi).map(label => {
              const lowerLabel = label.toLowerCase()
              const imgKey = lowerLabel
              return (
                <div key={label} className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="w-7 h-7 rounded-lg bg-slate-100 text-slate-600 font-bold text-xs flex items-center justify-center flex-shrink-0">
                      {label}
                    </span>
                    <input
                      name={`opsi_${lowerLabel}`}
                      className="input"
                      placeholder={`Opsi ${label}`}
                      required
                      defaultValue={editData?.[`opsi_${lowerLabel}` as keyof Soal] as string ?? ''}
                    />
                    <button type="button" onClick={() => triggerUpload(imgKey)}
                      className="btn-ghost btn-icon btn-sm text-slate-500 flex-shrink-0" title={`Tambah gambar opsi ${label}`}
                      disabled={!!uploadingImg}>
                      {uploadingImg === imgKey ? <Spinner size="sm" /> : <ImagePlus className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                  {imgOpsi[imgKey] && (
                    <div className="ml-9 relative inline-block">
                      <img src={imgOpsi[imgKey]} alt={`Gambar opsi ${label}`} className="max-h-20 rounded border border-slate-200" />
                      <button type="button" onClick={() => setImgOpsi(prev => { const n = {...prev}; delete n[imgKey]; return n })}
                        className="absolute -top-1.5 -right-1.5 bg-red-500 text-white rounded-full w-5 h-5 flex items-center justify-center">
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          <div>
            <label className="label">Pembahasan (opsional)</label>
            <textarea name="pembahasan" className="textarea" rows={2}
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
