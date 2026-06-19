'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { Plus, Send, RotateCcw, ChevronDown, ChevronUp, Trash2, ImagePlus, X, ArrowLeft, CheckCircle2, Pencil, Eye, Lock } from 'lucide-react'
import { Modal, Confirm, StatusBadge, EmptyState, Spinner, Toast } from '@/components/ui'
import { apiRequest, formatDateTime } from '@/lib/utils'
import { PaketSoal, Mapel, Kelas, Soal } from '@/types'

interface SoalWithImg extends Soal {
  gambar_pertanyaan?: string
  gambar_opsi_a?: string
  gambar_opsi_b?: string
  gambar_opsi_c?: string
  gambar_opsi_d?: string
  gambar_opsi_e?: string
}

type Step = 'list' | 'setup' | 'buat'

const opsiLabels = ['A', 'B', 'C', 'D', 'E']

function ImageUploadButton({ label, url, onUrl, uploadKey, uploading, onTrigger }: {
  label: string; url: string; onUrl: (u: string) => void
  uploadKey: string; uploading: string | null; onTrigger: (key: string) => void
}) {
  return url ? (
    <div className="relative inline-block">
      <img src={url} alt={label} className="max-h-24 rounded-lg border border-slate-200" />
      <button type="button" onClick={() => onUrl('')}
        className="absolute -top-1.5 -right-1.5 bg-red-500 text-white rounded-full w-5 h-5 flex items-center justify-center">
        <X className="w-3 h-3" />
      </button>
    </div>
  ) : (
    <button type="button" onClick={() => onTrigger(uploadKey)}
      className="btn-secondary btn-sm text-xs" disabled={!!uploading}>
      {uploading === uploadKey ? <Spinner size="sm" /> : <><ImagePlus className="w-3.5 h-3.5" /> {label}</>}
    </button>
  )
}

export default function GuruBuatSoalPage() {
  const [pakets, setPakets] = useState<PaketSoal[]>([])
  const [guruMapelList, setGuruMapelList] = useState<Mapel[]>([])
  const [allMapelList, setAllMapelList] = useState<Mapel[]>([])
  const [allKelasList, setAllKelasList] = useState<Kelas[]>([])
  const [loading, setLoading] = useState(true)
  const [step, setStep] = useState<Step>('list')
  const [activePaket, setActivePaket] = useState<PaketSoal | null>(null)
  const [soalDibuat, setSoalDibuat] = useState<SoalWithImg[]>([])
  const [kirimId, setKirimId] = useState<string | null>(null)
  const [tarikId, setTarikId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [soalExpand, setSoalExpand] = useState<Record<string, SoalWithImg[]>>({})
  const [loadingSoal, setLoadingSoal] = useState(false)

  // Edit soal inline state
  const [editSoal, setEditSoal] = useState<SoalWithImg | null>(null)
  const [editJumlahOpsi, setEditJumlahOpsi] = useState(4)
  const [editImgPertanyaan, setEditImgPertanyaan] = useState('')
  const [editImgOpsi, setEditImgOpsi] = useState<Record<string, string>>({})
  const [deleteSoalId, setDeleteSoalId] = useState<string | null>(null)
  const [deleteSoalPaketId, setDeleteSoalPaketId] = useState<string | null>(null)
  const [viewSoal, setViewSoal] = useState<SoalWithImg | null>(null)
  const [hapusPaketId, setHapusPaketId] = useState<string | null>(null)

  // Setup state
  const [setupMapel, setSetupMapel] = useState('')
  const [setupKelas, setSetupKelas] = useState('')
  const [setupAcak, setSetupAcak] = useState('YA')

  // Soal form state
  const [jumlahOpsi, setJumlahOpsi] = useState(4)
  const [imgPertanyaan, setImgPertanyaan] = useState('')
  const [imgOpsi, setImgOpsi] = useState<Record<string, string>>({})
  const [uploadingImg, setUploadingImg] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const editFileInputRef = useRef<HTMLInputElement>(null)
  const [pendingUploadKey, setPendingUploadKey] = useState<string | null>(null)
  const [pendingEditUploadKey, setPendingEditUploadKey] = useState<string | null>(null)
  const formRef = useRef<HTMLFormElement>(null)

  const showToast = (msg: string, type: 'success' | 'error' = 'success') => setToast({ msg, type })

  const SYNC_EVENT = 'guru-paket-updated'

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await apiRequest<{ data: PaketSoal[] }>('/api/guru/paket')
      setPakets(res.data)
    } finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  // Sinkronisasi dengan menu Bank Soal
  useEffect(() => {
    const handler = () => load()
    window.addEventListener(SYNC_EVENT, handler)
    return () => window.removeEventListener(SYNC_EVENT, handler)
  }, [load])

  useEffect(() => {
    const user = localStorage.getItem('user')
    const guruId = user ? JSON.parse(user).username : ''
    Promise.all([
      apiRequest<{ data: Mapel[] }>(`/api/admin/mapel?guru_id=${guruId}`),
      apiRequest<{ data: Mapel[] }>('/api/admin/mapel'),
      apiRequest<{ data: Kelas[] }>('/api/admin/kelas'),
    ]).then(([m, allM, k]) => {
      setGuruMapelList(m.data ?? [])
      setAllMapelList(allM.data ?? [])
      setAllKelasList(k.data ?? [])
    })
  }, [])

  const kelasUntukMapel: Kelas[] = (() => {
    if (!setupMapel) return []
    const mapel = guruMapelList.find(m => m.id === setupMapel)
    if (!mapel?.kelas_list) return []
    const kelasIds = mapel.kelas_list.split(',').map(s => s.trim()).filter(Boolean)
    return allKelasList.filter(k => kelasIds.includes(k.id))
  })()

  useEffect(() => { setSetupKelas('') }, [setupMapel])

  function resetSoalForm() {
    formRef.current?.reset()
    setJumlahOpsi(4)
    setImgPertanyaan('')
    setImgOpsi({})
  }

  // ── Load soal untuk paket tertentu (dipakai di expand dan saat masuk step buat) ──
  async function loadSoalPaket(paketId: string) {
    setLoadingSoal(true)
    try {
      const res = await apiRequest<{ data: SoalWithImg[] }>(`/api/guru/paket/${paketId}/soal`)
      setSoalExpand(prev => ({ ...prev, [paketId]: res.data }))
      return res.data
    } catch {
      setSoalExpand(prev => ({ ...prev, [paketId]: [] }))
      return []
    } finally { setLoadingSoal(false) }
  }

  async function startBuatSoal() {
    if (!setupMapel || !setupKelas) {
      showToast('Pilih mata pelajaran dan kelas terlebih dahulu', 'error')
      return
    }
    setSaving(true)
    try {
      await apiRequest<{ id?: string; message: string }>('/api/guru/paket', {
        method: 'POST',
        body: JSON.stringify({ mapel_id: setupMapel, kelas_id: setupKelas, acak: setupAcak }),
      })
      const listRes = await apiRequest<{ data: PaketSoal[] }>('/api/guru/paket')
      setPakets(listRes.data)
      const newPaket = listRes.data[0]
      if (newPaket) {
        setActivePaket(newPaket)
        setSoalDibuat([])
        setStep('buat')
        resetSoalForm()
      }
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Gagal membuat paket', 'error')
    } finally { setSaving(false) }
  }

  // ── Lanjutkan paket yang sudah ada: load soal yg sudah ada dari DB ──
  async function lanjutkanPaket(p: PaketSoal) {
    setActivePaket(p)
    setSoalDibuat([])
    resetSoalForm()
    // Load dulu soal yang sudah ada, BARU pindah ke step buat
    // agar soalDibuat.length sudah benar saat pertama render
    const existing = await loadSoalPaket(p.id)
    setSoalDibuat(existing)
    setStep('buat')
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file || !pendingUploadKey) return
    setUploadingImg(pendingUploadKey)
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
      if (pendingUploadKey === 'pertanyaan') setImgPertanyaan(data.url)
      else setImgOpsi(prev => ({ ...prev, [pendingUploadKey]: data.url }))
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Upload gambar gagal', 'error')
    } finally { setUploadingImg(null); e.target.value = '' }
  }

  async function handleEditFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file || !pendingEditUploadKey) return
    setUploadingImg(`edit_${pendingEditUploadKey}`)
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
      if (pendingEditUploadKey === 'pertanyaan') setEditImgPertanyaan(data.url)
      else setEditImgOpsi(prev => ({ ...prev, [pendingEditUploadKey]: data.url }))
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Upload gambar gagal', 'error')
    } finally { setUploadingImg(null); e.target.value = '' }
  }

  function triggerUpload(key: string) {
    setPendingUploadKey(key)
    setTimeout(() => fileInputRef.current?.click(), 50)
  }

  function triggerEditUpload(key: string) {
    setPendingEditUploadKey(key)
    setTimeout(() => editFileInputRef.current?.click(), 50)
  }

  async function handleTambahSoal(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!activePaket) return
    const fd = new FormData(e.currentTarget)
    const payload: Record<string, unknown> = Object.fromEntries(fd.entries())
    payload.jumlah_opsi = String(jumlahOpsi)
    payload.mapel_id = activePaket.mapel_id
    payload.kelas_id = activePaket.kelas_id
    payload.paket_id = activePaket.id
    payload.gambar_pertanyaan = imgPertanyaan || null
    for (const l of ['a','b','c','d','e']) {
      payload[`gambar_opsi_${l}`] = imgOpsi[l] || null
    }
    setSaving(true)
    try {
      await apiRequest('/api/guru/soal', { method: 'POST', body: JSON.stringify(payload) })
      const newSoal = { ...payload, id: '' } as SoalWithImg
      setSoalDibuat(prev => [...prev, newSoal])
      showToast(`Soal ke-${soalDibuat.length + 1} berhasil ditambahkan`)
      resetSoalForm()

      // Refresh paket list agar jumlah_soal terupdate
      const listRes = await apiRequest<{ data: PaketSoal[] }>('/api/guru/paket')
      setPakets(listRes.data)
      const updated = listRes.data.find(p => p.id === activePaket.id)
      if (updated) setActivePaket(updated)
      window.dispatchEvent(new Event(SYNC_EVENT))
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Gagal menyimpan soal', 'error')
    } finally { setSaving(false) }
  }

  function selesaiBuat() {
    setStep('list')
    setActivePaket(null)
    setSoalDibuat([])
    load()
  }

  async function handleKirim() {
    if (!kirimId) return
    setSaving(true)
    try {
      await apiRequest(`/api/guru/paket/${kirimId}/kirim`, { method: 'POST' })
      showToast('Paket berhasil dikirim untuk validasi')
      setKirimId(null)
      load()
      window.dispatchEvent(new Event(SYNC_EVENT))
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Gagal mengirim', 'error')
    } finally { setSaving(false) }
  }

  async function handleTarik() {
    if (!tarikId) return
    setSaving(true)
    try {
      await apiRequest(`/api/guru/paket/${tarikId}/tarik`, { method: 'POST' })
      showToast('Paket berhasil ditarik kembali ke DRAFT')
      setTarikId(null)
      load()
      window.dispatchEvent(new Event(SYNC_EVENT))
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Gagal menarik', 'error')
    } finally { setSaving(false) }
  }

  // ── Edit soal dari expand list ──
  function openEditSoal(s: SoalWithImg) {
    setEditSoal(s)
    setEditJumlahOpsi(s.jumlah_opsi || 4)
    const sr = s as unknown as Record<string, string>
    setEditImgPertanyaan(s.gambar_pertanyaan || sr.gambar_url || '')
    const opsiImgs: Record<string, string> = {}
    for (const l of ['a','b','c','d','e']) {
      const v = sr[`gambar_opsi_${l}`] || sr[`gambar_${l}`]
      if (v) opsiImgs[l] = v
    }
    setEditImgOpsi(opsiImgs)
  }

  async function handleSaveEditSoal(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!editSoal?.id) return
    const fd = new FormData(e.currentTarget)
    const payload: Record<string, unknown> = Object.fromEntries(fd.entries())
    payload.jumlah_opsi = String(editJumlahOpsi)
    payload.gambar_pertanyaan = editImgPertanyaan || null
    for (const l of ['a','b','c','d','e']) {
      payload[`gambar_opsi_${l}`] = editImgOpsi[l] || null
    }
    setSaving(true)
    try {
      await apiRequest(`/api/guru/soal/${editSoal.id}`, { method: 'PUT', body: JSON.stringify(payload) })
      showToast('Soal berhasil diperbarui')
      setEditSoal(null)
      // Refresh expand list untuk paket ini
      if (editSoal.paket_id) await loadSoalPaket(editSoal.paket_id as string)
      // Refresh juga jika sedang di step buat
      if (activePaket) {
        const existing = await loadSoalPaket(activePaket.id)
        setSoalDibuat(existing)
      }
      window.dispatchEvent(new Event(SYNC_EVENT))
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Gagal menyimpan', 'error')
    } finally { setSaving(false) }
  }

  async function handleDeleteSoal() {
    if (!deleteSoalId || !deleteSoalPaketId) return
    setSaving(true)
    try {
      await apiRequest(`/api/guru/soal/${deleteSoalId}`, { method: 'DELETE' })
      showToast('Soal berhasil dihapus')
      setDeleteSoalId(null)
      await loadSoalPaket(deleteSoalPaketId)
      // Refresh paket list agar jumlah_soal terupdate
      const listRes = await apiRequest<{ data: PaketSoal[] }>('/api/guru/paket')
      setPakets(listRes.data)
      // Refresh juga soalDibuat jika sedang di step buat
      if (activePaket?.id === deleteSoalPaketId) {
        const existing = soalExpand[deleteSoalPaketId] ?? []
        setSoalDibuat(existing)
        const updated = listRes.data.find(p => p.id === activePaket.id)
        if (updated) setActivePaket(updated)
      }
      setDeleteSoalPaketId(null)
      window.dispatchEvent(new Event(SYNC_EVENT))
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Gagal menghapus', 'error')
    } finally { setSaving(false) }
  }

  async function handleHapusPaket() {
    if (!hapusPaketId) return
    setSaving(true)
    try {
      await apiRequest(`/api/guru/paket/${hapusPaketId}`, { method: 'DELETE' })
      showToast('Paket soal berhasil dihapus')
      setHapusPaketId(null)
      load()
      window.dispatchEvent(new Event(SYNC_EVENT))
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Gagal menghapus paket', 'error')
    } finally { setSaving(false) }
  }

  const getNamaMapel = (id: string) => guruMapelList.find(m => m.id === id)?.nama ?? allMapelList.find(m => m.id === id)?.nama ?? id
  const getNamaKelas = (id: string) => allKelasList.find(k => k.id === id)?.nama ?? id
  const isEditable = (status: string) => ['DRAFT', 'DITOLAK'].includes(status)

  // ── Render daftar soal (dipakai di expand list dan di step buat) ──
  function renderSoalList(soalList: SoalWithImg[], paketStatus: string, paketId: string) {
    if (soalList.length === 0) {
      return <p className="text-xs text-slate-400 text-center py-2">Belum ada soal dalam paket ini</p>
    }
    return soalList.map((s, i) => (
      <div key={s.id || i} className="flex items-start gap-2 text-sm text-slate-700 bg-white rounded-lg px-3 py-2 border border-slate-100">
        <span className="w-5 h-5 rounded-full bg-brand-100 text-brand-700 font-bold text-xs flex items-center justify-center flex-shrink-0 mt-0.5">{i+1}</span>
        <div className="flex-1 min-w-0">
          <p className="line-clamp-2">{s.teks}</p>
          {(s.gambar_pertanyaan || (s as unknown as Record<string,string>).gambar_url) && (
            <span className="text-xs text-brand-500">📷 Ada gambar</span>
          )}
        </div>
        <span className="text-xs text-slate-400 flex-shrink-0">Kunci: {s.kunci}</span>
        <div className="flex items-center gap-1 flex-shrink-0">
          {isEditable(s.status ?? paketStatus) && s.id ? (
            <>
              <button
                onClick={() => openEditSoal(s)}
                className="btn-ghost btn-icon btn-sm text-blue-600 hover:bg-blue-50"
                title="Edit soal"
              >
                <Pencil className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => { setDeleteSoalId(s.id); setDeleteSoalPaketId(paketId) }}
                className="btn-ghost btn-icon btn-sm text-red-600 hover:bg-red-50"
                title="Hapus soal"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </>
          ) : s.id ? (
            <>
              <button onClick={() => setViewSoal(s)} className="btn-ghost btn-icon btn-sm text-slate-500 hover:bg-slate-100" title="Lihat soal">
                <Eye className="w-3.5 h-3.5" />
              </button>
              <span title="Soal tidak bisa diedit" className="btn-ghost btn-icon btn-sm text-slate-300 cursor-not-allowed">
                <Lock className="w-3.5 h-3.5" />
              </span>
            </>
          ) : null}
        </div>
      </div>
    ))
  }

  // ── STEP: BUAT SOAL ──────────────────────────────────────────────
  if (step === 'buat' && activePaket) {
    const namaMapel = activePaket.nama_mapel ?? getNamaMapel(activePaket.mapel_id)
    const namaKelas = activePaket.nama_kelas ?? getNamaKelas(activePaket.kelas_id)
    return (
      <div className="space-y-6 animate-fade-in">
        {toast && <Toast message={toast.msg} type={toast.type} onClose={() => setToast(null)} />}
        <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleFileChange} />
        <input ref={editFileInputRef} type="file" accept="image/*" className="hidden" onChange={handleEditFileChange} />

        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <button onClick={selesaiBuat} className="btn-ghost btn-sm text-slate-500">
                <ArrowLeft className="w-4 h-4" /> Kembali
              </button>
            </div>
            <h1 className="page-title">Buat Soal</h1>
            <p className="page-subtitle">
              {namaMapel} · Kelas {namaKelas} · {activePaket.acak === 'YA' ? 'Soal diacak' : 'Urutan tetap'} · {soalDibuat.length} soal ditambahkan
            </p>
          </div>
          <button onClick={selesaiBuat} className="btn-secondary btn-sm">
            <CheckCircle2 className="w-4 h-4" /> Selesai Membuat Soal
          </button>
        </div>

        {/* Form tambah soal baru */}
        <div className="card">
          <div className="flex items-center gap-2 mb-4">
            <span className="w-8 h-8 rounded-full bg-brand-600 text-white font-bold text-sm flex items-center justify-center flex-shrink-0">
              {soalDibuat.length + 1}
            </span>
            <h2 className="font-semibold text-slate-800">Soal ke-{soalDibuat.length + 1}</h2>
          </div>

          <form ref={formRef} id="soal-buat-form" onSubmit={handleTambahSoal} className="space-y-4">
            <div>
              <label className="label">Teks Pertanyaan *</label>
              <textarea name="teks" className="textarea" rows={3} required placeholder="Tulis pertanyaan di sini..." />
              <div className="mt-2">
                <ImageUploadButton label="Tambah Gambar Pertanyaan" url={imgPertanyaan}
                  onUrl={setImgPertanyaan} uploadKey="pertanyaan" uploading={uploadingImg} onTrigger={triggerUpload} />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
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
                <select name="tingkat" className="select" defaultValue="Sedang">
                  <option>Mudah</option>
                  <option>Sedang</option>
                  <option>Sulit</option>
                </select>
              </div>
              <div>
                <label className="label">Kunci Jawaban *</label>
                <select name="kunci" className="select" required defaultValue="A">
                  {opsiLabels.slice(0, jumlahOpsi).map(l => <option key={l} value={l}>{l}</option>)}
                </select>
              </div>
            </div>

            <div className="space-y-2">
              <label className="label">Pilihan Jawaban</label>
              {opsiLabels.slice(0, jumlahOpsi).map(label => {
                const lk = label.toLowerCase()
                return (
                  <div key={label} className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="w-7 h-7 rounded-lg bg-slate-100 text-slate-600 font-bold text-xs flex items-center justify-center flex-shrink-0">{label}</span>
                      <input name={`opsi_${lk}`} className="input" placeholder={`Opsi ${label}`} required />
                      <button type="button" onClick={() => triggerUpload(lk)} title={`Gambar opsi ${label}`}
                        className="btn-ghost btn-icon btn-sm text-slate-500 flex-shrink-0" disabled={!!uploadingImg}>
                        {uploadingImg === lk ? <Spinner size="sm" /> : <ImagePlus className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                    {imgOpsi[lk] && (
                      <div className="ml-9 relative inline-block">
                        <img src={imgOpsi[lk]} alt={`Gambar opsi ${label}`} className="max-h-20 rounded border border-slate-200" />
                        <button type="button" onClick={() => setImgOpsi(prev => { const n = {...prev}; delete n[lk]; return n })}
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
              <textarea name="pembahasan" className="textarea" rows={2} placeholder="Penjelasan jawaban yang benar..." />
            </div>

            <div className="flex gap-3 pt-2 flex-wrap">
              <button type="submit" className="btn-primary" disabled={saving || !!uploadingImg}>
                {saving ? <Spinner size="sm" /> : <><Plus className="w-4 h-4" /> Tambah & Lanjut ke Soal Berikutnya</>}
              </button>
              <button type="button" onClick={selesaiBuat} className="btn-secondary">
                Selesai ({soalDibuat.length} soal)
              </button>
            </div>
          </form>
        </div>

        {/* Daftar soal yang sudah dibuat (dengan tombol edit/hapus) */}
        {soalDibuat.length > 0 && (
          <div className="card">
            <p className="text-sm font-medium text-slate-600 mb-3">Soal yang sudah dibuat ({soalDibuat.length})</p>
            <div className="space-y-2">
              {renderSoalList(soalDibuat, activePaket.status, activePaket.id)}
            </div>
          </div>
        )}

        {/* Modal Edit Soal */}
        <Modal open={!!editSoal} onClose={() => setEditSoal(null)} title="Edit Soal" size="xl"
          footer={
            <>
              <button onClick={() => setEditSoal(null)} className="btn-secondary" disabled={saving}>Batal</button>
              <button form="soal-edit-inline-form" type="submit" className="btn-primary" disabled={saving || uploadingImg?.startsWith('edit_')}>
                {saving ? <Spinner size="sm" /> : 'Simpan Perubahan'}
              </button>
            </>
          }
        >
          {editSoal && renderEditForm('soal-edit-inline-form')}
        </Modal>

        <Confirm open={!!deleteSoalId} onClose={() => { setDeleteSoalId(null); setDeleteSoalPaketId(null) }}
          onConfirm={handleDeleteSoal} title="Hapus Soal"
          message="Soal ini akan dihapus permanen. Lanjutkan?"
          confirmLabel="Ya, Hapus" loading={saving} />
      </div>
    )
  }

  // ── STEP: SETUP ──────────────────────────────────────────────────
  if (step === 'setup') {
    return (
      <div className="space-y-6 animate-fade-in">
        {toast && <Toast message={toast.msg} type={toast.type} onClose={() => setToast(null)} />}

        <div>
          <button onClick={() => setStep('list')} className="btn-ghost btn-sm text-slate-500 mb-2">
            <ArrowLeft className="w-4 h-4" /> Kembali
          </button>
          <h1 className="page-title">Buat Soal Baru</h1>
          <p className="page-subtitle">Atur mata pelajaran, kelas, dan pengacakan soal terlebih dahulu</p>
        </div>

        <div className="card max-w-lg">
          <div className="space-y-4">
            <div>
              <label className="label">Mata Pelajaran *</label>
              <select className="select" value={setupMapel} onChange={e => setSetupMapel(e.target.value)} required>
                <option value="">Pilih Mata Pelajaran</option>
                {guruMapelList.map(m => <option key={m.id} value={m.id}>{m.nama}</option>)}
              </select>
              {guruMapelList.length === 0 && (
                <p className="text-xs text-amber-600 mt-1">Belum ada mata pelajaran yang diampu. Hubungi admin.</p>
              )}
            </div>
            <div>
              <label className="label">Kelas *</label>
              <select className="select" value={setupKelas} onChange={e => setSetupKelas(e.target.value)} required disabled={!setupMapel}>
                <option value="">{setupMapel ? 'Pilih Kelas' : 'Pilih mapel dulu'}</option>
                {kelasUntukMapel.map(k => <option key={k.id} value={k.id}>{k.nama}</option>)}
              </select>
              {setupMapel && kelasUntukMapel.length === 0 && (
                <p className="text-xs text-amber-600 mt-1">Tidak ada kelas yang terdaftar untuk mapel ini. Hubungi admin.</p>
              )}
            </div>
            <div>
              <label className="label">Acak Urutan Soal</label>
              <select className="select" value={setupAcak} onChange={e => setSetupAcak(e.target.value)}>
                <option value="YA">Ya — urutan soal diacak untuk setiap siswa</option>
                <option value="TIDAK">Tidak — urutan soal tetap sesuai input</option>
              </select>
            </div>
            <div className="alert-info text-xs">
              Pengaturan ini hanya perlu diisi sekali. Setelah itu Anda bisa langsung membuat soal satu per satu.
            </div>
            <div className="flex gap-3 pt-2">
              <button onClick={startBuatSoal} className="btn-primary" disabled={saving || !setupMapel || !setupKelas}>
                {saving ? <Spinner size="sm" /> : 'Lanjut Buat Soal →'}
              </button>
              <button onClick={() => setStep('list')} className="btn-secondary">Batal</button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  // ── STEP: LIST ───────────────────────────────────────────────────
  return (
    <div className="space-y-6 animate-fade-in">
      {toast && <Toast message={toast.msg} type={toast.type} onClose={() => setToast(null)} />}
      <input ref={editFileInputRef} type="file" accept="image/*" className="hidden" onChange={handleEditFileChange} />

      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="page-title">Buat Soal</h1>
          <p className="page-subtitle">Kelola soal yang telah dibuat dan kirim ke admin untuk disetujui</p>
        </div>
        <button onClick={() => setStep('setup')} className="btn-primary btn-sm">
          <Plus className="w-4 h-4" /> Buat Soal Baru
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-20"><Spinner size="lg" /></div>
      ) : pakets.length === 0 ? (
        <div className="card">
          <EmptyState message="Belum ada soal. Klik 'Buat Soal Baru' untuk mulai membuat soal." />
        </div>
      ) : (
        <div className="space-y-3">
          {pakets.map(p => (
            <div key={p.id} className="card p-0 overflow-hidden">
              <div className="flex items-center gap-4 p-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-slate-900">{p.nama_mapel ?? getNamaMapel(p.mapel_id)}</span>
                    <span className="text-slate-400 text-xs">·</span>
                    <span className="text-sm text-slate-600">Kelas {p.nama_kelas ?? getNamaKelas(p.kelas_id)}</span>
                    <StatusBadge status={p.status} />
                  </div>
                  <div className="text-xs text-slate-400 mt-1">
                    {p.jumlah_soal} soal · {p.acak === 'YA' ? 'Soal diacak' : 'Urutan tetap'} · {formatDateTime(p.tanggal)}
                  </div>
                  {p.catatan && (
                    <div className="mt-2 text-xs text-amber-700 bg-amber-50 rounded-lg px-3 py-2 border border-amber-100">
                      📝 Catatan Admin: {p.catatan}
                    </div>
                  )}
                  {p.status === 'DITOLAK' && (
                    <div className="mt-1 text-xs text-red-600">Soal ditolak — silakan edit soal lalu kirim ulang</div>
                  )}
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  {p.status === 'DRAFT' && (
                    <button onClick={() => lanjutkanPaket(p)} className="btn-secondary btn-sm">
                      <Plus className="w-3.5 h-3.5" /> Lanjutkan
                    </button>
                  )}
                  {(p.status === 'DRAFT' || p.status === 'DITOLAK') && (
                    <button onClick={() => setKirimId(p.id)} className="btn-primary btn-sm">
                      <Send className="w-3.5 h-3.5" /> {p.status === 'DITOLAK' ? 'Kirim Ulang' : 'Kirim'}
                    </button>
                  )}
                  {(p.status === 'DRAFT' || p.status === 'DITOLAK') && (
                    <button
                      onClick={() => setHapusPaketId(p.id)}
                      className="btn-ghost btn-icon btn-sm text-red-500 hover:bg-red-50"
                      title="Hapus paket soal"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                  {p.status === 'MENUNGGU' && (
                    <button onClick={() => setTarikId(p.id)} className="btn-secondary btn-sm">
                      <RotateCcw className="w-3.5 h-3.5" /> Tarik
                    </button>
                  )}
                  <button
                    onClick={async () => {
                      if (expandedId === p.id) {
                        setExpandedId(null)
                      } else {
                        setExpandedId(p.id)
                        await loadSoalPaket(p.id)
                      }
                    }}
                    className="btn-ghost btn-icon btn-sm"
                  >
                    {expandedId === p.id ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {expandedId === p.id && (
                <div className="border-t border-slate-100 p-4 bg-slate-50 space-y-2">
                  {loadingSoal ? (
                    <div className="flex justify-center py-4"><Spinner size="sm" /></div>
                  ) : (
                    renderSoalList(soalExpand[p.id] ?? [], p.status, p.id)
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Modal Edit Soal (dari list) */}
      <Modal open={!!editSoal} onClose={() => setEditSoal(null)} title="Edit Soal" size="xl"
        footer={
          <>
            <button onClick={() => setEditSoal(null)} className="btn-secondary" disabled={saving}>Batal</button>
            <button form="soal-edit-inline-form" type="submit" className="btn-primary" disabled={saving || uploadingImg?.startsWith('edit_')}>
              {saving ? <Spinner size="sm" /> : 'Simpan Perubahan'}
            </button>
          </>
        }
      >
        {editSoal && renderEditForm('soal-edit-inline-form')}
      </Modal>

      {/* Modal View (read-only) */}
      <Modal open={!!viewSoal} onClose={() => setViewSoal(null)} title="Detail Soal" size="xl">
        {viewSoal && (
          <div className="space-y-4">
            <div className="alert-info text-xs flex items-center gap-2">
              <Lock className="w-3.5 h-3.5 flex-shrink-0" />
              Soal ini sudah dikirim/disetujui dan tidak bisa diedit atau dihapus.
            </div>
            <div>
              <p className="label mb-1">Pertanyaan</p>
              <p className="text-sm text-slate-800 leading-relaxed">{viewSoal.teks}</p>
            </div>
            <div className="space-y-1.5">
              <p className="label mb-1">Pilihan Jawaban</p>
              {opsiLabels.slice(0, viewSoal.jumlah_opsi || 4).map(l => {
                const lk = l.toLowerCase()
                const opsiText = (viewSoal as unknown as Record<string,string>)[`opsi_${lk}`]
                const isKunci = viewSoal.kunci === l
                return (
                  <div key={l} className={`flex items-start gap-2 text-sm px-3 py-2 rounded-lg ${isKunci ? 'bg-emerald-50 text-emerald-800 font-medium' : 'text-slate-600'}`}>
                    <span className={`w-6 h-6 rounded flex items-center justify-center text-xs font-bold flex-shrink-0 ${isKunci ? 'bg-emerald-500 text-white' : 'bg-slate-100 text-slate-500'}`}>{l}</span>
                    <span>{opsiText}</span>
                    {isKunci && <span className="ml-auto text-emerald-600 text-xs">✓ Kunci</span>}
                  </div>
                )
              })}
            </div>
            {viewSoal.pembahasan && (
              <div>
                <p className="label mb-1">Pembahasan</p>
                <p className="text-sm text-slate-700">{viewSoal.pembahasan}</p>
              </div>
            )}
          </div>
        )}
      </Modal>

      <Confirm open={!!kirimId} onClose={() => setKirimId(null)} onConfirm={handleKirim}
        title="Kirim Soal untuk Validasi"
        message="Soal akan dikirim ke admin untuk divalidasi. Setelah dikirim, soal tidak bisa lagi diedit atau dihapus sampai disetujui atau ditolak. Lanjutkan?"
        confirmLabel="Ya, Kirim" variant="primary" loading={saving} />

      <Confirm open={!!tarikId} onClose={() => setTarikId(null)} onConfirm={handleTarik}
        title="Tarik Soal"
        message="Soal akan ditarik kembali ke status DRAFT dan bisa diedit. Lanjutkan?"
        confirmLabel="Ya, Tarik" variant="primary" loading={saving} />

      <Confirm open={!!deleteSoalId} onClose={() => { setDeleteSoalId(null); setDeleteSoalPaketId(null) }}
        onConfirm={handleDeleteSoal} title="Hapus Soal"
        message="Soal ini akan dihapus permanen. Lanjutkan?"
        confirmLabel="Ya, Hapus" loading={saving} />

      <Confirm open={!!hapusPaketId} onClose={() => setHapusPaketId(null)} onConfirm={handleHapusPaket}
        title="Hapus Paket Soal"
        message="Seluruh soal dalam paket ini akan ikut terhapus secara permanen. Tindakan ini tidak bisa dibatalkan. Lanjutkan?"
        confirmLabel="Ya, Hapus Paket" loading={saving} />
    </div>
  )

  // ── Form edit soal (shared antara step buat dan list) ──
  function renderEditForm(formId: string) {
    if (!editSoal) return null
    return (
      <form id={formId} onSubmit={handleSaveEditSoal} className="space-y-4">
        <div>
          <label className="label">Teks Pertanyaan *</label>
          <textarea name="teks" className="textarea" rows={3} required
            placeholder="Tulis pertanyaan di sini..."
            defaultValue={editSoal.teks ?? ''} />
          <div className="mt-2">
            {editImgPertanyaan ? (
              <div className="relative inline-block">
                <img src={editImgPertanyaan} alt="Gambar pertanyaan" className="max-h-32 rounded-lg border border-slate-200" />
                <button type="button" onClick={() => setEditImgPertanyaan('')}
                  className="absolute -top-1.5 -right-1.5 bg-red-500 text-white rounded-full w-5 h-5 flex items-center justify-center">
                  <X className="w-3 h-3" />
                </button>
              </div>
            ) : (
              <button type="button" onClick={() => triggerEditUpload('pertanyaan')}
                className="btn-secondary btn-sm text-xs" disabled={!!uploadingImg}>
                {uploadingImg === 'edit_pertanyaan' ? <Spinner size="sm" /> : <><ImagePlus className="w-3.5 h-3.5" /> Tambah Gambar</>}
              </button>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className="label">Jumlah Opsi</label>
            <select className="select" value={editJumlahOpsi} onChange={e => setEditJumlahOpsi(Number(e.target.value))}>
              <option value={3}>3 Opsi</option>
              <option value={4}>4 Opsi</option>
              <option value={5}>5 Opsi</option>
            </select>
          </div>
          <div>
            <label className="label">Tingkat Kesulitan</label>
            <select name="tingkat" className="select" defaultValue={editSoal.tingkat ?? 'Sedang'}>
              <option>Mudah</option>
              <option>Sedang</option>
              <option>Sulit</option>
            </select>
          </div>
          <div>
            <label className="label">Kunci Jawaban *</label>
            <select name="kunci" className="select" required defaultValue={editSoal.kunci ?? 'A'}>
              {opsiLabels.slice(0, editJumlahOpsi).map(l => <option key={l} value={l}>{l}</option>)}
            </select>
          </div>
        </div>

        <div className="space-y-2">
          <label className="label">Opsi Jawaban</label>
          {opsiLabels.slice(0, editJumlahOpsi).map(label => {
            const lk = label.toLowerCase()
            const defaultVal = (editSoal as unknown as Record<string,string>)[`opsi_${lk}`] ?? ''
            return (
              <div key={label} className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="w-7 h-7 rounded-lg bg-slate-100 text-slate-600 font-bold text-xs flex items-center justify-center flex-shrink-0">{label}</span>
                  <input name={`opsi_${lk}`} className="input" placeholder={`Opsi ${label}`} required defaultValue={defaultVal} />
                  <button type="button" onClick={() => triggerEditUpload(lk)}
                    className="btn-ghost btn-icon btn-sm text-slate-500 flex-shrink-0" disabled={!!uploadingImg}>
                    {uploadingImg === `edit_${lk}` ? <Spinner size="sm" /> : <ImagePlus className="w-3.5 h-3.5" />}
                  </button>
                </div>
                {editImgOpsi[lk] && (
                  <div className="ml-9 relative inline-block">
                    <img src={editImgOpsi[lk]} alt={`Gambar opsi ${label}`} className="max-h-20 rounded border border-slate-200" />
                    <button type="button" onClick={() => setEditImgOpsi(prev => { const n = {...prev}; delete n[lk]; return n })}
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
            defaultValue={editSoal.pembahasan ?? ''} />
        </div>
      </form>
    )
  }
}
