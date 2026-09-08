'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import {
  PenSquare, Calendar, Users, Clock, ChevronRight, Plus, Pencil, Trash2,
  ImagePlus, X, Lock, Save, Info, ClipboardList, CheckCircle2, Undo2,
} from 'lucide-react'
import { Modal, Confirm, EmptyState, Spinner, Toast } from '@/components/ui'
import { apiRequest, formatDate } from '@/lib/utils'

// ── Tipe ──────────────────────────────────────────────────────────
interface JadwalEssay {
  id: string
  tanggal: string
  sesi: number
  mapel_id: string
  kelas: string
  nama_mapel: string
  nama_kelas: string
  status: 'AKTIF' | 'BERJALAN' | 'SELESAI'
  essay_aktif: boolean
  essay_mode_jawaban: 'DIGITAL' | 'KERTAS'
  essay_durasi_menit: number | null
  essay_bobot_pg_persen: number
  essay_bobot_essay_persen: number
  essay_instruksi: string | null
  sesi_ujian: { id: string; status: string } | null
}

interface SoalEssay {
  id: string
  jadwal_id: string
  teks: string
  gambar_url: string | null
  bobot_maks: number
  urutan: number
  status: string
}

// ── Form pengaturan essay per jadwal ─────────────────────────────
function EssaySettingForm({
  jadwal, onSaved, showToast,
}: {
  jadwal: JadwalEssay
  onSaved: () => void
  showToast: (msg: string, type?: 'success' | 'error') => void
}) {
  const locked = !!jadwal.sesi_ujian // sesi sudah pernah/sedang dibuka → pengaturan beku
  const [mode, setMode] = useState<'DIGITAL' | 'KERTAS'>(jadwal.essay_mode_jawaban || 'DIGITAL')
  const [durasi, setDurasi] = useState(String(jadwal.essay_durasi_menit ?? 30))
  const [bobotPg, setBobotPg] = useState(String(jadwal.essay_bobot_pg_persen ?? 50))
  const [bobotEssay, setBobotEssay] = useState(String(jadwal.essay_bobot_essay_persen ?? 50))
  const [instruksi, setInstruksi] = useState(jadwal.essay_instruksi ?? '')
  const [saving, setSaving] = useState(false)

  // Kalau salah satu bobot diubah, otomatis pas-kan pasangannya ke 100%
  function handleBobotPg(val: string) {
    setBobotPg(val)
    const n = Number(val)
    if (!isNaN(n)) setBobotEssay(String(100 - n))
  }
  function handleBobotEssay(val: string) {
    setBobotEssay(val)
    const n = Number(val)
    if (!isNaN(n)) setBobotPg(String(100 - n))
  }

  async function handleSave() {
    if (locked) return
    setSaving(true)
    try {
      await apiRequest(`/api/guru/jadwal/${jadwal.id}/essay-setting`, {
        method: 'PUT',
        body: JSON.stringify({
          mode_jawaban: mode,
          durasi_menit: Number(durasi),
          bobot_pg_persen: Number(bobotPg),
          bobot_essay_persen: Number(bobotEssay),
          instruksi,
        }),
      })
      showToast('Pengaturan essay berhasil disimpan')
      onSaved()
    } catch (e: unknown) {
      showToast(e instanceof Error ? e.message : 'Gagal menyimpan pengaturan', 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="card space-y-4">
      <div className="flex items-center gap-2 pb-3 border-b border-slate-100">
        <ClipboardList className="w-4 h-4 text-brand-600" />
        <h2 className="font-semibold text-slate-900">Pengaturan Sesi Essay</h2>
      </div>

      {locked && (
        <div className="alert-info text-xs flex items-start gap-2">
          <Lock className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
          Sesi ujian untuk jadwal ini sudah pernah dibuka, jadi pengaturan essay tidak bisa diubah lagi. Soal essay di bawah masih bisa dikelola selama sesi belum berjalan.
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="label">Mode Jawaban Siswa</label>
          <select className="select" value={mode} disabled={locked}
            onChange={e => setMode(e.target.value as 'DIGITAL' | 'KERTAS')}>
            <option value="DIGITAL">Digital (ketik langsung di layar)</option>
            <option value="KERTAS">Kertas (tulis tangan, difoto & diunggah)</option>
          </select>
        </div>
        <div>
          <label className="label">Durasi Essay (menit)</label>
          <input type="number" className="input" min={1} value={durasi} disabled={locked}
            onChange={e => setDurasi(e.target.value)} />
        </div>
        <div>
          <label className="label">Bobot Nilai PG (%)</label>
          <input type="number" className="input" min={0} max={100} value={bobotPg} disabled={locked}
            onChange={e => handleBobotPg(e.target.value)} />
        </div>
        <div>
          <label className="label">Bobot Nilai Essay (%)</label>
          <input type="number" className="input" min={0} max={100} value={bobotEssay} disabled={locked}
            onChange={e => handleBobotEssay(e.target.value)} />
        </div>
      </div>

      <div>
        <label className="label">Instruksi Tambahan untuk Siswa (opsional)</label>
        <textarea className="textarea" rows={2} value={instruksi} disabled={locked}
          placeholder="Contoh: Kerjakan dengan tulisan rapi dan jelas..."
          onChange={e => setInstruksi(e.target.value)} />
      </div>

      {!locked && (
        <div className="flex justify-end pt-1">
          <button className="btn-primary btn-sm" onClick={handleSave} disabled={saving}>
            {saving ? <Spinner size="sm" /> : <><Save className="w-4 h-4" /> Simpan Pengaturan</>}
          </button>
        </div>
      )}
    </div>
  )
}

// ── Form tambah/edit soal essay ──────────────────────────────────
function SoalEssayForm({
  formId, soal, onSubmit, gambarUrl, setGambarUrl, uploading, onTriggerUpload,
}: {
  formId: string
  soal?: SoalEssay | null
  onSubmit: (e: React.FormEvent<HTMLFormElement>) => void
  gambarUrl: string
  setGambarUrl: (s: string) => void
  uploading: boolean
  onTriggerUpload: () => void
}) {
  return (
    <form id={formId} onSubmit={onSubmit} className="space-y-4">
      <div>
        <label className="label">Teks Soal *</label>
        <textarea name="teks" className="textarea" rows={4} required
          placeholder="Tulis pertanyaan essay di sini..." defaultValue={soal?.teks ?? ''} />
        <div className="mt-2">
          {gambarUrl ? (
            <div className="relative inline-block">
              <img src={gambarUrl} alt="Gambar soal" className="max-h-32 rounded-lg border border-slate-200" />
              <button type="button" onClick={() => setGambarUrl('')}
                className="absolute -top-1.5 -right-1.5 bg-red-500 text-white rounded-full w-5 h-5 flex items-center justify-center">
                <X className="w-3 h-3" />
              </button>
            </div>
          ) : (
            <button type="button" onClick={onTriggerUpload} className="btn-secondary btn-sm text-xs" disabled={uploading}>
              {uploading ? <Spinner size="sm" /> : <><ImagePlus className="w-3.5 h-3.5" /> Tambah Gambar (opsional)</>}
            </button>
          )}
        </div>
      </div>
      <div>
        <label className="label">Bobot Maksimal Soal *</label>
        <input name="bobot_maks" type="number" min={1} step="0.5" className="input" required
          placeholder="Contoh: 25" defaultValue={soal?.bobot_maks ?? ''} />
        <p className="text-xs text-slate-400 mt-1">
          Total bobot semua soal essay dalam satu jadwal akan menjadi basis perhitungan nilai essay (skala 0–100).
        </p>
      </div>
    </form>
  )
}

// ── Halaman utama ─────────────────────────────────────────────────
export default function GuruSoalEssayPage() {
  const [jadwalList, setJadwalList] = useState<JadwalEssay[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [soalList, setSoalList] = useState<SoalEssay[]>([])
  const [loadingSoal, setLoadingSoal] = useState(false)
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null)
  const [saving, setSaving] = useState(false)

  const [addOpen, setAddOpen] = useState(false)
  const [addGambar, setAddGambar] = useState('')
  const [editSoal, setEditSoal] = useState<SoalEssay | null>(null)
  const [editGambar, setEditGambar] = useState('')
  const [deleteId, setDeleteId] = useState<string | null>(null)

  const [uploading, setUploading] = useState(false)
  const [uploadTarget, setUploadTarget] = useState<'add' | 'edit' | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const showToast = (msg: string, type: 'success' | 'error' = 'success') => setToast({ msg, type })

  // ── Load jadwal (dipinjam dari endpoint jadwal-pengawasan: sudah berisi
  // semua kolom jadwal termasuk essay_* dan info sesi_ujian) ─────────
  const loadJadwal = useCallback(async () => {
    setLoading(true)
    try {
      const res = await apiRequest<{ data: JadwalEssay[] }>('/api/guru/jadwal-pengawasan')
      setJadwalList(res.data ?? [])
    } catch (e: unknown) {
      showToast(e instanceof Error ? e.message : 'Gagal memuat jadwal', 'error')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadJadwal() }, [loadJadwal])

  const loadSoal = useCallback(async (jadwalId: string) => {
    setLoadingSoal(true)
    try {
      const res = await apiRequest<{ data: SoalEssay[] }>(`/api/guru/soal-essay?jadwal_id=${jadwalId}`)
      setSoalList(res.data ?? [])
    } catch (e: unknown) {
      showToast(e instanceof Error ? e.message : 'Gagal memuat soal essay', 'error')
      setSoalList([])
    } finally {
      setLoadingSoal(false)
    }
  }, [])

  function selectJadwal(j: JadwalEssay) {
    setSelectedId(j.id)
    loadSoal(j.id)
  }

  const selected = jadwalList.find(j => j.id === selectedId) ?? null
  const soalTerkunci = !!selected?.sesi_ujian && ['BERJALAN', 'SELESAI'].includes(selected.sesi_ujian.status)
  // FIX (fitur essay): total bobot yang ditampilkan ke guru harus sama
  // persis dengan yang dipakai backend untuk menilai (hanya soal DISETUJUI —
  // lihat FIX di api/guru/koreksi-essay/route.ts). Soal DRAFT tidak dihitung
  // karena tidak akan pernah dikerjakan siswa.
  const soalDisetujui = soalList.filter(s => s.status === 'DISETUJUI')
  const totalBobot = soalDisetujui.reduce((sum, s) => sum + Number(s.bobot_maks), 0)
  const jumlahDraft = soalList.length - soalDisetujui.length

  // ── Upload gambar ──────────────────────────────────────────────
  function triggerUpload(target: 'add' | 'edit') {
    setUploadTarget(target)
    setTimeout(() => fileRef.current?.click(), 50)
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file || !uploadTarget) return
    setUploading(true)
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
      if (uploadTarget === 'add') setAddGambar(data.url)
      else setEditGambar(data.url)
    } catch (e: unknown) {
      showToast(e instanceof Error ? e.message : 'Upload gambar gagal', 'error')
    } finally {
      setUploading(false)
    }
  }

  // ── Tambah soal ──────────────────────────────────────────────
  async function handleAdd(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!selected) return
    const fd = new FormData(e.currentTarget)
    setSaving(true)
    try {
      await apiRequest('/api/guru/soal-essay', {
        method: 'POST',
        body: JSON.stringify({
          jadwal_id: selected.id,
          mapel_id: selected.mapel_id,
          kelas_id: selected.kelas,
          teks: fd.get('teks'),
          gambar_url: addGambar || null,
          bobot_maks: fd.get('bobot_maks'),
        }),
      })
      showToast('Soal essay berhasil ditambahkan')
      setAddOpen(false)
      setAddGambar('')
      await loadSoal(selected.id)
      await loadJadwal()
    } catch (e: unknown) {
      showToast(e instanceof Error ? e.message : 'Gagal menambah soal', 'error')
    } finally {
      setSaving(false)
    }
  }

  // ── Edit soal ────────────────────────────────────────────────
  function openEdit(s: SoalEssay) {
    setEditSoal(s)
    setEditGambar(s.gambar_url ?? '')
  }

  async function handleEdit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!editSoal) return
    const fd = new FormData(e.currentTarget)
    setSaving(true)
    try {
      await apiRequest(`/api/guru/soal-essay/${editSoal.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          teks: fd.get('teks'),
          gambar_url: editGambar || null,
          bobot_maks: fd.get('bobot_maks'),
        }),
      })
      showToast('Soal essay berhasil diperbarui')
      setEditSoal(null)
      if (selected) await loadSoal(selected.id)
    } catch (e: unknown) {
      showToast(e instanceof Error ? e.message : 'Gagal memperbarui soal', 'error')
    } finally {
      setSaving(false)
    }
  }

  // ── Setujui / batalkan persetujuan soal (DRAFT ⇄ DISETUJUI) ───
  // FIX (fitur essay): sebelumnya tidak ada cara sama sekali untuk
  // mempromosikan soal essay dari DRAFT ke DISETUJUI, padahal endpoint
  // siswa sekarang HANYA menampilkan soal berstatus DISETUJUI (lihat FIX di
  // api/siswa/ujian/essay/soal/route.ts). Guru wajib menyetujui soal di sini
  // dulu sebelum soal itu benar-benar akan dikerjakan siswa.
  async function handleToggleStatus(s: SoalEssay) {
    const statusBaru = s.status === 'DISETUJUI' ? 'DRAFT' : 'DISETUJUI'
    setSaving(true)
    try {
      await apiRequest(`/api/guru/soal-essay/${s.id}`, {
        method: 'PUT',
        body: JSON.stringify({ status: statusBaru }),
      })
      showToast(statusBaru === 'DISETUJUI' ? 'Soal essay disetujui' : 'Persetujuan soal essay dibatalkan')
      if (selected) await loadSoal(selected.id)
    } catch (e: unknown) {
      showToast(e instanceof Error ? e.message : 'Gagal mengubah status soal', 'error')
    } finally {
      setSaving(false)
    }
  }

  // ── Hapus soal ───────────────────────────────────────────────
  async function handleDelete() {
    if (!deleteId) return
    setSaving(true)
    try {
      await apiRequest(`/api/guru/soal-essay/${deleteId}`, { method: 'DELETE' })
      showToast('Soal essay berhasil dihapus')
      setDeleteId(null)
      if (selected) await loadSoal(selected.id)
      await loadJadwal()
    } catch (e: unknown) {
      showToast(e instanceof Error ? e.message : 'Gagal menghapus soal', 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-6 animate-fade-in">
      {toast && <Toast message={toast.msg} type={toast.type} onClose={() => setToast(null)} />}
      <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleFileChange} />

      <div>
        <h1 className="page-title">Soal Essay</h1>
        <p className="page-subtitle">Atur mode jawaban, durasi, bobot nilai, dan kelola soal essay per jadwal ujian</p>
      </div>

      {loading ? (
        <div className="flex justify-center py-20"><Spinner size="lg" /></div>
      ) : jadwalList.length === 0 ? (
        <div className="card">
          <EmptyState icon={Calendar} title="Belum ada jadwal" description="Jadwal ujian yang Anda awasi akan muncul di sini." />
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
          {/* Daftar jadwal */}
          <div className="lg:col-span-2 space-y-2">
            {jadwalList.map(j => (
              <button
                key={j.id}
                onClick={() => selectJadwal(j)}
                className={`w-full text-left card p-3.5 transition-all ${selectedId === j.id ? 'ring-2 ring-brand-400 border-brand-300' : 'hover:border-slate-300'}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-semibold text-slate-900 truncate">{j.nama_mapel}</p>
                    <p className="text-xs text-slate-500 flex items-center gap-1 mt-0.5">
                      <Users className="w-3 h-3" /> Kelas {j.nama_kelas}
                      <span className="text-slate-300">·</span>
                      <Calendar className="w-3 h-3" /> {formatDate(j.tanggal)}
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-1 flex-shrink-0">
                    {j.essay_aktif ? (
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 font-semibold">Essay Aktif</span>
                    ) : (
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-100 text-slate-500 font-semibold">PG Saja</span>
                    )}
                    <ChevronRight className="w-4 h-4 text-slate-300" />
                  </div>
                </div>
              </button>
            ))}
          </div>

          {/* Detail jadwal terpilih */}
          <div className="lg:col-span-3 space-y-4">
            {!selected ? (
              <div className="card">
                <EmptyState icon={PenSquare} title="Pilih jadwal" description="Pilih jadwal di sebelah kiri untuk mengatur soal essay-nya." />
              </div>
            ) : (
              <>
                <EssaySettingForm jadwal={selected} showToast={showToast} onSaved={loadJadwal} />

                <div className="card space-y-4">
                  <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                    <div className="flex items-center gap-2">
                      <PenSquare className="w-4 h-4 text-brand-600" />
                      <h2 className="font-semibold text-slate-900">Bank Soal Essay</h2>
                    </div>
                    <span className="text-xs text-slate-400">Total bobot (disetujui): {totalBobot}</span>
                  </div>

                  {jumlahDraft > 0 && (
                    <div className="alert-info text-xs flex items-start gap-2">
                      <Info className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                      Ada {jumlahDraft} soal essay berstatus <strong>Draft</strong> — soal draft tidak akan ditampilkan ke siswa dan tidak dihitung ke total bobot sampai Anda menyetujuinya.
                    </div>
                  )}

                  {soalTerkunci && (
                    <div className="alert-info text-xs flex items-start gap-2">
                      <Lock className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                      Sesi ujian untuk jadwal ini sedang/sudah berjalan — soal essay tidak bisa diubah lagi.
                    </div>
                  )}

                  {loadingSoal ? (
                    <div className="flex justify-center py-6"><Spinner size="sm" /></div>
                  ) : soalList.length === 0 ? (
                    <p className="text-xs text-slate-400 text-center py-4">Belum ada soal essay untuk jadwal ini</p>
                  ) : (
                    <div className="space-y-2">
                      {soalList.map((s, i) => (
                        <div key={s.id} className="flex items-start gap-2 text-sm text-slate-700 bg-slate-50 rounded-lg px-3 py-2.5 border border-slate-100">
                          <span className="w-6 h-6 rounded-full bg-brand-100 text-brand-700 font-bold text-xs flex items-center justify-center flex-shrink-0 mt-0.5">
                            {i + 1}
                          </span>
                          <div className="flex-1 min-w-0">
                            <p className="line-clamp-2">{s.teks}</p>
                            <div className="flex items-center gap-2 mt-1">
                              {s.gambar_url && <span className="text-xs text-brand-500">📷 Ada gambar</span>}
                              {s.status === 'DISETUJUI' ? (
                                <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 font-semibold">Disetujui</span>
                              ) : (
                                <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 font-semibold">Draft</span>
                              )}
                            </div>
                          </div>
                          <span className="text-xs text-slate-400 flex-shrink-0">Bobot: {s.bobot_maks}</span>
                          {!soalTerkunci && (
                            <div className="flex items-center gap-1 flex-shrink-0">
                              <button
                                onClick={() => handleToggleStatus(s)}
                                disabled={saving}
                                className={`btn-ghost btn-icon btn-sm ${s.status === 'DISETUJUI' ? 'text-amber-600 hover:bg-amber-50' : 'text-emerald-600 hover:bg-emerald-50'}`}
                                title={s.status === 'DISETUJUI' ? 'Batalkan persetujuan (kembalikan ke Draft)' : 'Setujui soal (tampilkan ke siswa)'}
                              >
                                {s.status === 'DISETUJUI' ? <Undo2 className="w-3.5 h-3.5" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                              </button>
                              <button onClick={() => openEdit(s)} className="btn-ghost btn-icon btn-sm text-blue-600 hover:bg-blue-50" title="Edit soal">
                                <Pencil className="w-3.5 h-3.5" />
                              </button>
                              <button onClick={() => setDeleteId(s.id)} className="btn-ghost btn-icon btn-sm text-red-600 hover:bg-red-50" title="Hapus soal">
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  {!soalTerkunci && (
                    addOpen ? (
                      <div className="border-t border-slate-100 pt-4">
                        <div className="flex items-center justify-between mb-3">
                          <p className="text-sm font-medium text-slate-700">Soal ke-{soalList.length + 1}</p>
                          <button onClick={() => { setAddOpen(false); setAddGambar('') }} className="btn-ghost btn-sm text-slate-400">
                            <X className="w-3.5 h-3.5" /> Batal
                          </button>
                        </div>
                        <SoalEssayForm
                          formId="add-soal-essay-form"
                          onSubmit={handleAdd}
                          gambarUrl={addGambar}
                          setGambarUrl={setAddGambar}
                          uploading={uploading}
                          onTriggerUpload={() => triggerUpload('add')}
                        />
                        <div className="flex justify-end pt-3">
                          <button form="add-soal-essay-form" type="submit" className="btn-primary btn-sm" disabled={saving || uploading}>
                            {saving ? <Spinner size="sm" /> : <><Plus className="w-4 h-4" /> Simpan Soal</>}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button onClick={() => setAddOpen(true)} className="btn-secondary btn-sm w-full">
                        <Plus className="w-3.5 h-3.5" /> Tambah Soal Essay
                      </button>
                    )
                  )}

                  {!selected.essay_aktif && soalList.length > 0 && (
                    <div className="alert-info text-xs flex items-start gap-2">
                      <Info className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                      Sudah ada soal essay, tapi essay belum aktif untuk jadwal ini — simpan Pengaturan Sesi Essay di atas untuk mengaktifkannya.
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Modal Edit Soal */}
      <Modal open={!!editSoal} onClose={() => setEditSoal(null)} title="Edit Soal Essay" size="lg"
        footer={
          <>
            <button onClick={() => setEditSoal(null)} className="btn-secondary" disabled={saving}>Batal</button>
            <button form="edit-soal-essay-form" type="submit" className="btn-primary" disabled={saving || uploading}>
              {saving ? <Spinner size="sm" /> : 'Simpan Perubahan'}
            </button>
          </>
        }
      >
        {editSoal && (
          <SoalEssayForm
            formId="edit-soal-essay-form"
            soal={editSoal}
            onSubmit={handleEdit}
            gambarUrl={editGambar}
            setGambarUrl={setEditGambar}
            uploading={uploading}
            onTriggerUpload={() => triggerUpload('edit')}
          />
        )}
      </Modal>

      {/* Confirm Hapus */}
      <Confirm open={!!deleteId} onClose={() => setDeleteId(null)} onConfirm={handleDelete}
        title="Hapus Soal Essay" message="Soal ini akan dihapus permanen. Lanjutkan?"
        confirmLabel="Ya, Hapus" loading={saving} />
    </div>
  )
}
