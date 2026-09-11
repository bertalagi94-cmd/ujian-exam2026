'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import {
  Plus, ChevronDown, ChevronUp, Trash2, ImagePlus, X, ArrowLeft, CheckCircle2, Pencil, Eye, Lock,
  ListChecks, PenSquare, Send, RotateCcw, Copy, Info, ChevronRight,
} from 'lucide-react'
import { Modal, Confirm, StatusBadge, EmptyState, Spinner, Toast, Badge } from '@/components/ui'
import { EssayFlowGuide } from '@/components/shared/EssayFlowGuide'
import { apiRequest, formatDateTime } from '@/lib/utils'
import { PaketSoal, Mapel, Kelas, Soal, PaketEssay, SoalEssay } from '@/types'

interface SoalWithImg extends Soal {
  gambar_pertanyaan?: string
  gambar_opsi_a?: string
  gambar_opsi_b?: string
  gambar_opsi_c?: string
  gambar_opsi_d?: string
  gambar_opsi_e?: string
}

type Step = 'list' | 'setup' | 'buat'
type EssayStep = 'list' | 'setup' | 'detail'
type Kind = 'choice' | 'pg' | 'essay' | 'info'

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

function PgSoalFlow({ onBack }: { onBack: () => void }) {
  const [pakets, setPakets] = useState<PaketSoal[]>([])
  const [guruMapelList, setGuruMapelList] = useState<Mapel[]>([])
  const [allMapelList, setAllMapelList] = useState<Mapel[]>([])
  const [allKelasList, setAllKelasList] = useState<Kelas[]>([])
  const [loading, setLoading] = useState(true)
  const [step, setStep] = useState<Step>('list')
  const [activePaket, setActivePaket] = useState<PaketSoal | null>(null)
  const [soalDibuat, setSoalDibuat] = useState<SoalWithImg[]>([])
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [soalExpand, setSoalExpand] = useState<Record<string, SoalWithImg[]>>({})
  const [loadingSoal, setLoadingSoal] = useState(false)

  // Edit soal inline state
  const [editSoal, setEditSoal] = useState<SoalWithImg | null>(null)
  const [editImgPertanyaan, setEditImgPertanyaan] = useState('')
  const [editImgOpsi, setEditImgOpsi] = useState<Record<string, string>>({})
  const [deleteSoalId, setDeleteSoalId] = useState<string | null>(null)
  const [deleteSoalPaketId, setDeleteSoalPaketId] = useState<string | null>(null)
  const [viewSoal, setViewSoal] = useState<SoalWithImg | null>(null)

  // FIX (konsolidasi menu Bank Soal → Buat Soal): kirim/tarik/duplicate/hapus
  // paket PG dulunya cuma ada di halaman Bank Soal (src/app/guru/soal/page.tsx).
  // Sekarang dipindah ke sini supaya "Buat Soal" jadi satu-satunya tempat,
  // sama seperti alur Soal Essay yang sudah lebih dulu lengkap sendiri.
  const [kirimId, setKirimId] = useState<string | null>(null)
  const [tarikId, setTarikId] = useState<string | null>(null)
  const [dupId, setDupId] = useState<string | null>(null)
  const [dupKelas, setDupKelas] = useState('')
  const [hapusPaketId, setHapusPaketId] = useState<string | null>(null)

  // Setup state
  const [setupMapel, setSetupMapel] = useState('')
  const [setupKelas, setSetupKelas] = useState('')
  const [setupAcak, setSetupAcak] = useState('YA')

  // FIX: jumlah opsi jawaban (4/5) tidak lagi dipilih manual oleh guru —
  // sekarang otomatis mengikuti Pengaturan Ujian yang ditentukan admin.
  const [globalJumlahOpsi, setGlobalJumlahOpsi] = useState(4)

  // Soal form state
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

  // Sinkronisasi antar-komponen di halaman ini (mis. setelah aksi di komponen lain)
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

  // ── Fetch jumlah opsi jawaban (ditentukan admin) ───────────────
  useEffect(() => {
    apiRequest<{ data: Record<string, string> }>('/api/public/pengaturan')
      .then(r => {
        const n = Number(r.data?.jumlahOpsi)
        if (n === 3 || n === 4 || n === 5) setGlobalJumlahOpsi(n)
      })
      .catch(() => { })
  }, [])

  const kelasUntukMapel: Kelas[] = (() => {
    if (!setupMapel) return []
    const mapel = guruMapelList.find(m => m.id === setupMapel)
    if (!mapel?.kelas_list) return []
    const kelasDiMapel = mapel.kelas_list.split(',').map(s => s.trim()).filter(Boolean)
    // kelas_list berisi nama kelas (misal "10,11,12"), bukan id kelas.
    // Cocokkan dengan k.nama agar kelas apapun pasti muncul di dropdown guru.
    return allKelasList.filter(k => kelasDiMapel.includes(k.nama))
  })()

  useEffect(() => { setSetupKelas('') }, [setupMapel])

  function resetSoalForm() {
    formRef.current?.reset()
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
    payload.jumlah_opsi = String(globalJumlahOpsi)
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

  // ── Edit soal dari expand list ──
  function openEditSoal(s: SoalWithImg) {
    setEditSoal(s)
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
    payload.jumlah_opsi = String(editSoal.jumlah_opsi || 4)
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

  // ── Kirim paket ───────────────────────────────────────────────
  async function handleKirim() {
    if (!kirimId) return
    setSaving(true)
    try {
      // Backend bisa ikut mengirim paket Essay pasangan (mapel+kelas sama)
      // sekaligus — tampilkan pesannya apa adanya supaya guru tahu itu
      // terjadi, bukan pesan generik.
      const res = await apiRequest<{ message?: string }>(`/api/guru/paket/${kirimId}/kirim`, { method: 'POST' })
      showToast(res?.message || 'Paket berhasil dikirim untuk validasi')
      setKirimId(null)
      if (expandedId === kirimId) await loadSoalPaket(kirimId)
      await load()
      window.dispatchEvent(new Event(SYNC_EVENT))
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Gagal mengirim', 'error')
    } finally { setSaving(false) }
  }

  // ── Tarik paket ───────────────────────────────────────────────
  async function handleTarik() {
    if (!tarikId) return
    setSaving(true)
    try {
      await apiRequest(`/api/guru/paket/${tarikId}/tarik`, { method: 'POST' })
      showToast('Paket berhasil ditarik kembali ke DRAFT')
      setTarikId(null)
      if (expandedId === tarikId) await loadSoalPaket(tarikId)
      await load()
      window.dispatchEvent(new Event(SYNC_EVENT))
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Gagal menarik', 'error')
    } finally { setSaving(false) }
  }

  // ── Duplicate paket ───────────────────────────────────────────
  async function handleDuplicate() {
    if (!dupId || !dupKelas) return
    setSaving(true)
    try {
      await apiRequest(`/api/guru/paket/${dupId}/duplicate`, {
        method: 'POST',
        body: JSON.stringify({ kelas_id: dupKelas }),
      })
      showToast('Paket berhasil diduplikasi ke kelas lain')
      setDupId(null)
      setDupKelas('')
      await load()
      window.dispatchEvent(new Event(SYNC_EVENT))
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Gagal menduplikasi', 'error')
    } finally { setSaving(false) }
  }

  // ── Hapus paket ───────────────────────────────────────────────
  async function handleHapusPaket() {
    if (!hapusPaketId) return
    setSaving(true)
    try {
      await apiRequest(`/api/guru/paket/${hapusPaketId}`, { method: 'DELETE' })
      showToast('Paket soal berhasil dihapus')
      setHapusPaketId(null)
      await load()
      window.dispatchEvent(new Event(SYNC_EVENT))
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Gagal menghapus paket', 'error')
    } finally { setSaving(false) }
  }

  // ── Kelas yang bisa dipilih untuk duplicate (bukan kelas sendiri) ──
  // FIX BUG: sebelumnya fungsi ini mengembalikan SEMUA kelas di sekolah
  // (allKelasList) yang bukan kelas paket sumber — tidak peduli apakah
  // guru ini benar-benar mengampu mapel tsb di kelas lain itu atau tidak.
  // Akibatnya guru yang cuma mengajar mapel X di kelas 7 tetap melihat
  // kelas 8/9/10/... di dropdown duplikasi, padahal ia tidak berwenang
  // membuat/memiliki paket soal mapel itu di kelas-kelas tersebut.
  // Sekarang dibatasi ke kelas yang ada di `kelas_list` milik mapel ini
  // pada `guruMapelList` — persis logika yang sudah dipakai untuk mengisi
  // dropdown kelas di step "setup" (lihat `kelasUntukMapel` di atas).
  function getKelasUntukDuplicate(paketId: string) {
    const paket = pakets.find(p => p.id === paketId)
    if (!paket) return []
    const mapel = guruMapelList.find(m => m.id === paket.mapel_id)
    if (!mapel?.kelas_list) return []
    const kelasDiMapel = mapel.kelas_list.split(',').map(s => s.trim()).filter(Boolean)
    return allKelasList.filter(k => kelasDiMapel.includes(k.nama) && k.id !== paket.kelas_id)
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

            {/* FIX: dropdown "Jumlah Opsi" dihilangkan — jumlah opsi jawaban
                (4 atau 5) sekarang otomatis mengikuti Pengaturan Ujian di
                akun Admin, bukan dipilih manual oleh guru per soal. */}
            {/* FIX: dropdown "Tingkat Kesulitan" dihapus — tidak dipakai di mana
                pun (tidak ditampilkan di halaman Analisis Ujian), jadi hanya
                menambah langkah tanpa manfaat bagi guru saat membuat soal. */}

            <div className="space-y-2">
              <label className="label">Pilihan Jawaban</label>
              {opsiLabels.slice(0, globalJumlahOpsi).map(label => {
                const lk = label.toLowerCase()
                // Teks opsi wajib diisi KECUALI opsi ini sudah punya gambar —
                // guru boleh membuat pilihan jawaban berupa gambar saja tanpa teks.
                const adaGambar = !!imgOpsi[lk]
                return (
                  <div key={label} className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="w-7 h-7 rounded-lg bg-slate-100 text-slate-600 font-bold text-xs flex items-center justify-center flex-shrink-0">{label}</span>
                      <input
                        name={`opsi_${lk}`}
                        className="input"
                        placeholder={adaGambar ? `Opsi ${label} (opsional, gambar sudah ada)` : `Opsi ${label}`}
                        required={!adaGambar}
                      />
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
              <label className="label">Kunci Jawaban *</label>
              <select name="kunci" className="select" required defaultValue="">
                <option value="" disabled>Pilih Kunci Jawaban</option>
                {opsiLabels.slice(0, globalJumlahOpsi).map(l => <option key={l} value={l}>{l}</option>)}
              </select>
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
          <button onClick={onBack} className="btn-ghost btn-sm text-slate-500 mb-1">
            <ArrowLeft className="w-4 h-4" /> Ganti Jenis Soal
          </button>
          <h1 className="page-title">Buat Soal PG</h1>
          <p className="page-subtitle">Kelola paket soal, tambah/edit soal, dan kirim ke admin</p>
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
          <h2 className="font-bold text-slate-800">Daftar Paket Soal yang sudah Anda buat :</h2>
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
                <div className="flex items-center gap-2 flex-shrink-0 flex-wrap justify-end">
                  {p.status === 'DRAFT' && (
                    <button onClick={() => lanjutkanPaket(p)} className="btn-secondary btn-sm">
                      <Plus className="w-3.5 h-3.5" /> Lanjutkan
                    </button>
                  )}

                  {/* Duplicate — selalu tersedia */}
                  <button onClick={() => { setDupId(p.id); setDupKelas('') }}
                    className="btn-secondary btn-sm" title="Duplikasi ke kelas lain">
                    <Copy className="w-3.5 h-3.5" /> Duplikasi
                  </button>

                  {/* Kirim */}
                  {(p.status === 'DRAFT' || p.status === 'DITOLAK') && (
                    <button onClick={() => setKirimId(p.id)} className="btn-primary btn-sm">
                      <Send className="w-3.5 h-3.5" /> {p.status === 'DITOLAK' ? 'Kirim Ulang' : 'Kirim'}
                    </button>
                  )}

                  {/* Hapus paket */}
                  {(p.status === 'DRAFT' || p.status === 'DITOLAK') && (
                    <button
                      onClick={() => setHapusPaketId(p.id)}
                      className="btn-ghost btn-icon btn-sm text-red-500 hover:bg-red-50"
                      title="Hapus paket soal"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}

                  {/* Tarik */}
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

              {p.status === 'MENUNGGU' && p.catatan && (
                <div className="px-4 pb-3 -mt-2 text-xs text-amber-600">Persetujuan dibatalkan admin — klik <strong>Tarik</strong> untuk mengedit soal lalu kirim ulang</div>
              )}

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

      <Confirm open={!!deleteSoalId} onClose={() => { setDeleteSoalId(null); setDeleteSoalPaketId(null) }}
        onConfirm={handleDeleteSoal} title="Hapus Soal"
        message="Soal ini akan dihapus permanen. Lanjutkan?"
        confirmLabel="Ya, Hapus" loading={saving} />

      {/* Modal Duplicate */}
      <Modal
        open={!!dupId}
        onClose={() => { setDupId(null); setDupKelas('') }}
        title="Duplikasi Paket ke Kelas Lain"
        size="sm"
        footer={
          <>
            <button onClick={() => { setDupId(null); setDupKelas('') }} className="btn-secondary" disabled={saving}>Batal</button>
            <button onClick={handleDuplicate} className="btn-primary" disabled={saving || !dupKelas}>
              {saving ? <Spinner size="sm" /> : <><Copy className="w-4 h-4" /> Duplikasi</>}
            </button>
          </>
        }
      >
        <div className="space-y-4">
          <p className="text-sm text-slate-600">
            Semua soal dalam paket ini akan disalin ke paket baru dengan status <strong>DRAFT</strong> untuk kelas yang dipilih.
          </p>
          <div>
            <label className="label">Pilih Kelas Tujuan *</label>
            <select className="select" value={dupKelas} onChange={e => setDupKelas(e.target.value)}>
              <option value="">— Pilih kelas —</option>
              {dupId && getKelasUntukDuplicate(dupId).map(k => (
                <option key={k.id} value={k.id}>{k.nama}</option>
              ))}
            </select>
          </div>
          <div className="alert-info text-xs flex items-start gap-2">
            <CheckCircle2 className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
            Paket yang sudah ada untuk kelas tujuan yang sama tidak bisa dipilih untuk mencegah duplikasi.
          </div>
        </div>
      </Modal>

      {/* Confirm Kirim */}
      <Confirm open={!!kirimId} onClose={() => setKirimId(null)} onConfirm={handleKirim}
        title="Kirim Paket Soal"
        message="Semua soal dalam paket ini akan dikirim ke admin untuk divalidasi. Setelah dikirim, soal tidak bisa diedit atau dihapus sampai admin menentukan keputusan. Lanjutkan?"
        confirmLabel="Ya, Kirim" variant="primary" loading={saving} />

      {/* Confirm Tarik */}
      <Confirm open={!!tarikId} onClose={() => setTarikId(null)} onConfirm={handleTarik}
        title="Tarik Paket Soal"
        message="Paket akan ditarik kembali ke status DRAFT dan soal-soal bisa diedit kembali. Lanjutkan?"
        confirmLabel="Ya, Tarik" variant="primary" loading={saving} />

      {/* Confirm Hapus Paket */}
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

        {/* FIX: dropdown "Jumlah Opsi" dihilangkan dari edit — jumlah opsi
            soal yang sudah ada tetap mengikuti nilai aslinya saat dibuat,
            karena admin yang menentukan aturan jumlah opsi, bukan guru. */}
        {/* FIX: dropdown "Tingkat Kesulitan" dihapus — tidak dipakai di mana
            pun (tidak ditampilkan di halaman Analisis Ujian), jadi hanya
            menambah langkah tanpa manfaat bagi guru saat mengedit soal. */}

        <div className="space-y-2">
          <label className="label">Opsi Jawaban</label>
          {opsiLabels.slice(0, editSoal.jumlah_opsi || 4).map(label => {
            const lk = label.toLowerCase()
            const defaultVal = (editSoal as unknown as Record<string,string>)[`opsi_${lk}`] ?? ''
            // Teks opsi wajib diisi KECUALI opsi ini sudah punya gambar —
            // guru boleh membuat pilihan jawaban berupa gambar saja tanpa teks.
            const adaGambar = !!editImgOpsi[lk]
            return (
              <div key={label} className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="w-7 h-7 rounded-lg bg-slate-100 text-slate-600 font-bold text-xs flex items-center justify-center flex-shrink-0">{label}</span>
                  <input
                    name={`opsi_${lk}`}
                    className="input"
                    placeholder={adaGambar ? `Opsi ${label} (opsional, gambar sudah ada)` : `Opsi ${label}`}
                    required={!adaGambar}
                    defaultValue={defaultVal}
                  />
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
          <label className="label">Kunci Jawaban *</label>
          <select name="kunci" className="select" required defaultValue={editSoal.kunci ?? ''}>
            {!editSoal.kunci && <option value="" disabled>Pilih Kunci Jawaban</option>}
            {opsiLabels.slice(0, editSoal.jumlah_opsi || 4).map(l => <option key={l} value={l}>{l}</option>)}
          </select>
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

// ── ESSAY SOAL FLOW ──────────────────────────────────────────────────
function EssaySoalFlow({ onBack }: { onBack: () => void }) {
  const [step, setStep] = useState<EssayStep>('list')
  const [pakets, setPakets] = useState<PaketEssay[]>([])
  const [guruMapelList, setGuruMapelList] = useState<Mapel[]>([])
  const [allMapelList, setAllMapelList] = useState<Mapel[]>([])
  const [allKelasList, setAllKelasList] = useState<Kelas[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingSoal, setLoadingSoal] = useState(false)
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null)

  const [activePaket, setActivePaket] = useState<PaketEssay | null>(null)
  const [soalList, setSoalList] = useState<SoalEssay[]>([])

  // Setup state
  const [setupMapel, setSetupMapel] = useState('')
  const [setupKelas, setSetupKelas] = useState('')
  const [setupMode, setSetupMode] = useState<'DIGITAL' | 'KERTAS'>('DIGITAL')
  const [setupDurasi, setSetupDurasi] = useState('30')
  // FIX (hapus bobot "global"): sebelumnya nilai awal dibawa dari kartu
  // "Nilai Awal" di layar pilihan jenis soal — kartu itu sudah dihapus
  // (lihat GuruBuatSoalPage), jadi form ini sekarang default 50:50 sendiri,
  // sama seperti sebelum kartu tersebut pernah ada. Guru tetap bisa
  // mengubahnya di sini, dan nilai inilah yang benar-benar tersimpan per
  // mapel+kelas.
  const [setupBobotPg, setSetupBobotPg] = useState('50')
  const [setupBobotEssay, setSetupBobotEssay] = useState('50')

  function handleBobotPgChange(val: string) {
    setSetupBobotPg(val)
    const n = Number(val)
    if (Number.isFinite(n)) setSetupBobotEssay(String(100 - n))
  }
  function handleBobotEssayChange(val: string) {
    setSetupBobotEssay(val)
    const n = Number(val)
    if (Number.isFinite(n)) setSetupBobotPg(String(100 - n))
  }

  // FIX (gap): batas durasi essay ditentukan admin (Pengaturan > Ujian) —
  // sebelumnya field ini ada di halaman Admin tapi tidak pernah dibaca di
  // sini, jadi guru tidak tahu batasnya sampai gagal submit di backend.
  const [durasiMin, setDurasiMin] = useState(10)
  const [durasiMax, setDurasiMax] = useState(180)
  useEffect(() => {
    apiRequest<{ data: Record<string, string> }>('/api/public/pengaturan')
      .then(r => {
        const min = Number(r.data?.batas_durasi_essay_min_menit)
        const max = Number(r.data?.batas_durasi_essay_max_menit)
        if (min > 0) setDurasiMin(min)
        if (max > 0) setDurasiMax(max)
      })
      .catch(() => { })
  }, [])

  // Aksi paket: kirim/tarik/duplikasi/hapus
  const [kirimId, setKirimId] = useState<string | null>(null)
  const [tarikId, setTarikId] = useState<string | null>(null)
  const [dupId, setDupId] = useState<string | null>(null)
  const [dupKelas, setDupKelas] = useState('')
  const [hapusPaketId, setHapusPaketId] = useState<string | null>(null)

  // Soal form (tambah)
  const [gambarUrl, setGambarUrl] = useState('')
  const [uploadingImg, setUploadingImg] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [pendingUploadKey, setPendingUploadKey] = useState<string | null>(null)
  const formRef = useRef<HTMLFormElement>(null)

  // Edit soal
  const [editSoal, setEditSoal] = useState<SoalEssay | null>(null)
  const [editGambarUrl, setEditGambarUrl] = useState('')
  const [deleteSoalId, setDeleteSoalId] = useState<string | null>(null)
  const [viewSoal, setViewSoal] = useState<SoalEssay | null>(null)

  const showToast = (msg: string, type: 'success' | 'error' = 'success') => setToast({ msg, type })

  const ESSAY_SYNC_EVENT = 'guru-paket-essay-updated'

  const loadPakets = useCallback(async () => {
    setLoading(true)
    try {
      const res = await apiRequest<{ data: PaketEssay[] }>('/api/guru/paket-essay')
      setPakets(res.data)
      return res.data
    } finally { setLoading(false) }
  }, [])

  useEffect(() => { loadPakets() }, [loadPakets])

  useEffect(() => {
    const handler = () => loadPakets()
    window.addEventListener(ESSAY_SYNC_EVENT, handler)
    return () => window.removeEventListener(ESSAY_SYNC_EVENT, handler)
  }, [loadPakets])

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
    const kelasDiMapel = mapel.kelas_list.split(',').map(s => s.trim()).filter(Boolean)
    return allKelasList.filter(k => kelasDiMapel.includes(k.nama))
  })()

  useEffect(() => { setSetupKelas('') }, [setupMapel])

  const getNamaMapel = (id: string) => guruMapelList.find(m => m.id === id)?.nama ?? allMapelList.find(m => m.id === id)?.nama ?? id
  const getNamaKelas = (id: string) => allKelasList.find(k => k.id === id)?.nama ?? id
  const isEditable = (status: string) => ['DRAFT', 'DITOLAK'].includes(status)

  function resetSoalForm() {
    formRef.current?.reset()
    setGambarUrl('')
  }

  async function loadSoalPaket(paketId: string) {
    setLoadingSoal(true)
    try {
      const res = await apiRequest<{ data: SoalEssay[] }>(`/api/guru/soal-essay?paket_id=${paketId}`)
      setSoalList(res.data)
      return res.data
    } catch {
      setSoalList([])
      return []
    } finally { setLoadingSoal(false) }
  }

  async function startBuatPaket() {
    if (!setupMapel || !setupKelas) {
      showToast('Pilih mata pelajaran dan kelas terlebih dahulu', 'error')
      return
    }
    const bpg = Number(setupBobotPg)
    const bes = Number(setupBobotEssay)
    if (!Number.isFinite(bpg) || !Number.isFinite(bes) || bpg < 0 || bes < 0 || bpg + bes !== 100) {
      showToast('Bobot PG dan Essay harus berjumlah 100%', 'error')
      return
    }
    setSaving(true)
    try {
      await apiRequest<{ id?: string; message: string }>('/api/guru/paket-essay', {
        method: 'POST',
        body: JSON.stringify({
          mapel_id: setupMapel,
          kelas_id: setupKelas,
          mode_jawaban: setupMode,
          durasi_menit: Number(setupDurasi) || 30,
          bobot_pg_persen: bpg,
          bobot_essay_persen: bes,
        }),
      })
      const listRes = await apiRequest<{ data: PaketEssay[] }>('/api/guru/paket-essay')
      setPakets(listRes.data)
      const matched = listRes.data.find(p => p.mapel_id === setupMapel && p.kelas_id === setupKelas)
      if (matched) {
        setActivePaket(matched)
        setSoalList([])
        resetSoalForm()
        setStep('detail')
      } else {
        setStep('list')
      }
      window.dispatchEvent(new Event(ESSAY_SYNC_EVENT))
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Gagal membuat paket', 'error')
    } finally { setSaving(false) }
  }

  async function bukaKelolaSoal(p: PaketEssay) {
    setActivePaket(p)
    setSoalList([])
    resetSoalForm()
    setStep('detail')
    await loadSoalPaket(p.id)
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
      if (pendingUploadKey === 'edit') setEditGambarUrl(data.url)
      else setGambarUrl(data.url)
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Upload gambar gagal', 'error')
    } finally { setUploadingImg(null); e.target.value = '' }
  }

  function triggerUpload(key: string) {
    setPendingUploadKey(key)
    setTimeout(() => fileInputRef.current?.click(), 50)
  }

  async function handleTambahSoal(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!activePaket) return
    const fd = new FormData(e.currentTarget)
    const teks = String(fd.get('teks') ?? '')
    const bobotMaks = Number(fd.get('bobot_maks'))
    if (!bobotMaks || bobotMaks <= 0) {
      showToast('Bobot maksimal soal harus lebih dari 0', 'error')
      return
    }
    setSaving(true)
    try {
      await apiRequest('/api/guru/soal-essay', {
        method: 'POST',
        body: JSON.stringify({
          paket_id: activePaket.id,
          teks,
          gambar_url: gambarUrl || null,
          bobot_maks: bobotMaks,
        }),
      })
      showToast('Soal berhasil ditambahkan')
      resetSoalForm()
      const [soalRes, listRes] = await Promise.all([
        loadSoalPaket(activePaket.id),
        apiRequest<{ data: PaketEssay[] }>('/api/guru/paket-essay'),
      ])
      void soalRes
      setPakets(listRes.data)
      const updated = listRes.data.find(p => p.id === activePaket.id)
      if (updated) setActivePaket(updated)
      window.dispatchEvent(new Event(ESSAY_SYNC_EVENT))
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Gagal menyimpan soal', 'error')
    } finally { setSaving(false) }
  }

  function openEditSoal(s: SoalEssay) {
    setEditSoal(s)
    setEditGambarUrl(s.gambar_url || '')
  }

  async function handleSaveEditSoal(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!editSoal?.id) return
    const fd = new FormData(e.currentTarget)
    const teks = String(fd.get('teks') ?? '')
    const bobotMaks = Number(fd.get('bobot_maks'))
    if (!bobotMaks || bobotMaks <= 0) {
      showToast('Bobot maksimal soal harus lebih dari 0', 'error')
      return
    }
    setSaving(true)
    try {
      await apiRequest(`/api/guru/soal-essay/${editSoal.id}`, {
        method: 'PUT',
        body: JSON.stringify({ teks, gambar_url: editGambarUrl || null, bobot_maks: bobotMaks }),
      })
      showToast('Soal berhasil diperbarui')
      setEditSoal(null)
      if (activePaket) await loadSoalPaket(activePaket.id)
      window.dispatchEvent(new Event(ESSAY_SYNC_EVENT))
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Gagal menyimpan', 'error')
    } finally { setSaving(false) }
  }

  async function handleDeleteSoal() {
    if (!deleteSoalId || !activePaket) return
    setSaving(true)
    try {
      await apiRequest(`/api/guru/soal-essay/${deleteSoalId}`, { method: 'DELETE' })
      showToast('Soal berhasil dihapus')
      setDeleteSoalId(null)
      await loadSoalPaket(activePaket.id)
      const listRes = await apiRequest<{ data: PaketEssay[] }>('/api/guru/paket-essay')
      setPakets(listRes.data)
      const updated = listRes.data.find(p => p.id === activePaket.id)
      if (updated) setActivePaket(updated)
      window.dispatchEvent(new Event(ESSAY_SYNC_EVENT))
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Gagal menghapus', 'error')
    } finally { setSaving(false) }
  }

  async function handleKirim() {
    if (!kirimId) return
    setSaving(true)
    try {
      const res = await apiRequest<{ message: string }>(`/api/guru/paket-essay/${kirimId}/kirim`, { method: 'POST' })
      showToast(res.message || 'Paket berhasil dikirim')
      setKirimId(null)
      await loadPakets()
      window.dispatchEvent(new Event(ESSAY_SYNC_EVENT))
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Gagal mengirim paket', 'error')
    } finally { setSaving(false) }
  }

  async function handleTarik() {
    if (!tarikId) return
    setSaving(true)
    try {
      await apiRequest(`/api/guru/paket-essay/${tarikId}/tarik`, { method: 'POST' })
      showToast('Paket berhasil ditarik')
      setTarikId(null)
      await loadPakets()
      window.dispatchEvent(new Event(ESSAY_SYNC_EVENT))
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Gagal menarik paket', 'error')
    } finally { setSaving(false) }
  }

  async function handleDuplicate() {
    if (!dupId || !dupKelas) return
    setSaving(true)
    try {
      await apiRequest(`/api/guru/paket-essay/${dupId}/duplicate`, {
        method: 'POST',
        body: JSON.stringify({ kelas_id: dupKelas }),
      })
      showToast('Paket berhasil diduplikasi')
      setDupId(null)
      setDupKelas('')
      await loadPakets()
      window.dispatchEvent(new Event(ESSAY_SYNC_EVENT))
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Gagal menduplikasi paket', 'error')
    } finally { setSaving(false) }
  }

  async function handleHapusPaket() {
    if (!hapusPaketId) return
    setSaving(true)
    try {
      await apiRequest(`/api/guru/paket-essay/${hapusPaketId}`, { method: 'DELETE' })
      showToast('Paket berhasil dihapus')
      setHapusPaketId(null)
      await loadPakets()
      window.dispatchEvent(new Event(ESSAY_SYNC_EVENT))
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Gagal menghapus paket', 'error')
    } finally { setSaving(false) }
  }

  // Kelas tujuan untuk duplikasi: hanya kelas yang benar-benar diampu guru
  // untuk mapel paket sumber ini, exclude kelas milik paket sumber sendiri.
  // FIX BUG: sebelumnya (allKelasList.filter(k => k.id !== kelas_id)) semua
  // kelas di sekolah ikut muncul, termasuk kelas yang tidak diampu guru ini
  // sama sekali untuk mapel tsb — sama seperti bug di getKelasUntukDuplicate
  // pada PgSoalFlow di atas, diperbaiki dengan pola yang sama: cocokkan ke
  // `kelas_list` milik mapel ini di guruMapelList.
  const dupPaketSumber = pakets.find(p => p.id === dupId) ?? null
  const kelasTujuanDuplikasi = (() => {
    if (!dupPaketSumber) return []
    const mapel = guruMapelList.find(m => m.id === dupPaketSumber.mapel_id)
    if (!mapel?.kelas_list) return []
    const kelasDiMapel = mapel.kelas_list.split(',').map(s => s.trim()).filter(Boolean)
    return allKelasList.filter(k => kelasDiMapel.includes(k.nama) && k.id !== dupPaketSumber.kelas_id)
  })()

  // ── Render daftar soal (dipakai di step detail) ──
  function renderSoalList() {
    if (soalList.length === 0) {
      return <p className="text-xs text-slate-400 text-center py-4">Belum ada soal dalam paket ini</p>
    }
    return soalList.map((s, i) => (
      <div key={s.id || i} className="flex items-start gap-2 text-sm text-slate-700 bg-white rounded-lg px-3 py-2 border border-slate-100">
        <span className="w-5 h-5 rounded-full bg-emerald-100 text-emerald-700 font-bold text-xs flex items-center justify-center flex-shrink-0 mt-0.5">{i + 1}</span>
        <div className="flex-1 min-w-0">
          <p className="line-clamp-2">{s.teks}</p>
          <div className="flex items-center gap-2 mt-0.5">
            {s.gambar_url && <span className="text-xs text-brand-500">📷 Ada gambar</span>}
            <span className="text-xs text-slate-400">Bobot: {s.bobot_maks}</span>
          </div>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          {isEditable(s.status) ? (
            <>
              <button onClick={() => openEditSoal(s)} className="btn-ghost btn-icon btn-sm text-blue-600 hover:bg-blue-50" title="Edit soal">
                <Pencil className="w-3.5 h-3.5" />
              </button>
              <button onClick={() => setDeleteSoalId(s.id)} className="btn-ghost btn-icon btn-sm text-red-600 hover:bg-red-50" title="Hapus soal">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </>
          ) : (
            <>
              <button onClick={() => setViewSoal(s)} className="btn-ghost btn-icon btn-sm text-slate-500 hover:bg-slate-100" title="Lihat soal">
                <Eye className="w-3.5 h-3.5" />
              </button>
              <span title="Soal tidak bisa diedit" className="btn-ghost btn-icon btn-sm text-slate-300 cursor-not-allowed">
                <Lock className="w-3.5 h-3.5" />
              </span>
            </>
          )}
        </div>
      </div>
    ))
  }

  // ── STEP: DETAIL ─────────────────────────────────────────────────
  if (step === 'detail' && activePaket) {
    const namaMapel = activePaket.nama_mapel ?? getNamaMapel(activePaket.mapel_id)
    const namaKelas = activePaket.nama_kelas ?? getNamaKelas(activePaket.kelas_id)
    const editable = isEditable(activePaket.status)
    return (
      <div className="space-y-6 animate-fade-in">
        {toast && <Toast message={toast.msg} type={toast.type} onClose={() => setToast(null)} />}
        <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleFileChange} />

        <div>
          <button onClick={() => { setStep('list'); setActivePaket(null); setSoalList([]) }} className="btn-ghost btn-sm text-slate-500 mb-1">
            <ArrowLeft className="w-4 h-4" /> Kembali
          </button>
          <h1 className="page-title">Kelola Soal Essay</h1>
          <p className="page-subtitle">
            {namaMapel} · Kelas {namaKelas} · Mode {activePaket.mode_jawaban} · {activePaket.durasi_menit} menit · Bobot PG {activePaket.bobot_pg_persen}% : Essay {activePaket.bobot_essay_persen}% · {soalList.length} soal
          </p>
        </div>

        <EssayFlowGuide current="buat-soal" />

        {!editable && (
          <div className="alert-info text-sm flex items-center gap-2">
            <Lock className="w-4 h-4 flex-shrink-0" />
            Paket ini sudah dikirim/disetujui dan terkunci — soal tidak bisa ditambah, diedit, atau dihapus.
          </div>
        )}

        {editable && (
          <div className="card">
            <div className="flex items-center gap-2 mb-4">
              <span className="w-8 h-8 rounded-full bg-emerald-600 text-white font-bold text-sm flex items-center justify-center flex-shrink-0">
                {soalList.length + 1}
              </span>
              <h2 className="font-semibold text-slate-800">Soal ke-{soalList.length + 1}</h2>
            </div>
            <form ref={formRef} onSubmit={handleTambahSoal} className="space-y-4">
              <div>
                <label className="label">Teks Pertanyaan *</label>
                <textarea name="teks" className="textarea" rows={3} required placeholder="Tulis pertanyaan essay di sini..." />
                <div className="mt-2">
                  <ImageUploadButton label="Tambah Gambar" url={gambarUrl}
                    onUrl={setGambarUrl} uploadKey="tambah" uploading={uploadingImg} onTrigger={triggerUpload} />
                </div>
              </div>
              <div>
                <label className="label">Bobot Maksimal *</label>
                <input name="bobot_maks" type="number" min={1} className="input" required placeholder="Contoh: 20" />
              </div>
              <div className="flex gap-3 pt-2 flex-wrap">
                <button type="submit" className="btn-primary" disabled={saving || !!uploadingImg}>
                  {saving ? <Spinner size="sm" /> : <><Plus className="w-4 h-4" /> Tambah & Lanjut ke Soal Berikutnya</>}
                </button>
                <button type="button" onClick={() => { setStep('list'); setActivePaket(null); setSoalList([]) }} className="btn-secondary">
                  Selesai ({soalList.length} soal)
                </button>
              </div>
            </form>
          </div>
        )}

        {(soalList.length > 0 || loadingSoal) && (
          <div className="card">
            <p className="text-sm font-medium text-slate-600 mb-3">Soal yang sudah dibuat ({soalList.length})</p>
            {loadingSoal ? (
              <div className="flex justify-center py-4"><Spinner size="sm" /></div>
            ) : (
              <div className="space-y-2">{renderSoalList()}</div>
            )}
          </div>
        )}

        {/* Modal Edit Soal */}
        <Modal open={!!editSoal} onClose={() => setEditSoal(null)} title="Edit Soal Essay" size="lg"
          footer={
            <>
              <button onClick={() => setEditSoal(null)} className="btn-secondary" disabled={saving}>Batal</button>
              <button form="soal-essay-edit-form" type="submit" className="btn-primary" disabled={saving || uploadingImg === 'edit'}>
                {saving ? <Spinner size="sm" /> : 'Simpan Perubahan'}
              </button>
            </>
          }
        >
          {editSoal && (
            <form id="soal-essay-edit-form" onSubmit={handleSaveEditSoal} className="space-y-4">
              <div>
                <label className="label">Teks Pertanyaan *</label>
                <textarea name="teks" className="textarea" rows={3} required defaultValue={editSoal.teks ?? ''} />
                <div className="mt-2">
                  <ImageUploadButton label="Tambah Gambar" url={editGambarUrl}
                    onUrl={setEditGambarUrl} uploadKey="edit" uploading={uploadingImg} onTrigger={triggerUpload} />
                </div>
              </div>
              <div>
                <label className="label">Bobot Maksimal *</label>
                <input name="bobot_maks" type="number" min={1} className="input" required defaultValue={editSoal.bobot_maks} />
              </div>
            </form>
          )}
        </Modal>

        {/* Modal View (read-only) */}
        <Modal open={!!viewSoal} onClose={() => setViewSoal(null)} title="Detail Soal Essay" size="lg">
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
              {viewSoal.gambar_url && (
                <div>
                  <p className="label mb-1">Gambar</p>
                  <img src={viewSoal.gambar_url} alt="Gambar soal" className="max-h-48 rounded-lg border border-slate-200" />
                </div>
              )}
              <div>
                <p className="label mb-1">Bobot Maksimal</p>
                <p className="text-sm text-slate-700">{viewSoal.bobot_maks}</p>
              </div>
            </div>
          )}
        </Modal>

        <Confirm open={!!deleteSoalId} onClose={() => setDeleteSoalId(null)}
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
          <h1 className="page-title">Buat Paket Soal Essay</h1>
          <p className="page-subtitle">Atur mata pelajaran, kelas, mode jawaban, dan durasi terlebih dahulu</p>
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
              <label className="label">Mode Jawaban</label>
              <select className="select" value={setupMode} onChange={e => setSetupMode(e.target.value as 'DIGITAL' | 'KERTAS')}>
                <option value="DIGITAL">Digital — siswa mengetik jawaban di layar</option>
                <option value="KERTAS">Kertas — siswa menulis jawaban di kertas</option>
              </select>
            </div>
            <div>
              <label className="label">Durasi (menit) *</label>
              <input type="number" min={durasiMin} max={durasiMax} className="input" value={setupDurasi} onChange={e => setSetupDurasi(e.target.value)} required />
              <p className="text-xs text-slate-400 mt-1">Durasi harus antara {durasiMin}–{durasiMax} menit (ditentukan admin).</p>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="label">Bobot Nilai PG (%)</label>
                <input type="number" min={0} max={100} className="input" value={setupBobotPg} onChange={e => handleBobotPgChange(e.target.value)} />
              </div>
              <div>
                <label className="label">Bobot Nilai Essay (%)</label>
                <input type="number" min={0} max={100} className="input" value={setupBobotEssay} onChange={e => handleBobotEssayChange(e.target.value)} />
              </div>
            </div>
            <div className="alert-info text-xs flex items-center gap-2">
              <Info className="w-3.5 h-3.5 flex-shrink-0" />
              Pengaturan ini hanya perlu diisi sekali. Setelah itu Anda bisa langsung membuat soal satu per satu.
            </div>
            <div className="flex gap-3 pt-2">
              <button
                onClick={startBuatPaket}
                className="btn-primary"
                disabled={saving || !setupMapel || !setupKelas || Number(setupDurasi) < durasiMin || Number(setupDurasi) > durasiMax || Number(setupBobotPg) + Number(setupBobotEssay) !== 100}
              >
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

      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <button onClick={onBack} className="btn-ghost btn-sm text-slate-500 mb-1">
            <ArrowLeft className="w-4 h-4" /> Ganti Jenis Soal
          </button>
          <h1 className="page-title">Buat Soal Essay</h1>
          <p className="page-subtitle">Kelola paket soal essay yang telah dibuat</p>
        </div>
        <button onClick={() => setStep('setup')} className="btn-primary btn-sm">
          <Plus className="w-4 h-4" /> Buat Soal Baru
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-20"><Spinner size="lg" /></div>
      ) : pakets.length === 0 ? (
        <div className="card">
          <EmptyState message="Belum ada soal essay. Klik 'Buat Soal Baru' untuk mulai membuat soal." />
        </div>
      ) : (
        <div className="space-y-3">
          <h2 className="font-bold text-slate-800">Daftar Paket Soal yang sudah Anda buat :</h2>
          {pakets.map(p => (
            <div key={p.id} className="card p-0 overflow-hidden">
              <div className="flex items-center gap-4 p-4 flex-wrap">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-slate-900">{p.nama_mapel ?? getNamaMapel(p.mapel_id)}</span>
                    <span className="text-slate-400 text-xs">·</span>
                    <span className="text-sm text-slate-600">Kelas {p.nama_kelas ?? getNamaKelas(p.kelas_id)}</span>
                    <StatusBadge status={p.status} />
                  </div>
                  <div className="text-xs text-slate-400 mt-1">
                    {p.jumlah_soal} soal · Mode {p.mode_jawaban} · {p.durasi_menit} menit · Bobot PG {p.bobot_pg_persen}% : Essay {p.bobot_essay_persen}% · {formatDateTime(p.tanggal)}
                  </div>
                  {p.catatan && (
                    <div className="mt-2 text-xs text-amber-700 bg-amber-50 rounded-lg px-3 py-2 border border-amber-100">
                      📝 Catatan Admin: {p.catatan}
                    </div>
                  )}
                  {p.status === 'DITOLAK' && (
                    <div className="mt-1 text-xs text-red-600">Soal ditolak — silakan edit soal lalu kirim ulang</div>
                  )}
                  {p.status === 'MENUNGGU' && p.catatan && (
                    <div className="mt-1 text-xs text-slate-500">Menunggu validasi admin</div>
                  )}
                </div>
                <div className="flex items-center gap-2 flex-shrink-0 flex-wrap">
                  <button onClick={() => { setDupId(p.id); setDupKelas('') }} className="btn-ghost btn-sm text-slate-600" title="Duplikasi paket ke kelas lain">
                    <Copy className="w-3.5 h-3.5" /> Duplikasi
                  </button>
                  {['DRAFT', 'DITOLAK'].includes(p.status) && (
                    <button onClick={() => setKirimId(p.id)} className="btn-secondary btn-sm">
                      <Send className="w-3.5 h-3.5" /> {p.status === 'DITOLAK' ? 'Kirim Ulang' : 'Kirim'}
                    </button>
                  )}
                  {p.status === 'MENUNGGU' && (
                    <button onClick={() => setTarikId(p.id)} className="btn-secondary btn-sm">
                      <RotateCcw className="w-3.5 h-3.5" /> Tarik
                    </button>
                  )}
                  {['DRAFT', 'DITOLAK'].includes(p.status) && (
                    <button onClick={() => setHapusPaketId(p.id)} className="btn-ghost btn-sm text-red-600 hover:bg-red-50" title="Hapus paket">
                      <Trash2 className="w-3.5 h-3.5" /> Hapus
                    </button>
                  )}
                  <button onClick={() => bukaKelolaSoal(p)} className="btn-primary btn-sm">
                    Kelola Soal <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modal Duplikasi */}
      <Modal open={!!dupId} onClose={() => { setDupId(null); setDupKelas('') }} title="Duplikasi Paket Essay"
        footer={
          <>
            <button onClick={() => { setDupId(null); setDupKelas('') }} className="btn-secondary" disabled={saving}>Batal</button>
            <button onClick={handleDuplicate} className="btn-primary" disabled={saving || !dupKelas}>
              {saving ? <Spinner size="sm" /> : 'Duplikasi'}
            </button>
          </>
        }
      >
        <div className="space-y-3">
          <p className="text-sm text-slate-600">Pilih kelas tujuan. Semua soal dalam paket ini akan disalin sebagai paket baru berstatus Draft.</p>
          <div>
            <label className="label">Kelas Tujuan *</label>
            <select className="select" value={dupKelas} onChange={e => setDupKelas(e.target.value)} required>
              <option value="">Pilih Kelas</option>
              {kelasTujuanDuplikasi.map(k => <option key={k.id} value={k.id}>{k.nama}</option>)}
            </select>
          </div>
        </div>
      </Modal>

      <Confirm open={!!kirimId} onClose={() => setKirimId(null)} onConfirm={handleKirim}
        title="Kirim Paket" variant="primary"
        message="Paket ini beserta seluruh soal di dalamnya akan dikirim untuk divalidasi admin. Lanjutkan?"
        confirmLabel="Ya, Kirim" loading={saving} />

      <Confirm open={!!tarikId} onClose={() => setTarikId(null)} onConfirm={handleTarik}
        title="Tarik Paket" variant="primary"
        message="Paket ini akan ditarik kembali menjadi Draft dan tidak lagi menunggu validasi admin. Lanjutkan?"
        confirmLabel="Ya, Tarik" loading={saving} />

      <Confirm open={!!hapusPaketId} onClose={() => setHapusPaketId(null)} onConfirm={handleHapusPaket}
        title="Hapus Paket"
        message="Paket beserta seluruh soal di dalamnya akan dihapus permanen. Lanjutkan?"
        confirmLabel="Ya, Hapus" loading={saving} />
    </div>
  )
}

// ── Ringkasan jumlah mapel & soal yang sudah dibuat guru, ditampilkan di
// ruang kosong kartu pilihan jenis soal (lihat GuruBuatSoalPage). Diagregasi
// per mapel dari daftar paket (satu mapel bisa punya beberapa paket kalau
// diajar di beberapa kelas — jumlah soalnya dijumlahkan semua kelas).
interface RingkasanMapel { nama: string; jumlahSoal: number }
interface RingkasanSoal { totalMapel: number; totalSoal: number; perMapel: RingkasanMapel[] }

function agregasiRingkasan(pakets: { mapel_id: string; nama_mapel?: string; jumlah_soal: number }[]): RingkasanSoal {
  const perMapelMap: Record<string, RingkasanMapel> = {}
  for (const p of pakets) {
    const key = p.mapel_id
    if (!perMapelMap[key]) perMapelMap[key] = { nama: p.nama_mapel ?? p.mapel_id, jumlahSoal: 0 }
    perMapelMap[key].jumlahSoal += p.jumlah_soal ?? 0
  }
  const perMapel = Object.values(perMapelMap).sort((a, b) => b.jumlahSoal - a.jumlahSoal)
  return {
    totalMapel: perMapel.length,
    totalSoal: perMapel.reduce((sum, m) => sum + m.jumlahSoal, 0),
    perMapel,
  }
}

// Jumlah baris mapel yang ditampilkan langsung di kartu sebelum dipangkas
// jadi "+N mapel lainnya" — dijaga kecil supaya kartu tetap proporsional
// baik di layar HP (sempit, kartu ditumpuk vertikal) maupun laptop/komputer
// (kartu berdampingan, lebih lega).
const MAX_MAPEL_TAMPIL = 4

function RingkasanSoalCard({ ringkasan, loading }: { ringkasan: RingkasanSoal | null; loading: boolean }) {
  if (loading) {
    return (
      <div className="mt-4 pt-4 border-t border-slate-100 flex items-center gap-2 text-xs text-slate-400">
        <Spinner size="sm" /> Memuat ringkasan...
      </div>
    )
  }
  if (!ringkasan || ringkasan.totalMapel === 0) {
    return (
      <p className="mt-4 pt-4 border-t border-slate-100 text-xs text-slate-400">
        Belum ada soal dibuat.
      </p>
    )
  }
  const tampil = ringkasan.perMapel.slice(0, MAX_MAPEL_TAMPIL)
  const sisa = ringkasan.perMapel.length - tampil.length
  return (
    <div className="mt-4 pt-4 border-t border-slate-100 text-xs">
      <p className="font-semibold text-slate-600 mb-1.5">
        {ringkasan.totalMapel} mapel · {ringkasan.totalSoal} soal dibuat
      </p>
      <ul className="space-y-0.5">
        {tampil.map(m => (
          <li key={m.nama} className="flex items-center justify-between gap-3 text-slate-500">
            <span className="truncate">{m.nama}</span>
            <span className="flex-shrink-0 tabular-nums">{m.jumlahSoal} soal</span>
          </li>
        ))}
      </ul>
      {sisa > 0 && (
        <p className="text-slate-400 mt-1">+{sisa} mapel lainnya</p>
      )}
    </div>
  )
}

// ── Kartu "Informasi Paket Soal" ──────────────────────────────────────────
// Menggabungkan daftar paket PG dan paket Essay per mapel+kelas jadi satu
// tabel ringkasan: nama mapel & kelas, status masing-masing jenis soal, dan
// kelengkapannya (apakah mapel+kelas itu sudah punya PG, Essay, atau dua-duanya).
// Murni informatif (tidak ada aksi buat/edit) — guru dari sini bisa lihat
// sekilas mapel+kelas mana yang belum lengkap soalnya.
interface InfoPaketRow {
  key: string
  namaMapel: string
  namaKelas: string
  pg: PaketSoal | null
  essay: PaketEssay | null
}

function gabungkanInfoPaket(pgList: PaketSoal[], essayList: PaketEssay[]): InfoPaketRow[] {
  const rows: Record<string, InfoPaketRow> = {}
  for (const p of pgList) {
    const key = `${p.mapel_id}_${p.kelas_id}`
    if (!rows[key]) {
      rows[key] = { key, namaMapel: p.nama_mapel ?? p.mapel_id, namaKelas: p.nama_kelas ?? p.kelas_id, pg: null, essay: null }
    }
    rows[key].pg = p
  }
  for (const e of essayList) {
    const key = `${e.mapel_id}_${e.kelas_id}`
    if (!rows[key]) {
      rows[key] = { key, namaMapel: e.nama_mapel ?? e.mapel_id, namaKelas: e.nama_kelas ?? e.kelas_id, pg: null, essay: null }
    }
    rows[key].essay = e
  }
  return Object.values(rows).sort((a, b) =>
    a.namaMapel.localeCompare(b.namaMapel) || a.namaKelas.localeCompare(b.namaKelas)
  )
}

function InfoPaketSoalFlow({ onBack }: { onBack: () => void }) {
  const [loading, setLoading] = useState(true)
  const [rows, setRows] = useState<InfoPaketRow[]>([])

  useEffect(() => {
    let batal = false
    setLoading(true)
    Promise.all([
      apiRequest<{ data: PaketSoal[] }>('/api/guru/paket'),
      apiRequest<{ data: PaketEssay[] }>('/api/guru/paket-essay'),
    ])
      .then(([pg, essay]) => {
        if (batal) return
        setRows(gabungkanInfoPaket(pg.data ?? [], essay.data ?? []))
      })
      .catch(() => { if (!batal) setRows([]) })
      .finally(() => { if (!batal) setLoading(false) })
    return () => { batal = true }
  }, [])

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <button onClick={onBack} className="btn-ghost btn-sm text-slate-500 mb-1">
          <ArrowLeft className="w-4 h-4" /> Ganti Jenis Soal
        </button>
        <h1 className="page-title">Informasi Paket Soal</h1>
        <p className="page-subtitle">Ringkasan mapel & kelas, status soal, dan kelengkapan PG/Essay</p>
      </div>

      {loading ? (
        <div className="flex justify-center py-20"><Spinner size="lg" /></div>
      ) : rows.length === 0 ? (
        <div className="card">
          <EmptyState icon={Info} title="Belum ada paket soal"
            description="Buat Soal PG atau Soal Essay terlebih dahulu supaya muncul di ringkasan ini." />
        </div>
      ) : (
        <div className="card p-0 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-slate-500 border-b border-slate-100 bg-slate-50">
                  <th className="py-3 px-4 font-semibold">Mapel & Kelas</th>
                  <th className="py-3 px-4 font-semibold">Status Soal</th>
                  <th className="py-3 px-4 font-semibold">Kelengkapan</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.key} className="border-b border-slate-50 last:border-0">
                    <td className="py-3 px-4 align-top">
                      <p className="font-semibold text-slate-900">{r.namaMapel}</p>
                      <p className="text-slate-400 text-xs mt-0.5">Kelas {r.namaKelas}</p>
                    </td>
                    <td className="py-3 px-4 align-top">
                      <div className="flex flex-col gap-1.5">
                        {r.pg && (
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-slate-400 w-10 flex-shrink-0">PG</span>
                            <StatusBadge status={r.pg.status} />
                          </div>
                        )}
                        {r.essay && (
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-slate-400 w-10 flex-shrink-0">Essay</span>
                            <StatusBadge status={r.essay.status} />
                          </div>
                        )}
                      </div>
                    </td>
                    <td className="py-3 px-4 align-top">
                      {r.pg && r.essay ? (
                        <Badge variant="green" dot>PG &amp; Essay lengkap</Badge>
                      ) : r.pg ? (
                        <Badge variant="yellow" dot>Hanya PG</Badge>
                      ) : (
                        <Badge variant="yellow" dot>Hanya Essay</Badge>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

export default function GuruBuatSoalPage() {
  const [kind, setKind] = useState<Kind>('choice')
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null)
  const showToast = (msg: string, type: 'success' | 'error' = 'success') => setToast({ msg, type })

  // ── Ringkasan jumlah mapel & soal (PG dan Essay) untuk kartu pilihan ──────
  const [ringkasanPg, setRingkasanPg] = useState<RingkasanSoal | null>(null)
  const [ringkasanEssay, setRingkasanEssay] = useState<RingkasanSoal | null>(null)
  const [loadingRingkasan, setLoadingRingkasan] = useState(true)

  // ── Efek "kartu membesar & menggeser kartu lain saat di-hover" (hanya
  // berlaku di layar sm ke atas yang punya kursor mouse — di HP/touchscreen
  // kartu tetap statis berdampingan seperti biasa, tap langsung memicu
  // onClick). Dipakai flex-grow/shrink (bukan transform:scale) supaya kartu
  // yang di-hover benar-benar MELEBAR dan "mendorong" kartu di sebelahnya
  // sampai mengecil — bukan cuma membesar di tempat:
  //   - Kartu pinggir (PG atau Informasi) di-hover → kartu itu melebar ke
  //     arah dua kartu lainnya, dan keduanya mengecil.
  //   - Kartu tengah (Essay) di-hover → melebar simetris ke kiri & kanan,
  //     mendorong kartu kiri DAN kartu kanan supaya sama-sama mengecil.
  // Efek "mendorong" ini didapat gratis dari flexbox: karena ketiga kartu
  // berada dalam satu baris flex dengan lebar total tetap, menambah
  // flex-grow salah satu otomatis mengambil ruang dari kartu lain di kiri
  // maupun kanannya — sama sekali beda dari transform:scale yang cuma
  // membesar di tempat tanpa memengaruhi lebar kartu tetangga.
  //
  // Supaya kartu yang menyempit terasa benar-benar "mengecil" (bukan cuma
  // isinya keremuk/wrap di ruang sempit), kartu yang bukan sedang di-hover
  // juga diberi padding & tinggi minimum yang lebih kecil (lewat isShrunk
  // di bawah) dan konten sekundernya (deskripsi + ringkasan jumlah soal)
  // langsung disembunyikan — cuma ikon, judul, dan tombol CTA yang tetap
  // tampil supaya kartu tetap terbaca & tetap bisa diklik. Konten lengkap
  // itu hanya muncul lagi begitu kartunya membesar (di-hover atau saat
  // tidak ada kartu manapun yang di-hover).
  const [hoverKind, setHoverKind] = useState<'pg' | 'essay' | 'info' | null>(null)
  function kartuFlexClass(mine: 'pg' | 'essay' | 'info') {
    if (hoverKind === mine) return 'sm:flex-[2.2] sm:z-10 sm:shadow-card-lg'
    if (hoverKind !== null) return 'sm:flex-[0.55] sm:opacity-80'
    return 'sm:flex-1'
  }
  function isShrunk(mine: 'pg' | 'essay' | 'info') {
    return hoverKind !== null && hoverKind !== mine
  }

  useEffect(() => {
    if (kind !== 'choice') return
    let batal = false
    setLoadingRingkasan(true)
    Promise.all([
      apiRequest<{ data: PaketSoal[] }>('/api/guru/paket'),
      apiRequest<{ data: PaketEssay[] }>('/api/guru/paket-essay'),
    ])
      .then(([pg, essay]) => {
        if (batal) return
        setRingkasanPg(agregasiRingkasan(pg.data ?? []))
        setRingkasanEssay(agregasiRingkasan(essay.data ?? []))
      })
      .catch(() => { /* ringkasan bersifat pelengkap — gagal diam-diam, kartu tetap bisa dipakai seperti biasa */ })
      .finally(() => { if (!batal) setLoadingRingkasan(false) })
    return () => { batal = true }
  }, [kind])

  // FIX (kehilangan progres tanpa peringatan): layar PG/Essay di halaman ini
  // adalah "layar semu" lewat state lokal (`kind`), bukan route URL asli —
  // artinya refresh atau menutup tab di tengah proses akan membuang isian
  // form tanpa peringatan apa pun. Ini TIDAK mengubah alur/logika penyimpanan
  // (soal yang sudah ditekan "Simpan" tetap tersimpan seperti biasa di
  // database) — ini hanya menambah peringatan browser standar saat guru
  // sedang di tengah layar PG/Essay dan mencoba menutup/refresh tab, supaya
  // isian yang BELUM ditekan simpan tidak hilang tanpa sadar.
  useEffect(() => {
    if (kind === 'choice') return
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [kind])

  // FIX (hapus bobot "global"): kartu "Nilai Awal Bobot PG:Essay" di layar
  // pilihan ini DIHAPUS atas permintaan eksplisit — nilainya cuma pengisi
  // otomatis form (tidak pernah tersimpan ke server) dan justru menambah
  // kebingungan karena terlihat seperti pengaturan permanen. Bobot yang
  // SUNGGUHAN berlaku tetap ada & tidak berubah sama sekali: diisi per
  // mapel+kelas di form "Buat Paket Soal Essay" (EssaySoalFlow di bawah),
  // tersimpan ke kolom bobot_pg_persen/bobot_essay_persen tabel
  // paket_essay (lihat 09_bobot_paket_essay.sql). EssaySoalFlow sekarang
  // memakai default 50:50 sendiri (lihat setupBobotPg/setupBobotEssay di
  // EssaySoalFlow), sama seperti sebelum kartu ini pernah ada.
  if (kind === 'pg') return <PgSoalFlow onBack={() => setKind('choice')} />
  if (kind === 'essay') return <EssaySoalFlow onBack={() => setKind('choice')} />
  if (kind === 'info') return <InfoPaketSoalFlow onBack={() => setKind('choice')} />

  return (
    <div className="space-y-6 animate-fade-in">
      {toast && <Toast message={toast.msg} type={toast.type} onClose={() => setToast(null)} />}

      <div>
        <h1 className="page-title">Buat Soal</h1>
        <p className="page-subtitle">Pilih jenis soal yang ingin dibuat</p>
      </div>

      <div className="max-w-4xl mx-auto space-y-4">
        {/* UX FIX (guru tidak sadar kartu ini bisa diklik): sebelumnya kartu
            ini gradient penuh dengan CTA berupa teks+panah tipis di bagian
            bawah — dari jauh terlihat seperti banner informasi, bukan tombol.
            Sekarang badan kartu dibuat netral (putih) dan hanya elemen di
            bagian bawah yang berwarna solid, berbentuk pil, dengan ikon —
            supaya bentuknya langsung terbaca sebagai TOMBOL yang bisa
            ditekan, bukan dekorasi. Teks penjelas juga dipangkas jadi satu
            kalimat pendek per kartu. */}
        {/* Kartu berdampingan pakai flex (bukan grid) supaya lebar tiap
            kartu bisa "ditarik-ulur" secara dinamis lewat kartuFlexClass()
            saat di-hover — grid-template-columns tidak bisa dianimasikan
            semulus flex-grow, dan efek "mendorong kartu tetangga" (lihat
            komentar di kartuFlexClass) cuma bisa didapat dari flexbox.
            items-stretch supaya tinggi kartu tetap sama walau salah satu
            kontennya (ringkasan mapel) lebih pendek dari yang lain. */}
        <div className="flex flex-col sm:flex-row gap-5 items-stretch">
          <button
            onClick={() => setKind('pg')}
            onMouseEnter={() => setHoverKind('pg')}
            onMouseLeave={() => setHoverKind(null)}
            onFocus={() => setHoverKind('pg')}
            onBlur={() => setHoverKind(null)}
            className={`group relative text-left rounded-3xl sm:min-w-0 flex flex-col
                       bg-white border-2 border-slate-200 hover:border-brand-400
                       shadow-card hover:-translate-y-0.5 active:translate-y-0
                       transition-all duration-300 ease-out p-7 min-h-[220px]
                       ${isShrunk('pg') ? 'sm:p-4 sm:min-h-[120px] sm:items-center sm:text-center' : ''}
                       ${kartuFlexClass('pg')}`}
          >
            <div className={`w-14 h-14 rounded-2xl bg-brand-50 text-brand-600 flex items-center justify-center
                             ${isShrunk('pg') ? 'sm:mb-0' : 'mb-5'}`}>
              <ListChecks className="w-7 h-7" />
            </div>
            <h2 className={`text-xl font-bold text-slate-900 ${isShrunk('pg') ? 'sm:mb-0 sm:mt-2' : 'mb-1.5'}`}>Soal PG</h2>
            {!isShrunk('pg') && (
              <>
                <p className="text-slate-500 text-sm leading-relaxed">
                  Sistem menilai otomatis begitu siswa selesai mengerjakan.
                </p>
                <RingkasanSoalCard ringkasan={ringkasanPg} loading={loadingRingkasan} />
              </>
            )}
            <div className="mt-auto pt-6">
              <span className="inline-flex items-center gap-2 rounded-full bg-brand-600 group-hover:bg-brand-700
                               text-white text-sm font-semibold px-5 py-2.5 transition-colors">
                <Plus className="w-4 h-4" /> Buat Soal PG
              </span>
            </div>
          </button>

          <button
            onClick={() => setKind('essay')}
            onMouseEnter={() => setHoverKind('essay')}
            onMouseLeave={() => setHoverKind(null)}
            onFocus={() => setHoverKind('essay')}
            onBlur={() => setHoverKind(null)}
            className={`group relative text-left rounded-3xl sm:min-w-0 flex flex-col
                       bg-white border-2 border-slate-200 hover:border-emerald-400
                       shadow-card hover:-translate-y-0.5 active:translate-y-0
                       transition-all duration-300 ease-out p-7 min-h-[220px]
                       ${isShrunk('essay') ? 'sm:p-4 sm:min-h-[120px] sm:items-center sm:text-center' : ''}
                       ${kartuFlexClass('essay')}`}
          >
            <div className={`w-14 h-14 rounded-2xl bg-emerald-50 text-emerald-600 flex items-center justify-center
                             ${isShrunk('essay') ? 'sm:mb-0' : 'mb-5'}`}>
              <PenSquare className="w-7 h-7" />
            </div>
            <h2 className={`text-xl font-bold text-slate-900 ${isShrunk('essay') ? 'sm:mb-0 sm:mt-2' : 'mb-1.5'}`}>Soal Essay</h2>
            {!isShrunk('essay') && (
              <>
                <p className="text-slate-500 text-sm leading-relaxed">
                  Dinilai manual oleh Anda setelah siswa mengumpulkan jawaban.
                </p>
                <RingkasanSoalCard ringkasan={ringkasanEssay} loading={loadingRingkasan} />
              </>
            )}
            <div className="mt-auto pt-6">
              <span className="inline-flex items-center gap-2 rounded-full bg-emerald-600 group-hover:bg-emerald-700
                               text-white text-sm font-semibold px-5 py-2.5 transition-colors">
                <Plus className="w-4 h-4" /> Buat Soal Essay
              </span>
            </div>
          </button>

          {/* Kartu ke-3: bukan alur "buat" — murni ringkasan informasi supaya
              guru bisa cek sekilas mapel+kelas mana yang statusnya masih
              Draft/Menunggu dan mana yang belum lengkap (baru ada PG saja
              atau Essay saja) tanpa harus buka dua kartu di atas satu-satu. */}
          <button
            onClick={() => setKind('info')}
            onMouseEnter={() => setHoverKind('info')}
            onMouseLeave={() => setHoverKind(null)}
            onFocus={() => setHoverKind('info')}
            onBlur={() => setHoverKind(null)}
            className={`group relative text-left rounded-3xl sm:min-w-0 flex flex-col
                       bg-white border-2 border-slate-200 hover:border-indigo-400
                       shadow-card hover:-translate-y-0.5 active:translate-y-0
                       transition-all duration-300 ease-out p-7 min-h-[220px]
                       ${isShrunk('info') ? 'sm:p-4 sm:min-h-[120px] sm:items-center sm:text-center' : ''}
                       ${kartuFlexClass('info')}`}
          >
            <div className={`w-14 h-14 rounded-2xl bg-indigo-50 text-indigo-600 flex items-center justify-center
                             ${isShrunk('info') ? 'sm:mb-0' : 'mb-5'}`}>
              <Info className="w-7 h-7" />
            </div>
            <h2 className={`text-xl font-bold text-slate-900 ${isShrunk('info') ? 'sm:mb-0 sm:mt-2' : 'mb-1.5'}`}>Informasi Paket Soal</h2>
            {!isShrunk('info') && (
              <p className="text-slate-500 text-sm leading-relaxed">
                Nama mapel & kelas, status soal, serta kelengkapan PG dan Essay dalam satu tabel.
              </p>
            )}
            <div className="mt-auto pt-6">
              <span className="inline-flex items-center gap-2 rounded-full bg-indigo-600 group-hover:bg-indigo-700
                               text-white text-sm font-semibold px-5 py-2.5 transition-colors">
                <ChevronRight className="w-4 h-4" /> Lihat Informasi
              </span>
            </div>
          </button>
        </div>
      </div>
    </div>
  )
}
