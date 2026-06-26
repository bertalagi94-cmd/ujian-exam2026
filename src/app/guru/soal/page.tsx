'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import {
  Pencil, Trash2, Eye, Lock, ImagePlus, X, BookOpen, Plus,
  Send, ChevronDown, ChevronUp, Copy, CheckCircle2, RotateCcw
} from 'lucide-react'
import { Modal, Confirm, StatusBadge, EmptyState, Spinner, Toast } from '@/components/ui'
import { apiRequest, formatDateTime } from '@/lib/utils'
import { PaketSoal, Soal, Kelas } from '@/types'

// ── Konstanta ────────────────────────────────────────────────────
const SYNC_EVENT = 'guru-paket-updated'
const opsiLabels = ['A', 'B', 'C', 'D', 'E']

// ── Tipe lokal ───────────────────────────────────────────────────
interface SoalWithImg extends Soal {
  gambar_pertanyaan?: string
  gambar_opsi_a?: string; gambar_opsi_b?: string
  gambar_opsi_c?: string; gambar_opsi_d?: string; gambar_opsi_e?: string
  gambar_a?: string; gambar_b?: string; gambar_c?: string
  gambar_d?: string; gambar_e?: string
}

// ── Helper ───────────────────────────────────────────────────────
function getImgPertanyaan(s: SoalWithImg) {
  return s.gambar_pertanyaan || (s as unknown as Record<string, string>).gambar_url || ''
}
function getImgOpsi(s: SoalWithImg, l: string) {
  const sr = s as unknown as Record<string, string>
  return sr[`gambar_opsi_${l}`] || sr[`gambar_${l}`] || ''
}

// ── Komponen form edit soal (dipakai di dua tempat) ──────────────
function EditSoalForm({
  formId, soal, jumlahOpsi,
  imgPertanyaan, setImgPertanyaan,
  imgOpsi, setImgOpsi,
  onSubmit, uploadingImg, onTriggerUpload,
}: {
  formId: string
  soal: SoalWithImg
  jumlahOpsi: number
  imgPertanyaan: string
  setImgPertanyaan: (s: string) => void
  imgOpsi: Record<string, string>
  setImgOpsi: (fn: (prev: Record<string, string>) => Record<string, string>) => void
  onSubmit: (e: React.FormEvent<HTMLFormElement>) => void
  uploadingImg: string | null
  onTriggerUpload: (key: string) => void
}) {
  return (
    <form id={formId} onSubmit={onSubmit} className="space-y-4">
      <div>
        <label className="label">Teks Pertanyaan *</label>
        <textarea name="teks" className="textarea" rows={3} required
          placeholder="Tulis pertanyaan di sini..." defaultValue={soal.teks ?? ''} />
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
            <button type="button" onClick={() => onTriggerUpload('pertanyaan')}
              className="btn-secondary btn-sm text-xs" disabled={!!uploadingImg}>
              {uploadingImg === 'pertanyaan' ? <Spinner size="sm" /> : <><ImagePlus className="w-3.5 h-3.5" /> Tambah Gambar</>}
            </button>
          )}
        </div>
      </div>

      {/* FIX: dropdown "Jumlah Opsi" dihilangkan dari sini — jumlah opsi
          jawaban (4 atau 5) sekarang sepenuhnya ditentukan otomatis dari
          Pengaturan Ujian di akun Admin, bukan dipilih manual per soal oleh guru. */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="label">Tingkat Kesulitan</label>
          <select name="tingkat" className="select" defaultValue={soal.tingkat ?? 'Sedang'}>
            <option>Mudah</option><option>Sedang</option><option>Sulit</option>
          </select>
        </div>
        <div>
          <label className="label">Kunci Jawaban *</label>
          <select name="kunci" className="select" required defaultValue={soal.kunci ?? ''}>
            {!soal.kunci && <option value="" disabled>Pilih Kunci Jawaban</option>}
            {opsiLabels.slice(0, jumlahOpsi).map(l => <option key={l} value={l}>{l}</option>)}
          </select>
        </div>
      </div>

      <div className="space-y-2">
        <label className="label">Opsi Jawaban</label>
        {opsiLabels.slice(0, jumlahOpsi).map(label => {
          const lk = label.toLowerCase()
          const defaultVal = (soal as unknown as Record<string, string>)[`opsi_${lk}`] ?? ''
          return (
            <div key={label} className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="w-7 h-7 rounded-lg bg-slate-100 text-slate-600 font-bold text-xs flex items-center justify-center flex-shrink-0">{label}</span>
                <input name={`opsi_${lk}`} className="input" placeholder={`Opsi ${label}`} required defaultValue={defaultVal} />
                <button type="button" onClick={() => onTriggerUpload(lk)}
                  className="btn-ghost btn-icon btn-sm text-slate-500 flex-shrink-0" disabled={!!uploadingImg}>
                  {uploadingImg === lk ? <Spinner size="sm" /> : <ImagePlus className="w-3.5 h-3.5" />}
                </button>
              </div>
              {imgOpsi[lk] && (
                <div className="ml-9 relative inline-block">
                  <img src={imgOpsi[lk]} alt={`Gambar opsi ${label}`} className="max-h-20 rounded border border-slate-200" />
                  <button type="button" onClick={() => setImgOpsi(prev => { const n = { ...prev }; delete n[lk]; return n })}
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
          defaultValue={soal.pembahasan ?? ''} />
      </div>
    </form>
  )
}

// ── Komponen modal view soal (read-only) ─────────────────────────
function ViewSoalModal({ soal, onClose }: { soal: SoalWithImg | null; onClose: () => void }) {
  if (!soal) return null
  return (
    <Modal open={!!soal} onClose={onClose} title="Detail Soal" size="xl">
      <div className="space-y-4">
        <div className="alert-info text-xs flex items-center gap-2">
          <Lock className="w-3.5 h-3.5 flex-shrink-0" />
          Soal ini sudah dikirim/disetujui — hanya bisa dilihat, tidak bisa diedit atau dihapus.
        </div>
        <div>
          <p className="label mb-1">Pertanyaan</p>
          <p className="text-sm text-slate-800 leading-relaxed">{soal.teks}</p>
          {getImgPertanyaan(soal) && (
            <img src={getImgPertanyaan(soal)} alt="Gambar pertanyaan" className="mt-2 max-h-48 rounded-lg border border-slate-200" />
          )}
        </div>
        <div className="space-y-1.5">
          <p className="label mb-1">Pilihan Jawaban</p>
          {opsiLabels.slice(0, soal.jumlah_opsi || 4).map(l => {
            const lk = l.toLowerCase()
            const opsiText = (soal as unknown as Record<string, string>)[`opsi_${lk}`]
            const opsiImg = getImgOpsi(soal, lk)
            const isKunci = soal.kunci === l
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
        {soal.pembahasan && (
          <div>
            <p className="label mb-1">Pembahasan</p>
            <p className="text-sm text-slate-700">{soal.pembahasan}</p>
          </div>
        )}
      </div>
    </Modal>
  )
}

// ── Form tambah soal baru ────────────────────────────────────────
function TambahSoalForm({
  nomorUrut, onTambah, saving, uploadingImg, onTriggerUpload,
  imgPertanyaan, setImgPertanyaan, imgOpsi, setImgOpsi,
  jumlahOpsi, formRef,
}: {
  nomorUrut: number
  onTambah: (e: React.FormEvent<HTMLFormElement>) => void
  saving: boolean
  uploadingImg: string | null
  onTriggerUpload: (key: string) => void
  imgPertanyaan: string
  setImgPertanyaan: (s: string) => void
  imgOpsi: Record<string, string>
  setImgOpsi: (fn: (prev: Record<string, string>) => Record<string, string>) => void
  jumlahOpsi: number
  formRef: React.RefObject<HTMLFormElement>
}) {
  return (
    <div className="card">
      <div className="flex items-center gap-2 mb-4">
        <span className="w-8 h-8 rounded-full bg-brand-600 text-white font-bold text-sm flex items-center justify-center flex-shrink-0">
          {nomorUrut}
        </span>
        <h2 className="font-semibold text-slate-800">Soal ke-{nomorUrut}</h2>
      </div>
      <form ref={formRef} onSubmit={onTambah} className="space-y-4">
        <div>
          <label className="label">Teks Pertanyaan *</label>
          <textarea name="teks" className="textarea" rows={3} required placeholder="Tulis pertanyaan di sini..." />
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
              <button type="button" onClick={() => onTriggerUpload('tambah_pertanyaan')}
                className="btn-secondary btn-sm text-xs" disabled={!!uploadingImg}>
                {uploadingImg === 'tambah_pertanyaan' ? <Spinner size="sm" /> : <><ImagePlus className="w-3.5 h-3.5" /> Tambah Gambar</>}
              </button>
            )}
          </div>
        </div>
        {/* FIX: dropdown "Jumlah Opsi" dihilangkan — jumlah opsi jawaban
            (4 atau 5) sekarang otomatis mengikuti Pengaturan Ujian di akun
            Admin, bukan dipilih manual oleh guru per soal. */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="label">Tingkat Kesulitan</label>
            <select name="tingkat" className="select" defaultValue="Sedang">
              <option>Mudah</option><option>Sedang</option><option>Sulit</option>
            </select>
          </div>
          <div>
            <label className="label">Kunci Jawaban *</label>
            <select name="kunci" className="select" required defaultValue="">
              <option value="" disabled>Pilih Kunci Jawaban</option>
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
                  <button type="button" onClick={() => onTriggerUpload(`tambah_${lk}`)}
                    className="btn-ghost btn-icon btn-sm text-slate-500 flex-shrink-0" disabled={!!uploadingImg}>
                    {uploadingImg === `tambah_${lk}` ? <Spinner size="sm" /> : <ImagePlus className="w-3.5 h-3.5" />}
                  </button>
                </div>
                {imgOpsi[lk] && (
                  <div className="ml-9 relative inline-block">
                    <img src={imgOpsi[lk]} alt={`Gambar opsi ${label}`} className="max-h-20 rounded border border-slate-200" />
                    <button type="button" onClick={() => setImgOpsi(prev => { const n = { ...prev }; delete n[lk]; return n })}
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
        <div className="flex gap-3 pt-2">
          <button type="submit" className="btn-primary" disabled={saving || !!uploadingImg}>
            {saving ? <Spinner size="sm" /> : <><Plus className="w-4 h-4" /> Simpan & Lanjut ke Soal Berikutnya</>}
          </button>
        </div>
      </form>
    </div>
  )
}

// ── Halaman utama Bank Soal ──────────────────────────────────────
export default function GuruBankSoalPage() {
  const [pakets, setPakets] = useState<PaketSoal[]>([])
  const [allKelas, setAllKelas] = useState<Kelas[]>([])
  const [loading, setLoading] = useState(true)
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null)

  // Expand / soal per paket
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [soalMap, setSoalMap] = useState<Record<string, SoalWithImg[]>>({})
  const [loadingSoal, setLoadingSoal] = useState(false)

  // Mode tambah soal (tambah ke paket yang sudah ada)
  const [addingToId, setAddingToId] = useState<string | null>(null)
  const [tambahImgPertanyaan, setTambahImgPertanyaan] = useState('')
  const [tambahImgOpsi, setTambahImgOpsi] = useState<Record<string, string>>({})
  const tambahFormRef = useRef<HTMLFormElement>(null)

  // FIX: jumlah opsi jawaban (4/5) tidak lagi dipilih manual oleh guru per
  // soal — sekarang otomatis mengikuti Pengaturan Ujian yang ditentukan
  // admin (key "jumlahOpsi"). Dipakai untuk soal BARU yang ditambahkan.
  const [globalJumlahOpsi, setGlobalJumlahOpsi] = useState(4)

  // Edit soal
  const [editSoal, setEditSoal] = useState<SoalWithImg | null>(null)
  const [editImgPertanyaan, setEditImgPertanyaan] = useState('')
  const [editImgOpsi, setEditImgOpsi] = useState<Record<string, string>>({})
  const editFileRef = useRef<HTMLInputElement>(null)
  const [pendingEditKey, setPendingEditKey] = useState<string | null>(null)

  // View soal (read-only)
  const [viewSoal, setViewSoal] = useState<SoalWithImg | null>(null)

  // Upload gambar (tambah soal)
  const tambahFileRef = useRef<HTMLInputElement>(null)
  const [pendingTambahKey, setPendingTambahKey] = useState<string | null>(null)
  const [uploadingImg, setUploadingImg] = useState<string | null>(null)

  // Kirim & tarik
  const [kirimId, setKirimId] = useState<string | null>(null)
  const [tarikId, setTarikId] = useState<string | null>(null)

  // Hapus soal
  const [deleteSoalId, setDeleteSoalId] = useState<string | null>(null)
  const [deleteSoalPaketId, setDeleteSoalPaketId] = useState<string | null>(null)

  // Duplicate
  const [dupId, setDupId] = useState<string | null>(null)
  const [dupKelas, setDupKelas] = useState('')

  // Hapus paket
  const [hapusPaketId, setHapusPaketId] = useState<string | null>(null)

  const [saving, setSaving] = useState(false)

  const showToast = (msg: string, type: 'success' | 'error' = 'success') => setToast({ msg, type })

  // ── Fetch paket ────────────────────────────────────────────────
  const loadPakets = useCallback(async () => {
    setLoading(true)
    try {
      const res = await apiRequest<{ data: PaketSoal[] }>('/api/guru/paket')
      setPakets(res.data ?? [])
    } finally { setLoading(false) }
  }, [])

  useEffect(() => { loadPakets() }, [loadPakets])

  // ── Fetch kelas (untuk dropdown duplicate) ─────────────────────
  useEffect(() => {
    apiRequest<{ data: Kelas[] }>('/api/admin/kelas')
      .then(r => setAllKelas(r.data ?? []))
      .catch(() => { })
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

  // ── Sinkronisasi dengan menu Buat Soal ─────────────────────────
  useEffect(() => {
    const handler = () => loadPakets()
    window.addEventListener(SYNC_EVENT, handler)
    return () => window.removeEventListener(SYNC_EVENT, handler)
  }, [loadPakets])

  // ── Fetch soal per paket ───────────────────────────────────────
  async function loadSoalPaket(paketId: string) {
    setLoadingSoal(true)
    try {
      const res = await apiRequest<{ data: SoalWithImg[] }>(`/api/guru/paket/${paketId}/soal`)
      setSoalMap(prev => ({ ...prev, [paketId]: res.data ?? [] }))
      return res.data ?? []
    } catch {
      setSoalMap(prev => ({ ...prev, [paketId]: [] }))
      return []
    } finally { setLoadingSoal(false) }
  }

  function toggleExpand(paketId: string) {
    if (expandedId === paketId) {
      setExpandedId(null)
      setAddingToId(null)
    } else {
      setExpandedId(paketId)
      loadSoalPaket(paketId)
    }
  }

  // ── Upload gambar ──────────────────────────────────────────────
  async function uploadImage(key: string, file: File, target: 'tambah' | 'edit') {
    const uploadKey = target === 'tambah' ? `tambah_${key}` : key
    setUploadingImg(uploadKey)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const token = localStorage.getItem('token')
      const res = await fetch('/api/guru/soal/upload', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: fd,
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Upload gagal')
      if (target === 'tambah') {
        if (key === 'pertanyaan') setTambahImgPertanyaan(data.url)
        else setTambahImgOpsi(prev => ({ ...prev, [key]: data.url }))
      } else {
        if (key === 'pertanyaan') setEditImgPertanyaan(data.url)
        else setEditImgOpsi(prev => ({ ...prev, [key]: data.url }))
      }
    } catch (e: unknown) {
      showToast(e instanceof Error ? e.message : 'Upload gambar gagal', 'error')
    } finally { setUploadingImg(null) }
  }

  function handleTambahFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file || !pendingTambahKey) return
    // key 'tambah_pertanyaan' → 'pertanyaan'; 'tambah_a' → 'a'
    const key = pendingTambahKey.replace('tambah_', '')
    uploadImage(key, file, 'tambah')
    e.target.value = ''
  }

  function handleEditFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file || !pendingEditKey) return
    uploadImage(pendingEditKey, file, 'edit')
    e.target.value = ''
  }

  function triggerTambahUpload(key: string) {
    setPendingTambahKey(key)
    setTimeout(() => tambahFileRef.current?.click(), 50)
  }

  function triggerEditUpload(key: string) {
    setPendingEditKey(key)
    setTimeout(() => editFileRef.current?.click(), 50)
  }

  // ── Tambah soal ke paket existing ─────────────────────────────
  async function handleTambahSoal(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!addingToId) return
    const paket = pakets.find(p => p.id === addingToId)
    if (!paket) return
    const fd = new FormData(e.currentTarget)
    const payload: Record<string, unknown> = Object.fromEntries(fd.entries())
    payload.jumlah_opsi = String(globalJumlahOpsi)
    payload.mapel_id = paket.mapel_id
    payload.kelas_id = paket.kelas_id
    payload.paket_id = paket.id
    payload.gambar_pertanyaan = tambahImgPertanyaan || null
    for (const l of ['a', 'b', 'c', 'd', 'e']) {
      payload[`gambar_opsi_${l}`] = tambahImgOpsi[l] || null
    }
    setSaving(true)
    try {
      await apiRequest('/api/guru/soal', { method: 'POST', body: JSON.stringify(payload) })
      const soalList = soalMap[addingToId] ?? []
      showToast(`Soal ke-${soalList.length + 1} berhasil ditambahkan`)
      tambahFormRef.current?.reset()
      setTambahImgPertanyaan('')
      setTambahImgOpsi({})
      // Refresh soal dalam paket & jumlah di header
      await loadSoalPaket(addingToId)
      const updated = await apiRequest<{ data: PaketSoal[] }>('/api/guru/paket')
      setPakets(updated.data ?? [])
      // Beritahu menu Buat Soal
      window.dispatchEvent(new Event(SYNC_EVENT))
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Gagal menyimpan soal', 'error')
    } finally { setSaving(false) }
  }

  // ── Edit soal ─────────────────────────────────────────────────
  function openEdit(s: SoalWithImg) {
    setEditSoal(s)
    setEditImgPertanyaan(getImgPertanyaan(s))
    const imgs: Record<string, string> = {}
    for (const l of ['a', 'b', 'c', 'd', 'e']) {
      const v = getImgOpsi(s, l)
      if (v) imgs[l] = v
    }
    setEditImgOpsi(imgs)
  }

  async function handleSaveEdit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!editSoal?.id) return
    const fd = new FormData(e.currentTarget)
    const payload: Record<string, unknown> = Object.fromEntries(fd.entries())
    payload.jumlah_opsi = String(editSoal.jumlah_opsi || 4)
    payload.gambar_pertanyaan = editImgPertanyaan || null
    for (const l of ['a', 'b', 'c', 'd', 'e']) {
      payload[`gambar_opsi_${l}`] = editImgOpsi[l] || null
    }
    setSaving(true)
    try {
      await apiRequest(`/api/guru/soal/${editSoal.id}`, { method: 'PUT', body: JSON.stringify(payload) })
      showToast('Soal berhasil diperbarui')
      setEditSoal(null)
      if (editSoal.paket_id) await loadSoalPaket(editSoal.paket_id as string)
      window.dispatchEvent(new Event(SYNC_EVENT))
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Gagal menyimpan', 'error')
    } finally { setSaving(false) }
  }

  // ── Hapus soal ────────────────────────────────────────────────
  async function handleDeleteSoal() {
    if (!deleteSoalId || !deleteSoalPaketId) return
    setSaving(true)
    try {
      await apiRequest(`/api/guru/soal/${deleteSoalId}`, { method: 'DELETE' })
      showToast('Soal berhasil dihapus')
      setDeleteSoalId(null)
      await loadSoalPaket(deleteSoalPaketId)
      const updated = await apiRequest<{ data: PaketSoal[] }>('/api/guru/paket')
      setPakets(updated.data ?? [])
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
      await apiRequest(`/api/guru/paket/${kirimId}/kirim`, { method: 'POST' })
      showToast('Paket berhasil dikirim untuk validasi')
      setKirimId(null)
      // Refresh soal agar status berubah
      if (expandedId === kirimId) await loadSoalPaket(kirimId)
      await loadPakets()
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
      await loadPakets()
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
      await loadPakets()
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
      await loadPakets()
      window.dispatchEvent(new Event(SYNC_EVENT))
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Gagal menghapus paket', 'error')
    } finally { setSaving(false) }
  }

  const isEditable = (status: string) => ['DRAFT', 'DITOLAK'].includes(status)
  const getNamaKelas = (id: string) => allKelas.find(k => k.id === id)?.nama ?? id

  // ── Render daftar soal dalam expand ───────────────────────────
  function renderSoalList(soalList: SoalWithImg[], paket: PaketSoal) {
    if (soalList.length === 0) {
      return <p className="text-xs text-slate-400 text-center py-4">Belum ada soal dalam paket ini</p>
    }
    return soalList.map((s, i) => (
      <div key={s.id || i} className="flex items-start gap-2 text-sm text-slate-700 bg-white rounded-lg px-3 py-2.5 border border-slate-100">
        <span className="w-6 h-6 rounded-full bg-brand-100 text-brand-700 font-bold text-xs flex items-center justify-center flex-shrink-0 mt-0.5">
          {i + 1}
        </span>
        <div className="flex-1 min-w-0">
          <p className="line-clamp-2">{s.teks}</p>
          {getImgPertanyaan(s) && <span className="text-xs text-brand-500">📷 Ada gambar</span>}
        </div>
        <span className="text-xs text-slate-400 flex-shrink-0">Kunci: {s.kunci}</span>
        <div className="flex items-center gap-1 flex-shrink-0">
          {isEditable(s.status ?? paket.status) && s.id ? (
            <>
              <button onClick={() => openEdit(s)} className="btn-ghost btn-icon btn-sm text-blue-600 hover:bg-blue-50" title="Edit soal">
                <Pencil className="w-3.5 h-3.5" />
              </button>
              <button onClick={() => { setDeleteSoalId(s.id); setDeleteSoalPaketId(paket.id) }}
                className="btn-ghost btn-icon btn-sm text-red-600 hover:bg-red-50" title="Hapus soal">
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

  // ── Kelas yang bisa dipilih untuk duplicate (bukan kelas sendiri) ──
  function getKelasUntukDuplicate(paketId: string) {
    const paket = pakets.find(p => p.id === paketId)
    if (!paket) return allKelas
    return allKelas.filter(k => k.id !== paket.kelas_id)
  }

  // ── Render ─────────────────────────────────────────────────────
  return (
    <div className="space-y-6 animate-fade-in">
      {toast && <Toast message={toast.msg} type={toast.type} onClose={() => setToast(null)} />}

      {/* Hidden file inputs */}
      <input ref={tambahFileRef} type="file" accept="image/*" className="hidden" onChange={handleTambahFileChange} />
      <input ref={editFileRef} type="file" accept="image/*" className="hidden" onChange={handleEditFileChange} />

      {/* Header */}
      <div>
        <h1 className="page-title">Bank Soal</h1>
        <p className="page-subtitle">Lihat, edit, tambah soal, dan kirim paket ke admin · Soal dibuat dari menu <strong>Buat Soal</strong></p>
      </div>

      {/* Daftar paket */}
      {loading ? (
        <div className="flex justify-center py-20"><Spinner size="lg" /></div>
      ) : pakets.length === 0 ? (
        <div className="card">
          <EmptyState message="Belum ada soal. Buat soal terlebih dahulu melalui menu Buat Soal." />
        </div>
      ) : (
        <div className="space-y-3">
          {pakets.map(p => {
            const soalList = soalMap[p.id] ?? []
            const isOpen = expandedId === p.id
            const canEdit = isEditable(p.status)

            return (
              <div key={p.id} className="card p-0 overflow-hidden">
                {/* Header paket */}
                <div className="flex items-center gap-4 p-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-slate-900">{p.nama_mapel ?? p.mapel_id}</span>
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
                    {p.status === 'MENUNGGU' && p.catatan && (
                      <div className="mt-1 text-xs text-amber-600">Persetujuan dibatalkan admin — klik <strong>Tarik</strong> untuk mengedit soal lalu kirim ulang</div>
                    )}
                  </div>

                  {/* Tombol aksi paket */}
                  <div className="flex items-center gap-2 flex-shrink-0 flex-wrap justify-end">
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

                    {/* Expand */}
                    <button onClick={() => toggleExpand(p.id)} className="btn-ghost btn-icon btn-sm">
                      {isOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                {/* Expand: daftar soal + tambah soal */}
                {isOpen && (
                  <div className="border-t border-slate-100 bg-slate-50">
                    {/* Daftar soal */}
                    <div className="p-4 space-y-2">
                      {loadingSoal && soalList.length === 0
                        ? <div className="flex justify-center py-4"><Spinner size="sm" /></div>
                        : renderSoalList(soalList, p)
                      }
                    </div>

                    {/* Tombol tambah soal (hanya jika DRAFT/DITOLAK) */}
                    {canEdit && (
                      addingToId === p.id ? (
                        <div className="px-4 pb-4">
                          <div className="border-t border-slate-200 pt-4">
                            <div className="flex items-center justify-between mb-3">
                              <p className="text-sm font-medium text-slate-700">
                                Tambah Soal ke-{soalList.length + 1}
                              </p>
                              <button onClick={() => {
                                setAddingToId(null)
                                tambahFormRef.current?.reset()
                                setTambahImgPertanyaan('')
                                setTambahImgOpsi({})
                              }} className="btn-ghost btn-sm text-slate-400">
                                <X className="w-3.5 h-3.5" /> Batal Tambah
                              </button>
                            </div>
                            <TambahSoalForm
                              nomorUrut={soalList.length + 1}
                              onTambah={handleTambahSoal}
                              saving={saving}
                              uploadingImg={uploadingImg}
                              onTriggerUpload={triggerTambahUpload}
                              imgPertanyaan={tambahImgPertanyaan}
                              setImgPertanyaan={setTambahImgPertanyaan}
                              imgOpsi={tambahImgOpsi}
                              setImgOpsi={setTambahImgOpsi}
                              jumlahOpsi={globalJumlahOpsi}
                              formRef={tambahFormRef}
                            />
                          </div>
                        </div>
                      ) : (
                        <div className="px-4 pb-4">
                          <button
                            onClick={() => {
                              setAddingToId(p.id)
                              setTambahImgPertanyaan('')
                              setTambahImgOpsi({})
                            }}
                            className="btn-secondary btn-sm w-full"
                          >
                            <Plus className="w-3.5 h-3.5" /> Tambah Soal ke Paket Ini
                          </button>
                        </div>
                      )
                    )}

                    {/* Info jika tidak bisa tambah */}
                    {!canEdit && (
                      <div className="px-4 pb-4">
                        <div className="text-xs text-slate-400 text-center py-2 flex items-center justify-center gap-1.5">
                          <Lock className="w-3 h-3" />
                          {p.status === 'MENUNGGU' ? 'Tarik paket terlebih dahulu untuk menambah atau mengedit soal' : 'Soal tidak bisa diubah setelah disetujui admin'}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Modal Edit Soal */}
      <Modal open={!!editSoal} onClose={() => setEditSoal(null)} title="Edit Soal" size="xl"
        footer={
          <>
            <button onClick={() => setEditSoal(null)} className="btn-secondary" disabled={saving}>Batal</button>
            <button form="edit-soal-form" type="submit" className="btn-primary" disabled={saving || !!uploadingImg}>
              {saving ? <Spinner size="sm" /> : 'Simpan Perubahan'}
            </button>
          </>
        }
      >
        {editSoal && (
          <EditSoalForm
            formId="edit-soal-form"
            soal={editSoal}
            jumlahOpsi={editSoal.jumlah_opsi || 4}
            imgPertanyaan={editImgPertanyaan}
            setImgPertanyaan={setEditImgPertanyaan}
            imgOpsi={editImgOpsi}
            setImgOpsi={setEditImgOpsi}
            onSubmit={handleSaveEdit}
            uploadingImg={uploadingImg}
            onTriggerUpload={triggerEditUpload}
          />
        )}
      </Modal>

      {/* Modal View Soal */}
      <ViewSoalModal soal={viewSoal} onClose={() => setViewSoal(null)} />

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

      {/* Confirm Hapus Soal */}
      <Confirm open={!!deleteSoalId}
        onClose={() => { setDeleteSoalId(null); setDeleteSoalPaketId(null) }}
        onConfirm={handleDeleteSoal}
        title="Hapus Soal"
        message="Soal ini akan dihapus permanen dari paket. Lanjutkan?"
        confirmLabel="Ya, Hapus" loading={saving} />

      {/* Confirm Hapus Paket */}
      <Confirm open={!!hapusPaketId} onClose={() => setHapusPaketId(null)} onConfirm={handleHapusPaket}
        title="Hapus Paket Soal"
        message="Seluruh soal dalam paket ini akan ikut terhapus secara permanen. Tindakan ini tidak bisa dibatalkan. Lanjutkan?"
        confirmLabel="Ya, Hapus Paket" loading={saving} />
    </div>
  )
}
