'use client'

import { useState, useEffect, useCallback } from 'react'
import { FileText, Plus, Send, Save, Edit2, Trash2, X, ChevronDown, Users, Clock, BookOpen, GraduationCap, Lock, Eye, Copy } from 'lucide-react'
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
  const [scopeWarning, setScopeWarning] = useState('')
  const [successMsg, setSuccessMsg] = useState('')

  // Form state
  const [formMapel, setFormMapel] = useState('')
  const [formKelas, setFormKelas] = useState('')
  const [konten, setKonten] = useState('')

  // Mode DUPLIKAT: isi dari kisi-kisi milik sendiri disalin ke satu atau
  // beberapa kelas lain (mapel yang sama). Null = bukan mode duplikat.
  const [duplikatDari, setDuplikatDari] = useState<KisiKisi | null>(null)
  const [kelasDipilih, setKelasDipilih] = useState<string[]>([])

  const kelasList = mapelAmpu.find(m => m.id === formMapel)?.kelas ?? []

  // Kelas yang MASIH BOLEH dipilih untuk sebuah mapel = kelas yang belum
  // punya kisi-kisi untuk mapel itu. (Database hanya mengizinkan satu
  // kisi-kisi per kombinasi mapel + kelas.)
  const kelasTersediaUntuk = (mapelId: string) =>
    (mapelAmpu.find(m => m.id === mapelId)?.kelas ?? []).filter(
      k => !kisiList.some(x => x.mapel_id === mapelId && x.kelas_id === k.id)
    )
  const kelasTersedia = kelasTersediaUntuk(formMapel)

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const [kisiRes, mapelRes] = await Promise.all([
        apiRequest<{ data: KisiKisi[]; scopeWarning?: string }>('/api/guru/kisi-kisi'),
        apiRequest<{ data: MapelAmpu[] }>('/api/guru/kisi-kisi/mapel-ampu'),
      ])
      setKisiList(kisiRes.data ?? [])
      setScopeWarning(kisiRes.scopeWarning ?? '')
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
    setDuplikatDari(null)
    setKelasDipilih([])
    setFormMapel('')
    setFormKelas('')
    setKonten('')
    setError('')
    setView('form')
  }

  // Duplikat: isi disalin dari kisi-kisi sumber (hanya milik sendiri, karena
  // isi milik rekan guru memang tidak dikirim ke browser).
  function openDuplikat(k: KisiKisi) {
    setEditing(null)
    setDuplikatDari(k)
    setKelasDipilih([])
    setFormMapel(k.mapel_id)
    setFormKelas('')
    setKonten(k.konten)
    setError('')
    setView('form')
  }

  function toggleKelasDipilih(id: string) {
    setKelasDipilih(prev => (prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]))
  }

  function openEdit(k: KisiKisi) {
    setDuplikatDari(null)
    setKelasDipilih([])
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
    setDuplikatDari(null)
    setKelasDipilih([])
    setError('')
  }

  function backToKelasDetail() {
    setPreview(null)
    setEditing(null)
    setDuplikatDari(null)
    setKelasDipilih([])
    setView('kelas-detail')
    setError('')
  }

  // Simpan hasil duplikat ke SEMUA kelas yang dicentang, satu per satu lewat
  // endpoint pembuatan biasa (aturan server tetap berlaku: kepemilikan
  // mapel-kelas dan larangan dobel). Kelas yang gagal dilaporkan, yang
  // berhasil tetap tersimpan.
  async function handleSaveDuplikat(status: 'DRAFT' | 'TERKIRIM') {
    if (!duplikatDari) return
    if (kelasDipilih.length === 0 || !konten.trim()) {
      setError('Pilih minimal satu kelas tujuan dan pastikan konten kisi-kisi tidak kosong')
      return
    }
    setSaving(true)
    setError('')
    const namaKelasDari = (id: string) => kelasList.find(k => k.id === id)?.nama ?? id
    const gagal: string[] = []
    let sukses = 0
    for (const kelasId of kelasDipilih) {
      try {
        await apiRequest('/api/guru/kisi-kisi', {
          method: 'POST',
          body: JSON.stringify({ mapel_id: formMapel, kelas_id: kelasId, konten, status }),
        })
        sukses++
      } catch (e: unknown) {
        gagal.push(`${namaKelasDari(kelasId)} (${e instanceof Error ? e.message : 'gagal'})`)
      }
    }
    await fetchData()
    setSaving(false)
    if (gagal.length === 0) {
      showSuccess(
        status === 'TERKIRIM'
          ? `Kisi-kisi diduplikat dan dikirim ke ${sukses} kelas`
          : `Kisi-kisi diduplikat ke ${sukses} kelas sebagai draft`
      )
      setDuplikatDari(null)
      setKelasDipilih([])
      setView(selectedKelas ? 'kelas-detail' : 'cards')
    } else {
      // Tetap di form: kelas yang sudah berhasil otomatis hilang dari daftar
      // pilihan karena kisi-kisinya sudah ada, sisanya bisa dicoba lagi.
      setKelasDipilih(prev => prev.filter(id => gagal.some(g => g.startsWith(namaKelasDari(id) + ' ('))))
      setError(`${sukses} kelas berhasil. Gagal: ${gagal.join('; ')}`)
    }
  }

  async function handleSave(status: 'DRAFT' | 'TERKIRIM') {
    if (duplikatDari) return handleSaveDuplikat(status)
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
            className="btn-back btn-sm flex items-center gap-1.5"
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
          <div className="mt-4 flex flex-wrap gap-2">
            <button onClick={() => openEdit(preview)} className="btn-secondary flex items-center gap-2">
              <Edit2 className="w-4 h-4" /> Edit Kisi-kisi
            </button>
            {kelasTersediaUntuk(preview.mapel_id).length > 0 && (
              <button onClick={() => openDuplikat(preview)} className="btn-secondary flex items-center gap-2">
                <Copy className="w-4 h-4" /> Duplikat ke Kelas Lain
              </button>
            )}
          </div>
        )}
      </div>
    )
  }

  // ── FORM ─────────────────────────────────────────────────────────────────
  if (view === 'form') {
    return (
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center gap-3 mb-3 lg:mb-4">
          <button
            onClick={selectedKelas ? backToKelasDetail : backToCards}
            className="btn-back btn-sm flex items-center gap-1.5"
          >
            <X className="w-4 h-4" /> Batal
          </button>
          <h1 className="text-lg font-bold text-slate-800">
            {editing ? 'Edit Kisi-kisi' : duplikatDari ? 'Duplikat Kisi-kisi' : 'Buat Kisi-kisi Baru'}
          </h1>
        </div>

        {error && (
          <div className="mb-4 p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm">{error}</div>
        )}

        <div className="card p-4 lg:p-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">Mata Pelajaran</label>
              {editing || duplikatDari ? (
                <div className="input-field bg-slate-50 text-slate-500 cursor-not-allowed select-none">
                  {editing ? editing.nama_mapel : duplikatDari?.nama_mapel}
                </div>
              ) : (
                <div className="relative">
                  <select
                    value={formMapel}
                    onChange={e => { setFormMapel(e.target.value); setFormKelas('') }}
                    className="input-field appearance-none pr-9 cursor-pointer"
                  >
                    <option value="">-- Pilih Mapel --</option>
                    {mapelAmpu.map(m => {
                      const habis = kelasTersediaUntuk(m.id).length === 0
                      return (
                        <option key={m.id} value={m.id} disabled={habis}>
                          {m.nama}{habis ? ' — semua kelas sudah ada kisi-kisi' : ''}
                        </option>
                      )
                    })}
                  </select>
                  <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
                </div>
              )}
              {!editing && mapelAmpu.length === 0 && !loading && (
                <p className="text-xs text-amber-600 mt-1">Tidak ada mapel yang diampu. Hubungi admin.</p>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">
                {duplikatDari ? 'Salin ke Kelas' : 'Kelas'}
              </label>
              {editing ? (
                <div className="input-field bg-slate-50 text-slate-500 cursor-not-allowed select-none">
                  {editing.nama_kelas}
                </div>
              ) : duplikatDari ? (
                <div className="input-field bg-slate-50 text-slate-500 select-none">
                  Dari: {duplikatDari.nama_kelas}
                </div>
              ) : (
                <div className="relative">
                  <select
                    value={formKelas}
                    onChange={e => setFormKelas(e.target.value)}
                    className="input-field appearance-none pr-9 cursor-pointer disabled:opacity-50"
                    disabled={!formMapel || kelasTersedia.length === 0}
                  >
                    <option value="">
                      {formMapel && kelasTersedia.length === 0 ? '-- Semua kelas sudah ada kisi-kisi --' : '-- Pilih Kelas --'}
                    </option>
                    {kelasTersedia.map(k => (
                      <option key={k.id} value={k.id}>{k.nama}</option>
                    ))}
                  </select>
                  <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
                </div>
              )}
              {!editing && !duplikatDari && formMapel && kelasTersedia.length === 0 && (
                <p className="text-xs text-amber-600 mt-1">
                  Semua kelas untuk mapel ini sudah punya kisi-kisi. Gunakan tombol Edit untuk mengubahnya.
                </p>
              )}
            </div>
          </div>

          {/* Mode duplikat: pilih satu atau banyak kelas tujuan. Hanya kelas
              yang BELUM punya kisi-kisi untuk mapel ini yang ditampilkan. */}
          {duplikatDari && (
            <div className="mb-4 rounded-xl border border-slate-200 bg-slate-50/60 p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <p className="text-sm font-medium text-slate-700">
                  Pilih kelas tujuan <span className="text-slate-400">({kelasDipilih.length} dipilih)</span>
                </p>
                {kelasTersedia.length > 1 && (
                  <button
                    type="button"
                    className="text-xs font-medium text-emerald-700 hover:underline"
                    onClick={() =>
                      setKelasDipilih(kelasDipilih.length === kelasTersedia.length ? [] : kelasTersedia.map(k => k.id))
                    }
                  >
                    {kelasDipilih.length === kelasTersedia.length ? 'Hapus semua pilihan' : 'Pilih semua'}
                  </button>
                )}
              </div>
              {kelasTersedia.length === 0 ? (
                <p className="text-xs text-amber-600">Tidak ada kelas lain yang belum punya kisi-kisi untuk mapel ini.</p>
              ) : (
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {kelasTersedia.map(k => (
                    <label
                      key={k.id}
                      className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors ${
                        kelasDipilih.includes(k.id)
                          ? 'border-emerald-400 bg-emerald-50 text-emerald-800'
                          : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300'
                      }`}
                    >
                      <input
                        type="checkbox"
                        className="h-4 w-4 accent-emerald-600"
                        checked={kelasDipilih.includes(k.id)}
                        onChange={() => toggleKelasDipilih(k.id)}
                      />
                      <span className="truncate">{k.nama}</span>
                    </label>
                  ))}
                </div>
              )}
              <p className="mt-2 text-[11px] text-slate-400">
                Isi di bawah boleh disesuaikan dulu sebelum disimpan; perubahan itu berlaku untuk semua kelas yang dipilih.
              </p>
            </div>
          )}

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
              className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent resize-y transition-shadow min-h-[200px] h-[calc(100vh-460px)] leading-relaxed"
              placeholder="Tulis kisi-kisi di sini..."
            />
            <p className="text-xs text-slate-400 mt-1">{konten.length} karakter</p>
          </div>
        </div>

        {/* Bar tombol menempel di bawah layar supaya selalu terlihat tanpa zoom out */}
        <div className="sticky bottom-0 z-20 -mx-2 px-2 pt-3 pb-3 mt-3 bg-white/90 backdrop-blur border-t border-slate-200 rounded-b-xl">
          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={() => handleSave('DRAFT')}
              disabled={saving || sudahAda || (!!duplikatDari && kelasDipilih.length === 0)}
              className="btn-secondary flex items-center gap-2 disabled:opacity-50"
            >
              <Save className="w-4 h-4" />
              {saving ? 'Menyimpan...' : 'Simpan Draft'}
            </button>
            <button
              onClick={() => handleSave('TERKIRIM')}
              disabled={saving || sudahAda || (!!duplikatDari && kelasDipilih.length === 0)}
              className="btn-primary flex items-center gap-2 disabled:opacity-50"
            >
              <Send className="w-4 h-4" />
              {saving ? 'Mengirim...' : duplikatDari && kelasDipilih.length > 1 ? `Kirim ke Siswa (${kelasDipilih.length} kelas)` : 'Kirim ke Siswa'}
            </button>
            <p className="text-xs text-slate-400 flex-1 min-w-[200px]">
              Draft hanya terlihat oleh rekan guru, belum tampil ke siswa.
            </p>
          </div>
        </div>
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
          <button onClick={backToCards} className="btn-back btn-sm flex items-center gap-1.5">
            <X className="w-4 h-4" /> Kembali
          </button>
          <div className="flex-1">
            <h1 className="text-xl font-bold text-slate-800 flex items-center gap-2 subheader-title">
              <GraduationCap className="w-5 h-5 text-emerald-600" />
              {selectedKelas}
            </h1>
            <p className="text-sm subheader-subtitle mt-0.5">
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
                    onDuplicate={kelasTersediaUntuk(k.mapel_id).length > 0 ? () => openDuplikat(k) : undefined}
                    canEdit
                  />
                ))}
              </div>
            </section>
          )}

          {milikRekan.length > 0 && (
            <section>
              <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-3">Kisi-kisi Rekan Guru</h2>
              <p className="-mt-2 mb-3 text-[11px] text-slate-400">Hanya menampilkan guru, mapel, dan status. Isi kisi-kisi hanya dapat dilihat oleh pemiliknya.</p>
              <div className="space-y-2">
                {milikRekan.map(k => (
                  <KisiKisiRow
                    key={k.id}
                    item={k}
                    onPreview={() => {}}
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
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-bold text-slate-800 flex items-center gap-2 subheader-title">
            <FileText className="w-5 h-5 text-emerald-600" /> Kisi-kisi
          </h1>
          <p className="text-sm subheader-subtitle mt-0.5">Kelola dan bagikan kisi-kisi ujian ke siswa</p>
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
      {scopeWarning && (
        <div className="mb-4 p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-700 text-sm">{scopeWarning}</div>
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
          <div className="flex items-center gap-2 mb-3 px-3 py-2 rounded-xl bg-slate-50 border border-slate-200 text-xs sm:text-sm text-slate-500">
            <BookOpen className="w-4 h-4 text-emerald-500 flex-shrink-0" />
            <span>
              Terdapat <strong className="text-slate-700">{kisiList.length} kisi-kisi</strong> dari{' '}
              <strong className="text-slate-700">{kelasEntries.length} kelas</strong>.{' '}
              Pilih kartu kelas untuk melihat detailnya.
            </span>
          </div>

          {/* Grid kartu kelas — kompak: nama kelas, jumlah kisi-kisi, nama guru.
              2 kolom di HP supaya puluhan kelas tidak perlu scroll panjang. */}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-3 lg:grid-cols-4">
            {kelasEntries.map(([kelasId, group], idx) => {
              const color = CARD_COLORS[idx % CARD_COLORS.length]
              const jumlahSaya = group.items.filter(k => k.is_mine).length

              // Nama guru unik; milik sendiri ditulis "Saya" dan diletakkan paling depan.
              const namaGuru = [...new Set(
                [...group.items].sort((x, y) => Number(y.is_mine) - Number(x.is_mine))
                  .map(k => (k.is_mine ? 'Saya' : k.nama_guru))
              )]
              const ringkasGuru = namaGuru.length > 2
                ? `${namaGuru.slice(0, 2).join(', ')} +${namaGuru.length - 2}`
                : namaGuru.join(', ')

              return (
                <button
                  key={kelasId}
                  onClick={() => openKelasDetail(group.namaKelas)}
                  title={`${group.namaKelas} · ${namaGuru.join(', ')}`}
                  className="group relative min-w-0 overflow-hidden rounded-xl border border-slate-100 bg-white p-2.5 pl-3.5 text-left shadow-card transition-all duration-150 hover:shadow-card-md active:scale-[0.97] focus:outline-none focus:ring-2 focus:ring-emerald-500"
                >
                  {/* Garis warna di sisi kiri */}
                  <span aria-hidden className={`absolute inset-y-0 left-0 w-1.5 bg-gradient-to-b ${color.bg}`} />

                  <div className="flex items-center justify-between gap-1.5">
                    <h3 className="min-w-0 truncate text-sm font-bold leading-tight text-slate-800">{group.namaKelas}</h3>
                    <span className={`flex-shrink-0 rounded-full px-1.5 py-0.5 text-[11px] font-bold tabular-nums ${color.light} ${color.text}`}>
                      {group.items.length}
                    </span>
                  </div>

                  <p className="mt-1 flex items-center gap-1 text-[11px] leading-tight text-slate-400">
                    <Users className="h-3 w-3 flex-shrink-0" />
                    <span className="truncate">{ringkasGuru}</span>
                  </p>
                  {jumlahSaya > 0 && (
                    <span className="sr-only">{jumlahSaya} milik saya</span>
                  )}
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
  item, onPreview, onEdit, onDelete, onDuplicate, canEdit,
}: {
  item: KisiKisi
  onPreview: () => void
  onEdit?: () => void
  onDelete?: () => void
  /** Kosong bila semua kelas untuk mapel ini sudah punya kisi-kisi. */
  onDuplicate?: () => void
  canEdit: boolean
}) {
  return (
    <div className="card p-3 flex items-center gap-3 hover:shadow-card-md transition-shadow">
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
        {canEdit ? (
          <button onClick={onPreview} className="btn-ghost btn-icon btn-sm" title="Lihat">
            <Eye className="w-4 h-4" />
          </button>
        ) : (
          <span className="p-2 text-slate-300" title="Isi kisi-kisi hanya dapat dilihat oleh guru pemiliknya">
            <Lock className="w-4 h-4" />
          </span>
        )}
        {canEdit && onEdit && (
          <button onClick={onEdit} className="btn-ghost btn-icon btn-sm" title="Edit">
            <Edit2 className="w-4 h-4" />
          </button>
        )}
        {canEdit && onDuplicate && (
          <button onClick={onDuplicate} className="btn-ghost btn-icon btn-sm" title="Duplikat ke kelas lain">
            <Copy className="w-4 h-4" />
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
