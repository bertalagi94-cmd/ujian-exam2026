'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import {
  Save, Settings, School, Shield, WrenchIcon,
  ToggleLeft, ToggleRight, Upload, Trash2, Image, AlertTriangle,
  Download, FolderOpen, RotateCcw, DatabaseZap, CheckSquare, Square,
} from 'lucide-react'
import { Toast, Spinner, Confirm } from '@/components/ui'
import { HackerPopup, HackerPopupType } from '@/components/ui/HackerPopup'
import { apiRequest } from '@/lib/utils'
import { DATA_WILAYAH, getProvinsiById, ZONA_WAKTU_INFO } from '@/lib/wilayah'

type ResetCategory = {
  id: string
  label: string
  desc: string
  danger: 'medium' | 'high' | 'critical'
}

const RESET_CATEGORIES: ResetCategory[] = [
  { id: 'jawaban_nilai', label: 'Jawaban & Nilai', desc: 'Hapus semua jawaban siswa, nilai, dan pelanggaran', danger: 'medium' },
  { id: 'sesi_ujian', label: 'Sesi Ujian', desc: 'Hapus sesi ujian, peserta sesi, jawaban, nilai, dan pelanggaran', danger: 'high' },
  { id: 'soal_paket', label: 'Soal & Paket Soal', desc: 'Hapus semua soal, kisi-kisi, dan paket soal beserta sesinya', danger: 'high' },
  { id: 'jadwal', label: 'Jadwal Ujian', desc: 'Hapus semua jadwal beserta soal, kisi-kisi, sesi, dan nilai', danger: 'high' },
  { id: 'siswa', label: 'Data Siswa', desc: 'Hapus semua data siswa (jawaban & nilai ikut terhapus)', danger: 'high' },
  { id: 'kelas_mapel', label: 'Kelas & Mata Pelajaran', desc: 'Hapus kelas, mapel, beserta jadwal, kisi-kisi, dan soal terkait', danger: 'high' },
  { id: 'users', label: 'Data User', desc: 'Hapus akun guru, pengawas, dan kepala sekolah', danger: 'medium' },
  { id: 'log', label: 'Log Aktivitas', desc: 'Hapus log aktivitas dan log reset', danger: 'medium' },
  { id: 'pengaturan', label: 'Pengaturan Sistem', desc: 'Reset konfigurasi sekolah ke kondisi awal', danger: 'medium' },
]

const DEFAULT_SETTINGS: Record<string, string> = {
  namaSekolah: '',
  npsn: '',
  namaKepsek: '',
  nipKepsek: '',
  alamat: '',
  kota: '',
  provinsiId: '',
  kabupaten: '',
  tahunAjaran: '',
  batasPelanggaran: '3',
  jumlahOpsi: '4',
  logoUrl: '',
  maintenanceAktif: 'false',
  maintenancePesan: '',
  maintenanceMulai: '',
  maintenanceSelesai: '',
}

type Tab = 'sekolah' | 'ujian' | 'maintenance' | 'backup' | 'reset'

const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
  { id: 'sekolah', label: 'Informasi Sekolah', icon: <School className="w-4 h-4" /> },
  { id: 'ujian', label: 'Pengaturan Ujian', icon: <Settings className="w-4 h-4" /> },
  { id: 'maintenance', label: 'Maintenance', icon: <WrenchIcon className="w-4 h-4" /> },
  { id: 'backup', label: 'Backup & Restore', icon: <DatabaseZap className="w-4 h-4" /> },
  { id: 'reset', label: 'Reset Data', icon: <RotateCcw className="w-4 h-4" /> },
]

export default function AdminPengaturanPage() {
  const [activeTab, setActiveTab] = useState<Tab>('sekolah')
  const [values, setValues] = useState<Record<string, string>>(DEFAULT_SETTINGS)
  const [loading, setLoading] = useState(true)
  const [savingSection, setSavingSection] = useState<string | null>(null)
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null)
  const [logoPreview, setLogoPreview] = useState<string>('')
  const [uploadingLogo, setUploadingLogo] = useState(false)
  const [confirmHapusLogo, setConfirmHapusLogo] = useState(false)
  const [saving, setSaving] = useState(false)
  const [backingUp, setBackingUp] = useState(false)
  const [restoring, setRestoring] = useState(false)
  const [resetting, setResetting] = useState(false)
  const [selectedResets, setSelectedResets] = useState<string[]>([])
  const [confirmReset, setConfirmReset] = useState(false)
  const [confirmResetSemua, setConfirmResetSemua] = useState(false)
  const restoreInputRef = useRef<HTMLInputElement>(null)

  const [hackerOpen, setHackerOpen] = useState(false)
  const [hackerType, setHackerType] = useState<HackerPopupType>('backup')
  const [hackerProgress, setHackerProgress] = useState(0)
  const [hackerFile, setHackerFile] = useState<string>()
  const [hackerSize, setHackerSize] = useState<string>()
  const hackerDoneRef = useRef<() => void>()

  const showToast = (msg: string, type: 'success' | 'error' = 'success') => setToast({ msg, type })

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await apiRequest<{ data: { key: string; value: string }[] }>('/api/admin/pengaturan')
      const merged = { ...DEFAULT_SETTINGS }
      res.data.forEach(({ key, value }) => {
        if (key in merged) merged[key] = value ?? ''
      })
      setValues(merged)
      setLogoPreview(merged.logoUrl || '')
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Gagal memuat data', 'error')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  function set(key: string, val: string) {
    setValues(v => ({ ...v, [key]: val }))
  }

  async function saveSection(keys: string[], sectionName: string) {
    setSavingSection(sectionName)
    try {
      const settings = keys.map(key => ({ key, value: values[key] ?? '' }))
      await apiRequest('/api/admin/pengaturan', {
        method: 'PUT',
        body: JSON.stringify({ settings }),
      })
      showToast(`${sectionName} berhasil disimpan`)
      // Notify other components (e.g. admin dashboard) that pengaturan changed
      window.dispatchEvent(new Event('pengaturan-changed'))
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Gagal menyimpan', 'error')
    } finally {
      setSavingSection(null)
    }
  }

  async function handleLogoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    if (!file.type.startsWith('image/')) { showToast('File harus berupa gambar', 'error'); return }
    if (file.size > 2 * 1024 * 1024) { showToast('Ukuran gambar maksimal 2MB', 'error'); return }
    setUploadingLogo(true)
    try {
      const reader = new FileReader()
      reader.onload = (ev) => setLogoPreview(ev.target?.result as string)
      reader.readAsDataURL(file)
      const formData = new FormData()
      formData.append('file', file)
      const uploadToken = typeof window !== 'undefined' ? localStorage.getItem('token') : null
      const res = await fetch('/api/admin/pengaturan/logo', {
        method: 'POST',
        headers: uploadToken ? { Authorization: `Bearer ${uploadToken}` } : {},
        body: formData,
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Upload gagal')
      set('logoUrl', json.url)
      showToast('Logo berhasil diupload')
      window.dispatchEvent(new Event('pengaturan-changed'))
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Upload gagal', 'error')
      setLogoPreview(values.logoUrl || '')
    } finally {
      setUploadingLogo(false)
      e.target.value = ''
    }
  }

  async function handleHapusLogo() {
    setSaving(true)
    try {
      const deleteToken = typeof window !== 'undefined' ? localStorage.getItem('token') : null
      await fetch('/api/admin/pengaturan/logo', {
        method: 'DELETE',
        headers: deleteToken ? { Authorization: `Bearer ${deleteToken}` } : {},
      })
      set('logoUrl', '')
      setLogoPreview('')
      showToast('Logo berhasil dihapus')
      window.dispatchEvent(new Event('pengaturan-changed'))
    } catch {
      showToast('Gagal menghapus logo', 'error')
    } finally {
      setSaving(false)
      setConfirmHapusLogo(false)
    }
  }

  function openHacker(type: HackerPopupType, file?: string, size?: string, onDone?: () => void) {
    setHackerType(type)
    setHackerFile(file)
    setHackerSize(size)
    setHackerProgress(0)
    hackerDoneRef.current = onDone
    setHackerOpen(true)
  }

  function tickProgress(resolve: () => void, intervalRef: { id?: ReturnType<typeof setInterval> }) {
    let pct = 0
    intervalRef.id = setInterval(() => {
      pct += Math.random() * 3 + 1
      if (pct >= 100) pct = 100
      setHackerProgress(Math.round(pct))
      if (pct >= 100) { clearInterval(intervalRef.id); resolve() }
    }, 90)
  }

  async function handleBackup() {
    setBackingUp(true)
    const fileName = `smartexam-backup-${new Date().toISOString().slice(0, 10)}.json`
    openHacker('backup', fileName)
    try {
      const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null
      const res = await fetch('/api/admin/backup', { headers: token ? { Authorization: `Bearer ${token}` } : {} })
      if (!res.ok) { const j = await res.json(); throw new Error(j.error || 'Backup gagal') }
      const blob = await res.blob()
      const sizeMB = (blob.size / 1024 / 1024).toFixed(1) + ' MB'
      setHackerFile(fileName)
      setHackerSize(sizeMB)
      await new Promise<void>(resolve => { const ref: { id?: ReturnType<typeof setInterval> } = {}; tickProgress(resolve, ref) })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url; a.download = fileName; a.click()
      URL.revokeObjectURL(url)
      showToast('Backup berhasil diunduh')
    } catch (err: unknown) {
      setHackerOpen(false)
      showToast(err instanceof Error ? err.message : 'Backup gagal', 'error')
    } finally {
      setBackingUp(false)
    }
  }

  async function handleRestoreFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    if (!file.name.endsWith('.json')) { showToast('File harus berformat .json', 'error'); return }
    const sizeMB = (file.size / 1024 / 1024).toFixed(1) + ' MB'
    setRestoring(true)
    openHacker('restore', file.name, sizeMB)
    try {
      const text = await file.text()
      const parsed = JSON.parse(text)
      if (!parsed?.tables) throw new Error('File bukan backup SmartExam yang valid')
      const resPromise = fetch('/api/admin/restore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(localStorage.getItem('token') ? { Authorization: `Bearer ${localStorage.getItem('token')}` } : {}) },
        body: JSON.stringify(parsed),
      })
      const [apiRes] = await Promise.all([resPromise, new Promise<void>(resolve => { const ref: { id?: ReturnType<typeof setInterval> } = {}; tickProgress(resolve, ref) })])
      const json = await apiRes.json()
      if (!apiRes.ok && apiRes.status !== 207) throw new Error(json.error || 'Restore gagal')
      showToast(json.message || 'Restore berhasil')
      window.dispatchEvent(new Event('pengaturan-changed'))
      await load()
    } catch (err: unknown) {
      setHackerOpen(false)
      showToast(err instanceof Error ? err.message : 'Restore gagal', 'error')
    } finally {
      setRestoring(false)
    }
  }

  function toggleReset(id: string) {
    setSelectedResets(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
  }

  async function doReset(categories: string[]) {
    const label = categories.includes('semua') ? 'Semua Data' : `${categories.length} kategori`
    setResetting(true)
    openHacker('reset', label)
    try {
      const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null
      const resPromise = fetch('/api/admin/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ categories }),
      })
      const [res] = await Promise.all([resPromise, new Promise<void>(resolve => { const ref: { id?: ReturnType<typeof setInterval> } = {}; tickProgress(resolve, ref) })])
      const json = await res.json()
      if (!res.ok && res.status !== 207) throw new Error(json.error || 'Reset gagal')
      showToast(json.message || 'Reset berhasil')
      setSelectedResets([])
      // Dispatch event agar halaman lain (admin dashboard, login) tahu pengaturan berubah
      if (categories.includes('semua') || categories.includes('pengaturan')) {
        window.dispatchEvent(new Event('pengaturan-changed'))
        await load()
      }
    } catch (err: unknown) {
      setHackerOpen(false)
      showToast(err instanceof Error ? err.message : 'Reset gagal', 'error')
    } finally {
      setResetting(false)
      setConfirmReset(false)
      setConfirmResetSemua(false)
    }
  }

  const dangerColor = (d: ResetCategory['danger']) =>
    d === 'critical' ? 'border-red-300 bg-red-50' :
    d === 'high' ? 'border-orange-200 bg-orange-50' :
    'border-slate-200 bg-slate-50'

  const dangerBadge = (d: ResetCategory['danger']) =>
    d === 'critical' ? 'bg-red-100 text-red-700' :
    d === 'high' ? 'bg-orange-100 text-orange-700' :
    'bg-slate-100 text-slate-600'

  const isMaintenance = values.maintenanceAktif === 'true'

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Spinner size="lg" />
      </div>
    )
  }

  return (
    <div className="space-y-6 animate-fade-in">
      {toast && <Toast message={toast.msg} type={toast.type} onClose={() => setToast(null)} />}

      <div>
        <h1 className="page-title">Pengaturan Sistem</h1>
        <p className="page-subtitle">Kelola konfigurasi aplikasi SmartExam</p>
      </div>

      {/* ── Tab Navigation ── */}
      <div className="flex gap-1 bg-slate-100 p-1 rounded-xl overflow-x-auto">
        {TABS.map(tab => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-all flex-shrink-0 ${
              activeTab === tab.id
                ? tab.id === 'reset'
                  ? 'bg-white text-red-600 shadow-sm'
                  : tab.id === 'maintenance' && isMaintenance
                  ? 'bg-white text-amber-600 shadow-sm'
                  : 'bg-white text-brand-600 shadow-sm'
                : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            {tab.icon}
            <span>{tab.label}</span>
            {tab.id === 'maintenance' && isMaintenance && (
              <span className="w-2 h-2 rounded-full bg-amber-500 flex-shrink-0" />
            )}
            {tab.id === 'reset' && (
              <span className="w-2 h-2 rounded-full bg-red-400 flex-shrink-0" />
            )}
          </button>
        ))}
      </div>

      {/* ── Tab: Informasi Sekolah ── */}
      {activeTab === 'sekolah' && (
        <div className="card space-y-5">
          <div className="flex items-center gap-2 pb-3 border-b border-slate-100">
            <School className="w-4 h-4 text-brand-600" />
            <h2 className="font-semibold text-slate-900">Informasi Sekolah</h2>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2">
              <label className="label">Nama Sekolah</label>
              <input className="input" placeholder="Contoh: MTs Alkhairaat Tatakalai" value={values.namaSekolah} onChange={e => set('namaSekolah', e.target.value)} />
            </div>
            <div>
              <label className="label">NPSN</label>
              <input className="input" placeholder="8 digit NPSN" value={values.npsn} onChange={e => set('npsn', e.target.value)} />
            </div>
            <div>
              <label className="label">Tahun Ajaran</label>
              <input className="input" placeholder="Contoh: 2025/2026" value={values.tahunAjaran} onChange={e => set('tahunAjaran', e.target.value)} />
            </div>
            <div>
              <label className="label">Nama Kepala Sekolah</label>
              <input className="input" placeholder="Nama lengkap kepala sekolah" value={values.namaKepsek} onChange={e => set('namaKepsek', e.target.value)} />
            </div>
            <div>
              <label className="label">NIP Kepala Sekolah</label>
              <input className="input" placeholder="NIP kepala sekolah" value={values.nipKepsek} onChange={e => set('nipKepsek', e.target.value)} />
            </div>
            <div className="sm:col-span-2">
              <label className="label">Alamat Sekolah</label>
              <input className="input" placeholder="Alamat lengkap sekolah" value={values.alamat} onChange={e => set('alamat', e.target.value)} />
            </div>
            <div>
              <label className="label">Kota / Kabupaten (untuk kop surat)</label>
              <input className="input" placeholder="Contoh: Banggai Kepulauan" value={values.kota} onChange={e => set('kota', e.target.value)} />
            </div>
          </div>

          {/* Lokasi Sekolah — untuk deteksi zona waktu otomatis */}
          <div className="pt-2 border-t border-slate-100">
            <div className="flex items-center gap-2 mb-1">
              <span className="label mb-0">Lokasi Sekolah (Provinsi & Kabupaten)</span>
            </div>
            <p className="text-xs text-slate-400 mb-3">
              Dipakai untuk mendeteksi zona waktu secara otomatis, agar status ujian
              (Akan Datang / Berlangsung / Selesai) dihitung dengan benar.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="label">Provinsi</label>
                <select
                  className="select"
                  value={values.provinsiId}
                  onChange={e => {
                    set('provinsiId', e.target.value)
                    set('kabupaten', '') // reset kabupaten saat provinsi berubah
                  }}
                >
                  <option value="">Pilih Provinsi</option>
                  {DATA_WILAYAH.map(p => (
                    <option key={p.id} value={p.id}>{p.nama}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label">Kabupaten / Kota</label>
                <select
                  className="select"
                  value={values.kabupaten}
                  onChange={e => set('kabupaten', e.target.value)}
                  disabled={!values.provinsiId}
                >
                  <option value="">Pilih Kabupaten/Kota</option>
                  {(getProvinsiById(values.provinsiId)?.kabupaten ?? []).map(k => (
                    <option key={k} value={k}>{k}</option>
                  ))}
                </select>
              </div>
            </div>
            {values.provinsiId && (
              <div className="mt-3 flex items-center gap-2 text-xs px-3 py-2 rounded-xl bg-emerald-50 text-emerald-700 border border-emerald-200">
                <span>
                  Zona waktu terdeteksi: <strong>{ZONA_WAKTU_INFO[getProvinsiById(values.provinsiId)!.zona].label}</strong>
                </span>
              </div>
            )}
            {!values.provinsiId && (
              <div className="mt-3 flex items-center gap-2 text-xs px-3 py-2 rounded-xl bg-amber-50 text-amber-700 border border-amber-200">
                <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
                <span>Provinsi belum dipilih — status ujian akan dihitung sementara dengan zona waktu WIB sampai diisi.</span>
              </div>
            )}
          </div>

          {/* Logo Sekolah */}
          <div className="pt-2 border-t border-slate-100">
            <div className="flex items-center gap-2 mb-3">
              <Image className="w-4 h-4 text-slate-500" />
              <span className="label mb-0">Logo Sekolah</span>
            </div>
            <div className="flex items-start gap-4 flex-wrap">
              {logoPreview ? (
                <div className="relative w-24 h-24 rounded-xl border border-slate-200 overflow-hidden bg-slate-50 flex items-center justify-center">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={logoPreview} alt="Logo sekolah" className="max-w-full max-h-full object-contain p-1" />
                </div>
              ) : (
                <div className="w-24 h-24 rounded-xl border-2 border-dashed border-slate-200 bg-slate-50 flex flex-col items-center justify-center gap-1">
                  <Image className="w-6 h-6 text-slate-300" />
                  <span className="text-xs text-slate-400">Belum ada</span>
                </div>
              )}
              <div className="flex flex-col gap-2">
                <label className="btn-secondary btn-sm cursor-pointer">
                  {uploadingLogo ? <><Spinner size="sm" /> Mengupload...</> : <><Upload className="w-4 h-4" /> Upload Logo</>}
                  <input type="file" accept="image/*" className="sr-only" onChange={handleLogoUpload} disabled={uploadingLogo} />
                </label>
                {logoPreview && (
                  <button type="button" onClick={() => setConfirmHapusLogo(true)} className="btn-ghost btn-sm text-danger-600 hover:bg-danger-50" disabled={saving}>
                    <Trash2 className="w-4 h-4" /> Hapus Logo
                  </button>
                )}
                <p className="text-xs text-slate-400">Format: JPG, PNG, SVG. Maks 2MB.</p>
              </div>
            </div>
          </div>

          <div className="pt-2 flex justify-end">
            <button
              type="button"
              onClick={() => saveSection(['namaSekolah','npsn','namaKepsek','nipKepsek','alamat','kota','provinsiId','kabupaten','tahunAjaran','logoUrl'], 'Informasi Sekolah')}
              className="btn-primary btn-sm"
              disabled={savingSection === 'Informasi Sekolah'}
            >
              {savingSection === 'Informasi Sekolah' ? <Spinner size="sm" /> : <><Save className="w-4 h-4" /> Simpan</>}
            </button>
          </div>
        </div>
      )}

      {/* ── Tab: Pengaturan Ujian ── */}
      {activeTab === 'ujian' && (
        <div className="space-y-5">
          <div className="card space-y-5">
            <div className="flex items-center gap-2 pb-3 border-b border-slate-100">
              <Settings className="w-4 h-4 text-brand-600" />
              <h2 className="font-semibold text-slate-900">Pengaturan Ujian</h2>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="label">Batas Pelanggaran</label>
                <input
                  type="number" className="input" min={1} max={10}
                  value={values.batasPelanggaran} onChange={e => set('batasPelanggaran', e.target.value)}
                />
                <p className="text-xs text-slate-400 mt-1">Jumlah pelanggaran sebelum siswa dikunci otomatis (default: 3)</p>
              </div>
              <div>
                <label className="label">Jumlah Opsi Jawaban Default</label>
                <select className="select" value={values.jumlahOpsi} onChange={e => set('jumlahOpsi', e.target.value)}>
                  <option value="4">4 Opsi (A–D)</option>
                  <option value="5">5 Opsi (A–E)</option>
                </select>
                <p className="text-xs text-slate-400 mt-1">Default jumlah opsi untuk soal baru</p>
              </div>
            </div>

            <div className="pt-2 flex justify-end">
              <button
                type="button"
                onClick={() => saveSection(['batasPelanggaran','jumlahOpsi'], 'Pengaturan Ujian')}
                className="btn-primary btn-sm"
                disabled={savingSection === 'Pengaturan Ujian'}
              >
                {savingSection === 'Pengaturan Ujian' ? <Spinner size="sm" /> : <><Save className="w-4 h-4" /> Simpan</>}
              </button>
            </div>
          </div>

          {/* Info ringkasan keamanan */}
          <div className="card space-y-4">
            <div className="flex items-center gap-2 pb-3 border-b border-slate-100">
              <Shield className="w-4 h-4 text-brand-600" />
              <h2 className="font-semibold text-slate-900">Ringkasan Pengaturan</h2>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
              {[
                { label: 'Batas Pelanggaran', value: values.batasPelanggaran + 'x', desc: 'Sebelum siswa dikunci' },
                { label: 'Jumlah Opsi Default', value: values.jumlahOpsi + ' opsi', desc: 'Untuk soal baru' },
                { label: 'Maintenance', value: isMaintenance ? 'Aktif' : 'Nonaktif', desc: 'Status saat ini', highlight: isMaintenance },
              ].map(item => (
                <div key={item.label} className={`p-3 rounded-lg border ${item.highlight ? 'bg-amber-50 border-amber-200' : 'bg-slate-50 border-slate-100'}`}>
                  <div className={`font-semibold text-base ${item.highlight ? 'text-amber-700' : 'text-slate-800'}`}>{item.value}</div>
                  <div className="text-xs text-slate-500 mt-0.5">{item.label}</div>
                  <div className="text-xs text-slate-400">{item.desc}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── Tab: Maintenance Mode ── */}
      {activeTab === 'maintenance' && (
        <div className={`card space-y-5 ${isMaintenance ? 'border-2 border-amber-400' : ''}`}>
          <div className="flex items-center justify-between pb-3 border-b border-slate-100">
            <div className="flex items-center gap-2">
              <WrenchIcon className={`w-4 h-4 ${isMaintenance ? 'text-amber-500' : 'text-slate-400'}`} />
              <h2 className="font-semibold text-slate-900">Maintenance Mode</h2>
              {isMaintenance && (
                <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-700">AKTIF</span>
              )}
            </div>
            <button
              type="button"
              onClick={() => set('maintenanceAktif', isMaintenance ? 'false' : 'true')}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                isMaintenance
                  ? 'bg-amber-100 text-amber-700 hover:bg-amber-200'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              {isMaintenance ? <><ToggleRight className="w-4 h-4" /> Nonaktifkan</> : <><ToggleLeft className="w-4 h-4" /> Aktifkan</>}
            </button>
          </div>

          {!isMaintenance && (
            <p className="text-sm text-slate-400 pb-1">
              Aktifkan maintenance mode untuk mengisi pesan, jadwal, dan menyimpan konfigurasi.
            </p>
          )}

          {isMaintenance && (
            <>
              <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800">
                <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                <span>Maintenance mode aktif. Semua pengguna kecuali Admin dan akun IS_TESTER tidak bisa login.</span>
              </div>
              <div className="space-y-4">
                <div>
                  <label className="label">Pesan Maintenance</label>
                  <textarea
                    className="input min-h-[80px] resize-none"
                    placeholder="Contoh: Sistem sedang dalam pemeliharaan. Mohon coba kembali pukul 08.00 WIT."
                    value={values.maintenancePesan}
                    onChange={e => set('maintenancePesan', e.target.value)}
                    rows={3}
                  />
                  <p className="text-xs text-slate-400 mt-1">Pesan ini ditampilkan kepada pengguna saat maintenance aktif.</p>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="label">Jadwal Mulai</label>
                    <input type="datetime-local" className="input" value={values.maintenanceMulai} onChange={e => set('maintenanceMulai', e.target.value)} />
                  </div>
                  <div>
                    <label className="label">Jadwal Selesai</label>
                    <input type="datetime-local" className="input" value={values.maintenanceSelesai} onChange={e => set('maintenanceSelesai', e.target.value)} />
                  </div>
                </div>
              </div>
            </>
          )}

          <div className="pt-2 flex justify-end">
            <button
              type="button"
              onClick={() => saveSection(['maintenanceAktif','maintenancePesan','maintenanceMulai','maintenanceSelesai'], 'Maintenance Mode')}
              className={`btn-sm font-medium ${isMaintenance ? 'btn-danger' : 'btn-primary'}`}
              disabled={savingSection === 'Maintenance Mode'}
            >
              {savingSection === 'Maintenance Mode' ? <Spinner size="sm" /> : <><Save className="w-4 h-4" /> Simpan</>}
            </button>
          </div>
        </div>
      )}

      {/* ── Tab: Backup & Restore ── */}
      {activeTab === 'backup' && (
        <div className="card space-y-5">
          <div className="flex items-center gap-2 pb-3 border-b border-slate-100">
            <DatabaseZap className="w-4 h-4 text-brand-600" />
            <h2 className="font-semibold text-slate-900">Backup &amp; Restore</h2>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Backup */}
            <div className="p-4 rounded-xl border border-slate-200 bg-slate-50 space-y-3">
              <div className="flex items-center gap-2">
                <Download className="w-4 h-4 text-brand-600" />
                <span className="font-medium text-slate-900 text-sm">Backup Data</span>
              </div>
              <p className="text-xs text-slate-500">
                Unduh seluruh data aplikasi (siswa, soal, jadwal, nilai, pengaturan, dll) ke file JSON. Simpan di tempat aman.
              </p>
              <button type="button" onClick={handleBackup} disabled={backingUp} className="btn-primary btn-sm w-full justify-center">
                {backingUp ? <><Spinner size="sm" /> Membuat backup…</> : <><Download className="w-4 h-4" /> Unduh Backup</>}
              </button>
            </div>

            {/* Restore */}
            <div className="p-4 rounded-xl border border-amber-200 bg-amber-50 space-y-3">
              <div className="flex items-center gap-2">
                <FolderOpen className="w-4 h-4 text-amber-600" />
                <span className="font-medium text-slate-900 text-sm">Restore Data</span>
              </div>
              <p className="text-xs text-slate-500">
                Pulihkan data dari file backup. <strong className="text-amber-700">Semua data saat ini akan digantikan.</strong> Pastikan Anda telah backup terlebih dahulu.
              </p>
              <label className={`btn-sm w-full justify-center cursor-pointer inline-flex items-center gap-1.5 font-medium rounded-lg transition-colors ${restoring ? 'btn-secondary opacity-60 pointer-events-none' : 'bg-amber-500 hover:bg-amber-600 text-white'}`}>
                {restoring ? <><Spinner size="sm" /> Memulihkan…</> : <><FolderOpen className="w-4 h-4" /> Pilih File Backup</>}
                <input ref={restoreInputRef} type="file" accept=".json" className="sr-only" onChange={handleRestoreFile} disabled={restoring} />
              </label>
            </div>
          </div>
        </div>
      )}

      {/* ── Tab: Reset Data ── */}
      {activeTab === 'reset' && (
        <div className="card space-y-5 border-2 border-red-100">
          <div className="flex items-center gap-2 pb-3 border-b border-red-100">
            <RotateCcw className="w-4 h-4 text-danger-600" />
            <h2 className="font-semibold text-slate-900">Reset Data</h2>
            <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-red-100 text-red-700">Tidak dapat dibatalkan</span>
          </div>

          <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-800">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
            <span>Pilih kategori data yang ingin direset. Data yang dihapus <strong>tidak bisa dipulihkan</strong> kecuali Anda punya file backup.</span>
          </div>

          <div className="space-y-2">
            {RESET_CATEGORIES.map(cat => {
              const checked = selectedResets.includes(cat.id)
              return (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => toggleReset(cat.id)}
                  className={`w-full flex items-start gap-3 p-3 rounded-lg border text-left transition-all ${checked ? `${dangerColor(cat.danger)} border-opacity-100` : 'border-slate-200 bg-white hover:bg-slate-50'}`}
                >
                  <span className="mt-0.5 shrink-0">
                    {checked ? <CheckSquare className="w-4 h-4 text-danger-600" /> : <Square className="w-4 h-4 text-slate-300" />}
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium text-slate-900">{cat.label}</span>
                      <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${dangerBadge(cat.danger)}`}>
                        {cat.danger === 'high' ? 'Tinggi' : cat.danger === 'critical' ? 'Kritis' : 'Sedang'}
                      </span>
                    </span>
                    <span className="text-xs text-slate-500 mt-0.5 block">{cat.desc}</span>
                  </span>
                </button>
              )
            })}
          </div>

          <div className="flex flex-wrap gap-3 pt-2 border-t border-red-100">
            <button
              type="button"
              onClick={() => {
                if (selectedResets.length === 0) { showToast('Pilih minimal satu kategori yang ingin direset', 'error'); return }
                setConfirmReset(true)
              }}
              disabled={resetting || selectedResets.length === 0}
              className="btn-sm btn-danger flex-1"
            >
              {resetting && confirmReset ? <Spinner size="sm" /> : <RotateCcw className="w-4 h-4" />}
              Reset yang Dipilih
              {selectedResets.length > 0 && (
                <span className="ml-1 px-1.5 py-0.5 rounded-full bg-white/30 text-xs font-bold">{selectedResets.length}</span>
              )}
            </button>

            <button
              type="button"
              onClick={() => setConfirmResetSemua(true)}
              disabled={resetting}
              className="btn-sm border-2 border-red-600 text-red-700 hover:bg-red-600 hover:text-white font-semibold transition-colors rounded-lg px-4 py-2 flex items-center gap-2"
            >
              {resetting && confirmResetSemua ? <Spinner size="sm" /> : <AlertTriangle className="w-4 h-4" />}
              Reset Semua Data
            </button>
          </div>
        </div>
      )}

      <Confirm
        open={confirmHapusLogo}
        onClose={() => setConfirmHapusLogo(false)}
        onConfirm={handleHapusLogo}
        title="Hapus Logo Sekolah"
        message="Logo sekolah akan dihapus. Lanjutkan?"
        confirmLabel="Ya, Hapus"
        loading={saving}
      />

      <Confirm
        open={confirmReset}
        onClose={() => setConfirmReset(false)}
        onConfirm={() => doReset(selectedResets)}
        title="Konfirmasi Reset Data"
        message={`Anda akan mereset: ${selectedResets.map(id => RESET_CATEGORIES.find(c => c.id === id)?.label).join(', ')}. Data yang dihapus tidak bisa dipulihkan. Lanjutkan?`}
        confirmLabel="Ya, Reset Sekarang"
        loading={resetting}
      />

      <Confirm
        open={confirmResetSemua}
        onClose={() => setConfirmResetSemua(false)}
        onConfirm={() => doReset(['semua'])}
        title="⚠️ Reset Semua Data"
        message="PERHATIAN: Seluruh data aplikasi akan dihapus permanen — siswa, soal, jadwal, nilai, pengaturan, dan semua lainnya. Aplikasi akan kembali seperti baru. Tindakan ini TIDAK BISA DIBATALKAN. Pastikan Anda sudah backup. Lanjutkan?"
        confirmLabel="Ya, Hapus Semua Data"
        loading={resetting}
      />

      <HackerPopup
        open={hackerOpen}
        type={hackerType}
        fileName={hackerFile}
        fileSize={hackerSize}
        progress={hackerProgress}
        onDone={() => {
          setHackerOpen(false)
          hackerDoneRef.current?.()
        }}
      />
    </div>
  )
}
