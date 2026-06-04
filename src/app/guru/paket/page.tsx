'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { Plus, Send, RotateCcw, ChevronDown, ChevronUp, Trash2, ImagePlus, X, Eye, ArrowLeft, CheckCircle2 } from 'lucide-react'
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
  const [mapelList, setMapelList] = useState<Mapel[]>([])
  const [kelasList, setKelasList] = useState<Kelas[]>([])
  const [loading, setLoading] = useState(true)
  const [step, setStep] = useState<Step>('list')
  const [activePaket, setActivePaket] = useState<PaketSoal | null>(null)
  const [soalDibuat, setSoalDibuat] = useState<SoalWithImg[]>([])
  const [kirimId, setKirimId] = useState<string | null>(null)
  const [tarikId, setTarikId] = useState<string | null>(null)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [soalExpand, setSoalExpand] = useState<SoalWithImg[]>([])
  const [loadingSoal, setLoadingSoal] = useState(false)

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
  const [pendingUploadKey, setPendingUploadKey] = useState<string | null>(null)
  const formRef = useRef<HTMLFormElement>(null)

  const showToast = (msg: string, type: 'success' | 'error' = 'success') => setToast({ msg, type })

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await apiRequest<{ data: PaketSoal[] }>('/api/guru/paket')
      setPakets(res.data)
    } finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])
  useEffect(() => {
    Promise.all([
      apiRequest<{ data: Mapel[] }>('/api/admin/mapel'),
      apiRequest<{ data: Kelas[] }>('/api/admin/kelas'),
    ]).then(([m, k]) => { setMapelList(m.data); setKelasList(k.data) })
  }, [])

  function resetSoalForm() {
    formRef.current?.reset()
    setJumlahOpsi(4)
    setImgPertanyaan('')
    setImgOpsi({})
  }

  async function startBuatSoal() {
    if (!setupMapel || !setupKelas) {
      showToast('Pilih mata pelajaran dan kelas terlebih dahulu', 'error')
      return
    }
    setSaving(true)
    try {
      // Create paket first
      const res = await apiRequest<{ id?: string; message: string }>('/api/guru/paket', {
        method: 'POST',
        body: JSON.stringify({ mapel_id: setupMapel, kelas_id: setupKelas, acak: setupAcak }),
      })
      // Reload to get the new paket
      const listRes = await apiRequest<{ data: PaketSoal[] }>('/api/guru/paket')
      setPakets(listRes.data)
      const newPaket = listRes.data[0] // newest first
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
      showToast(err instanceof Error ? err.message : 'Upload gagal', 'error')
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
    const payload: Record<string, unknown> = Object.fromEntries(fd.entries())
    payload.jumlah_opsi = String(jumlahOpsi)
    payload.mapel_id = activePaket.mapel_id
    payload.kelas_id = activePaket.kelas_id
    payload.acak = activePaket.acak
    payload.paket_id = activePaket.id
    payload.gambar_pertanyaan = imgPertanyaan || null
    for (const l of ['a','b','c','d','e']) {
      payload[`gambar_opsi_${l}`] = imgOpsi[l] || null
    }
    setSaving(true)
    try {
      await apiRequest('/api/guru/soal', { method: 'POST', body: JSON.stringify(payload) })
      showToast(`Soal ke-${soalDibuat.length + 1} berhasil ditambahkan`)
      setSoalDibuat(prev => [...prev, { ...payload, id: '' } as SoalWithImg])
      resetSoalForm()
      // Refresh paket count
      const listRes = await apiRequest<{ data: PaketSoal[] }>('/api/guru/paket')
      setPakets(listRes.data)
      const updated = listRes.data.find(p => p.id === activePaket.id)
      if (updated) setActivePaket(updated)
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

  async function loadSoalPaket(paketId: string) {
    setLoadingSoal(true)
    try {
      const res = await apiRequest<{ data: SoalWithImg[] }>(`/api/admin/soal/${paketId}/soal`)
      setSoalExpand(res.data)
    } catch { setSoalExpand([]) }
    finally { setLoadingSoal(false) }
  }

  async function handleKirim() {
    if (!kirimId) return
    setSaving(true)
    try {
      await apiRequest(`/api/guru/paket/${kirimId}/kirim`, { method: 'POST' })
      showToast('Paket berhasil dikirim untuk validasi')
      setKirimId(null)
      load()
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
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Gagal menarik', 'error')
    } finally { setSaving(false) }
  }

  async function handleDeletePaket() {
    // We don't have a delete paket API but we can handle it gracefully
    setDeleteId(null)
    showToast('Fitur hapus paket belum tersedia', 'error')
  }

  const getNamaMapel = (id: string) => mapelList.find(m => m.id === id)?.nama ?? id
  const getNamaKelas = (id: string) => kelasList.find(k => k.id === id)?.nama ?? id

  // ── STEP: BUAT SOAL ──────────────────────────────────────────────
  if (step === 'buat' && activePaket) {
    const namaMapel = getNamaMapel(activePaket.mapel_id)
    const namaKelas = getNamaKelas(activePaket.kelas_id)
    return (
      <div className="space-y-6 animate-fade-in">
        {toast && <Toast message={toast.msg} type={toast.type} onClose={() => setToast(null)} />}
        <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleFileChange} />

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

            <div className="flex gap-3 pt-2">
              <button type="submit" className="btn-primary" disabled={saving || !!uploadingImg}>
                {saving ? <Spinner size="sm" /> : <><Plus className="w-4 h-4" /> Tambah & Lanjut ke Soal Berikutnya</>}
              </button>
              <button type="button" onClick={selesaiBuat} className="btn-secondary">
                Selesai ({soalDibuat.length} soal)
              </button>
            </div>
          </form>
        </div>

        {soalDibuat.length > 0 && (
          <div className="card">
            <p className="text-sm font-medium text-slate-600 mb-3">Soal yang sudah dibuat ({soalDibuat.length})</p>
            <div className="space-y-2">
              {soalDibuat.map((s, i) => (
                <div key={i} className="flex items-start gap-2 text-sm text-slate-700 bg-slate-50 rounded-lg px-3 py-2">
                  <span className="w-5 h-5 rounded-full bg-brand-100 text-brand-700 font-bold text-xs flex items-center justify-center flex-shrink-0 mt-0.5">{i+1}</span>
                  <span className="line-clamp-1">{s.teks as string}</span>
                </div>
              ))}
            </div>
          </div>
        )}
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
                {mapelList.map(m => <option key={m.id} value={m.id}>{m.nama}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Kelas *</label>
              <select className="select" value={setupKelas} onChange={e => setSetupKelas(e.target.value)} required>
                <option value="">Pilih Kelas</option>
                {kelasList.map(k => <option key={k.id} value={k.id}>{k.nama}</option>)}
              </select>
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
                    <div className="mt-1 text-xs text-red-600">Soal ditolak — silakan edit soal di Bank Soal lalu kirim ulang</div>
                  )}
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  {(p.status === 'DRAFT' || p.status === 'DITOLAK') && (
                    <button onClick={() => setKirimId(p.id)} className="btn-primary btn-sm">
                      <Send className="w-3.5 h-3.5" /> {p.status === 'DITOLAK' ? 'Kirim Ulang' : 'Kirim'}
                    </button>
                  )}
                  {p.status === 'MENUNGGU' && (
                    <button onClick={() => setTarikId(p.id)} className="btn-secondary btn-sm">
                      <RotateCcw className="w-3.5 h-3.5" /> Tarik
                    </button>
                  )}
                  <button
                    onClick={() => {
                      if (expandedId === p.id) {
                        setExpandedId(null)
                      } else {
                        setExpandedId(p.id)
                        loadSoalPaket(p.id)
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
                  ) : soalExpand.length === 0 ? (
                    <p className="text-xs text-slate-400 text-center py-2">Belum ada soal dalam paket ini</p>
                  ) : (
                    soalExpand.map((s, i) => (
                      <div key={s.id} className="flex items-start gap-2 text-sm text-slate-700 bg-white rounded-lg px-3 py-2 border border-slate-100">
                        <span className="w-5 h-5 rounded-full bg-brand-100 text-brand-700 font-bold text-xs flex items-center justify-center flex-shrink-0 mt-0.5">{i+1}</span>
                        <div className="flex-1 min-w-0">
                          <p className="line-clamp-2">{s.teks}</p>
                          {s.gambar_pertanyaan && <span className="text-xs text-brand-500">📷 Ada gambar</span>}
                        </div>
                        <span className="text-xs text-slate-400 flex-shrink-0">Kunci: {s.kunci}</span>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <Confirm open={!!kirimId} onClose={() => setKirimId(null)} onConfirm={handleKirim}
        title="Kirim Soal untuk Validasi"
        message="Soal akan dikirim ke admin untuk divalidasi. Setelah dikirim, soal tidak bisa lagi diedit atau dihapus sampai disetujui atau ditolak. Lanjutkan?"
        confirmLabel="Ya, Kirim" variant="primary" loading={saving} />

      <Confirm open={!!tarikId} onClose={() => setTarikId(null)} onConfirm={handleTarik}
        title="Tarik Soal"
        message="Soal akan ditarik kembali ke status DRAFT dan bisa diedit. Lanjutkan?"
        confirmLabel="Ya, Tarik" variant="primary" loading={saving} />
    </div>
  )
}
