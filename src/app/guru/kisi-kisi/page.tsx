'use client'

import { useState, useEffect, useCallback } from 'react'
import { FileText, Plus, Send, Save, Edit2, Trash2, Eye, X, ChevronDown, Users, Clock } from 'lucide-react'
import { apiRequest, formatDateTime } from '@/lib/utils'

interface KisiKisi {
  id: string
  mapel_id: string
  kelas_id: string
  guru_id: string
  konten: string
  status: 'DRAFT' | 'TERKIRIM'
  created_at: string
  updated_at: string
  nama_mapel: string
  nama_kelas: string
  nama_guru: string
  is_mine: boolean
}

interface MapelAmpu {
  id: string
  nama: string
  kelas: { id: string; nama: string }[]
}

type ViewMode = 'list' | 'form' | 'preview'

export default function GuruKisiKisiPage() {
  const [kisiList, setKisiList] = useState<KisiKisi[]>([])
  const [mapelAmpu, setMapelAmpu] = useState<MapelAmpu[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [view, setView] = useState<ViewMode>('list')
  const [preview, setPreview] = useState<KisiKisi | null>(null)
  const [editing, setEditing] = useState<KisiKisi | null>(null)
  const [error, setError] = useState('')
  const [successMsg, setSuccessMsg] = useState('')

  // Form state
  const [selectedMapel, setSelectedMapel] = useState('')
  const [selectedKelas, setSelectedKelas] = useState('')
  const [konten, setKonten] = useState('')

  const kelasList = mapelAmpu.find(m => m.id === selectedMapel)?.kelas ?? []

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const [kisiRes, mapelRes] = await Promise.all([
        apiRequest<{ data: KisiKisi[] }>('/api/guru/kisi-kisi'),
        apiRequest<{ data: MapelAmpu[] }>('/api/guru/kisi-kisi/mapel-ampu'),
      ])
      setKisiList(kisiRes.data ?? [])
      setMapelAmpu(mapelRes.data ?? [])
    } catch {
      setError('Gagal memuat data')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  function showSuccess(msg: string) {
    setSuccessMsg(msg)
    setTimeout(() => setSuccessMsg(''), 3500)
  }

  function openBuat() {
    setEditing(null)
    setSelectedMapel('')
    setSelectedKelas('')
    setKonten('')
    setError('')
    setView('form')
  }

  function openEdit(k: KisiKisi) {
    setEditing(k)
    setSelectedMapel(k.mapel_id)
    setSelectedKelas(k.kelas_id)
    setKonten(k.konten)
    setError('')
    setView('form')
  }

  function openPreview(k: KisiKisi) {
    setPreview(k)
    setView('preview')
  }

  function backToList() {
    setView('list')
    setPreview(null)
    setEditing(null)
    setError('')
  }

  async function handleSave(status: 'DRAFT' | 'TERKIRIM') {
    if (!selectedMapel || !selectedKelas || !konten.trim()) {
      setError('Mapel, kelas, dan konten kisi-kisi wajib diisi')
      return
    }
    setSaving(true)
    setError('')
    try {
      if (editing) {
        await apiRequest('/api/guru/kisi-kisi', {
          method: 'PUT',
          body: JSON.stringify({ id: editing.id, konten, status }),
        })
        showSuccess(status === 'TERKIRIM' ? 'Kisi-kisi berhasil dikirim ke siswa!' : 'Draft berhasil disimpan')
      } else {
        await apiRequest('/api/guru/kisi-kisi', {
          method: 'POST',
          body: JSON.stringify({ mapel_id: selectedMapel, kelas_id: selectedKelas, konten, status }),
        })
        showSuccess(status === 'TERKIRIM' ? 'Kisi-kisi berhasil dikirim ke siswa!' : 'Draft berhasil disimpan')
      }
      backToList()
      fetchData()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Terjadi kesalahan')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(id: string, namaMapel: string, namaKelas: string) {
    if (!confirm(`Hapus kisi-kisi ${namaMapel} – ${namaKelas}?\nTindakan ini tidak bisa dibatalkan.`)) return
    try {
      await apiRequest(`/api/guru/kisi-kisi?id=${id}`, { method: 'DELETE' })
      showSuccess('Kisi-kisi berhasil dihapus')
      fetchData()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Gagal menghapus')
    }
  }

  const sudahAda = !editing && kisiList.some(
    k => k.mapel_id === selectedMapel && k.kelas_id === selectedKelas
  )

  const milikSendiri = kisiList.filter(k => k.is_mine)
  const milikRekan = kisiList.filter(k => !k.is_mine)

  // ── PREVIEW ──────────────────────────────────────────────────────────────
  if (view === 'preview' && preview) {
    return (
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center gap-3 mb-6">
          <button onClick={backToList} className="btn-ghost btn-sm flex items-center gap-1.5">
            <X className="w-4 h-4" /> Kembali
          </button>
          <div className="flex-1">
            <h1 className="text-lg font-bold text-slate-800">{preview.nama_mapel}</h1>
            <p className="text-sm text-slate-500">{preview.nama_kelas} · {preview.nama_guru}</p>
          </div>
          <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${
            preview.status === 'TERKIRIM' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'
          }`}>
            {preview.status === 'TERKIRIM' ? 'Terkirim ke Siswa' : 'Draft'}
          </span>
        </div>

        <div className="card p-6 lg:p-8">
          <pre className="whitespace-pre-wrap font-sans text-sm text-slate-700 leading-relaxed w-full">
            {preview.konten}
          </pre>
          <div className="mt-6 pt-4 border-t border-slate-100 text-xs text-slate-400 flex items-center gap-1.5">
            <Clock className="w-3 h-3" />
            Terakhir diperbarui: {formatDateTime(preview.updated_at)}
          </div>
        </div>

        {preview.is_mine && (
          <div className="mt-4">
            <button onClick={() => openEdit(preview)} className="btn-secondary flex items-center gap-2">
              <Edit2 className="w-4 h-4" /> Edit Kisi-kisi
            </button>
          </div>
        )}
      </div>
    )
  }

  // ── FORM ─────────────────────────────────────────────────────────────────
  if (view === 'form') {
    return (
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center gap-3 mb-6">
          <button onClick={backToList} className="btn-ghost btn-sm flex items-center gap-1.5">
            <X className="w-4 h-4" /> Batal
          </button>
          <h1 className="text-lg font-bold text-slate-800">
            {editing ? 'Edit Kisi-kisi' : 'Buat Kisi-kisi Baru'}
          </h1>
        </div>

        {error && (
          <div className="mb-4 p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm">{error}</div>
        )}

        <div className="card p-6 lg:p-8">
          {/* Mapel & Kelas */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">Mata Pelajaran</label>
              {editing ? (
                <div className="input-field bg-slate-50 text-slate-500 cursor-not-allowed select-none">
                  {editing.nama_mapel}
                </div>
              ) : (
                <div className="relative">
                  <select
                    value={selectedMapel}
                    onChange={e => { setSelectedMapel(e.target.value); setSelectedKelas('') }}
                    className="input-field appearance-none pr-9 cursor-pointer"
                  >
                    <option value="">-- Pilih Mapel --</option>
                    {mapelAmpu.map(m => (
                      <option key={m.id} value={m.id}>{m.nama}</option>
                    ))}
                  </select>
                  <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
                </div>
              )}
              {!editing && mapelAmpu.length === 0 && !loading && (
                <p className="text-xs text-amber-600 mt-1">Tidak ada mapel yang diampu. Hubungi admin.</p>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">Kelas</label>
              {editing ? (
                <div className="input-field bg-slate-50 text-slate-500 cursor-not-allowed select-none">
                  {editing.nama_kelas}
                </div>
              ) : (
                <div className="relative">
                  <select
                    value={selectedKelas}
                    onChange={e => setSelectedKelas(e.target.value)}
                    className="input-field appearance-none pr-9 cursor-pointer disabled:opacity-50"
                    disabled={!selectedMapel}
                  >
                    <option value="">-- Pilih Kelas --</option>
                    {kelasList.map(k => (
                      <option key={k.id} value={k.id}>{k.nama}</option>
                    ))}
                  </select>
                  <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
                </div>
              )}
            </div>
          </div>

          {sudahAda && (
            <div className="mb-4 p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-700 text-sm">
              ⚠ Kisi-kisi untuk kelas dan mapel ini sudah ada. Silakan edit yang sudah ada.
            </div>
          )}

          {/* Konten — lebar penuh, tinggi besar */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">Konten Kisi-kisi</label>
            <textarea
              value={konten}
              onChange={e => setKonten(e.target.value)}
              className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent resize-y transition-shadow min-h-[360px] lg:min-h-[480px] leading-relaxed"
              placeholder="Tulis kisi-kisi di sini..."
            />
            <p className="text-xs text-slate-400 mt-1">{konten.length} karakter</p>
          </div>
        </div>

        {/* Tombol aksi */}
        <div className="flex flex-wrap gap-3 mt-5">
          <button
            onClick={() => handleSave('DRAFT')}
            disabled={saving || sudahAda}
            className="btn-secondary flex items-center gap-2 disabled:opacity-50"
          >
            <Save className="w-4 h-4" />
            {saving ? 'Menyimpan...' : 'Simpan Draft'}
          </button>
          <button
            onClick={() => handleSave('TERKIRIM')}
            disabled={saving || sudahAda}
            className="btn-primary flex items-center gap-2 disabled:opacity-50"
          >
            <Send className="w-4 h-4" />
            {saving ? 'Mengirim...' : 'Kirim ke Siswa'}
          </button>
        </div>
        <p className="text-xs text-slate-400 mt-2">
          Draft hanya terlihat oleh rekan guru, belum tampil ke siswa.
        </p>
      </div>
    )
  }

  // ── LIST ─────────────────────────────────────────────────────────────────
  return (
    <div className="max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-slate-800 flex items-center gap-2">
            <FileText className="w-5 h-5 text-emerald-600" /> Kisi-kisi
          </h1>
          <p className="text-sm text-slate-500 mt-0.5">Kelola dan bagikan kisi-kisi ujian ke siswa</p>
        </div>
        <button onClick={openBuat} className="btn-primary flex items-center gap-2">
          <Plus className="w-4 h-4" /> Buat Kisi-kisi
        </button>
      </div>

      {successMsg && (
        <div className="mb-4 p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-700 text-sm">
          ✓ {successMsg}
        </div>
      )}
      {error && (
        <div className="mb-4 p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm">{error}</div>
      )}

      {loading ? (
        <div className="text-center py-16 text-slate-400">Memuat data...</div>
      ) : kisiList.length === 0 ? (
        <div className="card p-12 text-center">
          <FileText className="w-10 h-10 text-slate-300 mx-auto mb-3" />
          <p className="text-slate-500 font-medium">Belum ada kisi-kisi</p>
          <p className="text-slate-400 text-sm mt-1 mb-4">Klik "Buat Kisi-kisi" untuk membuat yang pertama</p>
          <button onClick={openBuat} className="btn-primary inline-flex items-center gap-2">
            <Plus className="w-4 h-4" /> Buat Kisi-kisi
          </button>
        </div>
      ) : (
        <div className="space-y-6">
          {milikSendiri.length > 0 && (
            <section>
              <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-3">Kisi-kisi Saya</h2>
              <div className="space-y-2">
                {milikSendiri.map(k => (
                  <KisiKisiCard
                    key={k.id}
                    item={k}
                    onPreview={() => openPreview(k)}
                    onEdit={() => openEdit(k)}
                    onDelete={() => handleDelete(k.id, k.nama_mapel, k.nama_kelas)}
                    canEdit
                  />
                ))}
              </div>
            </section>
          )}

          {milikRekan.length > 0 && (
            <section>
              <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-3">Kisi-kisi Rekan Guru</h2>
              <div className="space-y-2">
                {milikRekan.map(k => (
                  <KisiKisiCard
                    key={k.id}
                    item={k}
                    onPreview={() => openPreview(k)}
                    canEdit={false}
                  />
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  )
}

function KisiKisiCard({
  item, onPreview, onEdit, onDelete, canEdit,
}: {
  item: KisiKisi
  onPreview: () => void
  onEdit?: () => void
  onDelete?: () => void
  canEdit: boolean
}) {
  return (
    <div className="card p-4 flex items-center gap-4 hover:shadow-card-md transition-shadow">
      <div className="w-10 h-10 rounded-xl bg-emerald-50 flex items-center justify-center flex-shrink-0">
        <FileText className="w-5 h-5 text-emerald-600" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-semibold text-slate-800 text-sm">{item.nama_mapel}</span>
          <span className="text-slate-300">·</span>
          <span className="text-slate-600 text-sm">{item.nama_kelas}</span>
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
            item.status === 'TERKIRIM'
              ? 'bg-emerald-100 text-emerald-700'
              : 'bg-amber-100 text-amber-700'
          }`}>
            {item.status === 'TERKIRIM' ? 'Terkirim' : 'Draft'}
          </span>
        </div>
        <div className="flex items-center gap-3 mt-0.5 text-xs text-slate-400">
          <span className="flex items-center gap-1"><Users className="w-3 h-3" />{item.nama_guru}</span>
          <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{formatDateTime(item.updated_at)}</span>
        </div>
      </div>
      <div className="flex items-center gap-1 flex-shrink-0">
        <button onClick={onPreview} className="btn-ghost btn-icon btn-sm" title="Lihat">
          <Eye className="w-4 h-4" />
        </button>
        {canEdit && onEdit && (
          <button onClick={onEdit} className="btn-ghost btn-icon btn-sm" title="Edit">
            <Edit2 className="w-4 h-4" />
          </button>
        )}
        {canEdit && onDelete && (
          <button onClick={onDelete} className="btn-ghost btn-icon btn-sm text-red-500 hover:bg-red-50" title="Hapus">
            <Trash2 className="w-4 h-4" />
          </button>
        )}
      </div>
    </div>
  )
}
