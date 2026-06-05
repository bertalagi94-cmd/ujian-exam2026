'use client'

import { useState, useEffect, useCallback } from 'react'
import { FileText, Plus, Send, Save, Edit2, Trash2, Eye, X, ChevronDown, Users, Clock, ChevronRight, BookOpen, GraduationCap } from 'lucide-react'
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

// Warna kartu per kelas (cycling)
const CARD_COLORS = [
  { bg: 'from-emerald-500 to-teal-600', light: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200', dot: 'bg-emerald-500' },
  { bg: 'from-blue-500 to-indigo-600', light: 'bg-blue-50', text: 'text-blue-700', border: 'border-blue-200', dot: 'bg-blue-500' },
  { bg: 'from-violet-500 to-purple-600', light: 'bg-violet-50', text: 'text-violet-700', border: 'border-violet-200', dot: 'bg-violet-500' },
  { bg: 'from-orange-500 to-amber-600', light: 'bg-orange-50', text: 'text-orange-700', border: 'border-orange-200', dot: 'bg-orange-500' },
  { bg: 'from-rose-500 to-pink-600', light: 'bg-rose-50', text: 'text-rose-700', border: 'border-rose-200', dot: 'bg-rose-500' },
  { bg: 'from-cyan-500 to-sky-600', light: 'bg-cyan-50', text: 'text-cyan-700', border: 'border-cyan-200', dot: 'bg-cyan-500' },
]

type ViewMode = 'cards' | 'kelas-detail' | 'form' | 'preview'

export default function GuruKisiKisiPage() {
  const [kisiList, setKisiList] = useState<KisiKisi[]>([])
  const [mapelAmpu, setMapelAmpu] = useState<MapelAmpu[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [view, setView] = useState<ViewMode>('cards')
  const [selectedKelas, setSelectedKelasDetail] = useState<string | null>(null)
  const [preview, setPreview] = useState<KisiKisi | null>(null)
  const [editing, setEditing] = useState<KisiKisi | null>(null)
  const [error, setError] = useState('')
  const [successMsg, setSuccessMsg] = useState('')

  // Form state
  const [formMapel, setFormMapel] = useState('')
  const [formKelas, setFormKelas] = useState('')
  const [konten, setKonten] = useState('')

  const kelasList = mapelAmpu.find(m => m.id === formMapel)?.kelas ?? []

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
    setFormMapel('')
    setFormKelas('')
    setKonten('')
    setError('')
    setView('form')
  }

  function openEdit(k: KisiKisi) {
    setEditing(k)
    setFormMapel(k.mapel_id)
    setFormKelas(k.kelas_id)
    setKonten(k.konten)
    setError('')
    setView('form')
  }

  function openPreview(k: KisiKisi) {
    setPreview(k)
    setView('preview')
  }

  function openKelasDetail(namaKelas: string) {
    setSelectedKelasDetail(namaKelas)
    setView('kelas-detail')
  }

  function backToCards() {
    setView('cards')
    setSelectedKelasDetail(null)
    setPreview(null)
    setEditing(null)
    setError('')
  }

  function backToKelasDetail() {
    setPreview(null)
    setEditing(null)
    setView('kelas-detail')
    setError('')
  }

  async function handleSave(status: 'DRAFT' | 'TERKIRIM') {
    if (!formMapel || !formKelas || !konten.trim()) {
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
          body: JSON.stringify({ mapel_id: formMapel, kelas_id: formKelas, konten, status }),
        })
        showSuccess(status === 'TERKIRIM' ? 'Kisi-kisi berhasil dikirim ke siswa!' : 'Draft berhasil disimpan')
      }
      // Kembali ke tampilan yang sesuai
      if (selectedKelas) {
        setView('kelas-detail')
      } else {
        setView('cards')
      }
      setEditing(null)
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
    k => k.mapel_id === formMapel && k.kelas_id === formKelas
  )

  // Kelompokkan kisi-kisi per kelas
  const kelasGroups = kisiList.reduce<Record<string, { namaKelas: string; items: KisiKisi[] }>>((acc, k) => {
    if (!acc[k.kelas_id]) acc[k.kelas_id] = { namaKelas: k.nama_kelas, items: [] }
    acc[k.kelas_id].items.push(k)
    return acc
  }, {})

  const kelasEntries = Object.entries(kelasGroups)
  const kisiDiKelas = selectedKelas
    ? kisiList.filter(k => k.nama_kelas === selectedKelas)
    : []

  // ── PREVIEW ──────────────────────────────────────────────────────────────
  if (view === 'preview' && preview) {
    return (
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center gap-3 mb-6">
          <button
            onClick={selectedKelas ? backToKelasDetail : backToCards}
            className="btn-ghost btn-sm flex items-center gap-1.5"
          >
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
          <button
            onClick={selectedKelas ? backToKelasDetail : backToCards}
            className="btn-ghost btn-sm flex items-center gap-1.5"
          >
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
                    value={formMapel}
                    onChange={e => { setFormMapel(e.target.value); setFormKelas('') }}
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
                    value={formKelas}
                    onChange={e => setFormKelas(e.target.value)}
                    className="input-field appearance-none pr-9 cursor-pointer disabled:opacity-50"
                    disabled={!formMapel}
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

  // ── DETAIL KELAS ──────────────────────────────────────────────────────────
  if (view === 'kelas-detail' && selectedKelas) {
    const milikSendiri = kisiDiKelas.filter(k => k.is_mine)
    const milikRekan = kisiDiKelas.filter(k => !k.is_mine)

    return (
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <button onClick={backToCards} className="btn-ghost btn-sm flex items-center gap-1.5">
            <X className="w-4 h-4" /> Kembali
          </button>
          <div className="flex-1">
            <h1 className="text-xl font-bold text-slate-800 flex items-center gap-2">
              <GraduationCap className="w-5 h-5 text-emerald-600" />
              {selectedKelas}
            </h1>
            <p className="text-sm text-slate-500 mt-0.5">
              {kisiDiKelas.length} kisi-kisi tersedia
            </p>
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

        <div className="space-y-6">
          {milikSendiri.length > 0 && (
            <section>
              <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-3">Kisi-kisi Saya</h2>
              <div className="space-y-2">
                {milikSendiri.map(k => (
                  <KisiKisiRow
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
                  <KisiKisiRow
                    key={k.id}
                    item={k}
                    onPreview={() => openPreview(k)}
                    canEdit={false}
                  />
                ))}
              </div>
            </section>
          )}

          {kisiDiKelas.length === 0 && (
            <div className="card p-12 text-center">
              <FileText className="w-10 h-10 text-slate-300 mx-auto mb-3" />
              <p className="text-slate-500 font-medium">Belum ada kisi-kisi untuk kelas ini</p>
              <button onClick={openBuat} className="btn-primary inline-flex items-center gap-2 mt-4">
                <Plus className="w-4 h-4" /> Buat Kisi-kisi
              </button>
            </div>
          )}
        </div>
      </div>
    )
  }

  // ── KARTU KELAS (TAMPILAN UTAMA) ──────────────────────────────────────────
  return (
    <div className="max-w-4xl mx-auto">
      {/* Header */}
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
          <p className="text-slate-400 text-sm mt-1 mb-4">Klik &quot;Buat Kisi-kisi&quot; untuk membuat yang pertama</p>
          <button onClick={openBuat} className="btn-primary inline-flex items-center gap-2">
            <Plus className="w-4 h-4" /> Buat Kisi-kisi
          </button>
        </div>
      ) : (
        <>
          {/* Info ringkas */}
          <div className="flex items-center gap-2 mb-5 p-3 rounded-xl bg-slate-50 border border-slate-200 text-sm text-slate-500">
            <BookOpen className="w-4 h-4 text-emerald-500 flex-shrink-0" />
            <span>
              Terdapat <strong className="text-slate-700">{kisiList.length} kisi-kisi</strong> dari{' '}
              <strong className="text-slate-700">{kelasEntries.length} kelas</strong>.{' '}
              Pilih kartu kelas untuk melihat detailnya.
            </span>
          </div>

          {/* Grid kartu kelas */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {kelasEntries.map(([kelasId, group], idx) => {
              const color = CARD_COLORS[idx % CARD_COLORS.length]
              const jumlahSaya = group.items.filter(k => k.is_mine).length
              const jumlahRekan = group.items.filter(k => !k.is_mine).length
              const adaTerkirim = group.items.some(k => k.status === 'TERKIRIM')
              const adaDraft = group.items.some(k => k.status === 'DRAFT')

              return (
                <button
                  key={kelasId}
                  onClick={() => openKelasDetail(group.namaKelas)}
                  className="group text-left rounded-2xl overflow-hidden shadow-card hover:shadow-card-md transition-all duration-200 hover:-translate-y-0.5 active:scale-[0.98] focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2"
                >
                  {/* Bagian atas berwarna */}
                  <div className={`bg-gradient-to-br ${color.bg} p-5 relative overflow-hidden`}>
                    {/* Dekorasi lingkaran */}
                    <div className="absolute -top-6 -right-6 w-24 h-24 rounded-full bg-white/10" />
                    <div className="absolute -bottom-4 -left-4 w-16 h-16 rounded-full bg-white/10" />

                    <div className="relative flex items-start justify-between">
                      <div>
                        <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center mb-3">
                          <GraduationCap className="w-5 h-5 text-white" />
                        </div>
                        <p className="text-white/70 text-xs font-medium uppercase tracking-wider">Kelas</p>
                        <h3 className="text-white font-bold text-lg leading-tight mt-0.5">
                          {group.namaKelas}
                        </h3>
                      </div>
                      <div className="bg-white/20 rounded-full w-8 h-8 flex items-center justify-center group-hover:bg-white/30 transition-colors mt-1">
                        <ChevronRight className="w-4 h-4 text-white" />
                      </div>
                    </div>

                    {/* Badge status */}
                    <div className="relative flex gap-1.5 mt-4 flex-wrap">
                      {adaTerkirim && (
                        <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-white/25 text-white">
                          ✓ Ada Terkirim
                        </span>
                      )}
                      {adaDraft && (
                        <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-white/20 text-white/80">
                          ✎ Ada Draft
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Bagian bawah putih */}
                  <div className="bg-white border border-t-0 border-slate-100 p-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-2xl font-bold text-slate-800">{group.items.length}</p>
                        <p className="text-xs text-slate-400 mt-0.5">
                          kisi-kisi tersedia
                        </p>
                      </div>
                      <div className="text-right space-y-0.5">
                        {jumlahSaya > 0 && (
                          <p className="text-xs text-slate-500">
                            <span className="font-semibold text-slate-700">{jumlahSaya}</span> milik saya
                          </p>
                        )}
                        {jumlahRekan > 0 && (
                          <p className="text-xs text-slate-400">
                            <span className="font-semibold text-slate-600">{jumlahRekan}</span> dari rekan
                          </p>
                        )}
                      </div>
                    </div>

                    <div className="mt-3 pt-3 border-t border-slate-100 flex items-center gap-1.5 text-xs font-medium text-slate-500 group-hover:text-emerald-600 transition-colors">
                      <Eye className="w-3.5 h-3.5" />
                      Klik untuk lihat kisi-kisi
                    </div>
                  </div>
                </button>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}

// Row item dalam tampilan detail kelas
function KisiKisiRow({
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
