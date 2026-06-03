'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  Save, Settings, School, Shield, WrenchIcon,
  ToggleLeft, ToggleRight, Upload, Trash2, Image, AlertTriangle
} from 'lucide-react'
import { Toast, Spinner, Confirm } from '@/components/ui'
import { apiRequest } from '@/lib/utils'

// Semua key pengaturan yang dikelola
const DEFAULT_SETTINGS: Record<string, string> = {
  namaSekolah: '',
  npsn: '',
  namaKepsek: '',
  nipKepsek: '',
  alamat: '',
  kota: '',
  tahunAjaran: '',
  batasPelanggaran: '3',
  jumlahOpsi: '4',
  logoUrl: '',
  maintenanceAktif: 'false',
  maintenancePesan: '',
  maintenanceMulai: '',
  maintenanceSelesai: '',
}

export default function AdminPengaturanPage() {
  const [values, setValues] = useState<Record<string, string>>(DEFAULT_SETTINGS)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [savingSection, setSavingSection] = useState<string | null>(null)
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null)
  const [logoPreview, setLogoPreview] = useState<string>('')
  const [uploadingLogo, setUploadingLogo] = useState(false)
  const [confirmHapusLogo, setConfirmHapusLogo] = useState(false)

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
      if (merged.logoUrl) setLogoPreview(merged.logoUrl)
    } catch (e) {
      console.error(e)
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
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Gagal menyimpan', 'error')
    } finally {
      setSavingSection(null)
    }
  }

  async function handleLogoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    if (!file.type.startsWith('image/')) {
      showToast('File harus berupa gambar', 'error')
      return
    }
    if (file.size > 2 * 1024 * 1024) {
      showToast('Ukuran gambar maksimal 2MB', 'error')
      return
    }
    setUploadingLogo(true)
    try {
      // Preview lokal
      const reader = new FileReader()
      reader.onload = (ev) => setLogoPreview(ev.target?.result as string)
      reader.readAsDataURL(file)

      // Upload via API
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
    } catch {
      showToast('Gagal menghapus logo', 'error')
    } finally {
      setSaving(false)
      setConfirmHapusLogo(false)
    }
  }

  const isMaintenance = values.maintenanceAktif === 'true'

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Spinner size="lg" />
      </div>
    )
  }

  return (
    <div className="space-y-6 animate-fade-in max-w-3xl">
      {toast && <Toast message={toast.msg} type={toast.type} onClose={() => setToast(null)} />}

      <div>
        <h1 className="page-title">Pengaturan Sistem</h1>
        <p className="page-subtitle">Kelola konfigurasi aplikasi SmartExam</p>
      </div>

      {/* ── Informasi Sekolah ── */}
      <div className="card space-y-5">
        <div className="flex items-center gap-2 pb-3 border-b border-slate-100">
          <School className="w-4 h-4 text-brand-600" />
          <h2 className="font-semibold text-slate-900">Informasi Sekolah</h2>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="sm:col-span-2">
            <label className="label">Nama Sekolah</label>
            <input
              className="input"
              placeholder="Contoh: MTs Alkhairaat Tatakalai"
              value={values.namaSekolah}
              onChange={e => set('namaSekolah', e.target.value)}
            />
          </div>
          <div>
            <label className="label">NPSN</label>
            <input
              className="input"
              placeholder="8 digit NPSN"
              value={values.npsn}
              onChange={e => set('npsn', e.target.value)}
            />
          </div>
          <div>
            <label className="label">Tahun Ajaran</label>
            <input
              className="input"
              placeholder="Contoh: 2025/2026"
              value={values.tahunAjaran}
              onChange={e => set('tahunAjaran', e.target.value)}
            />
          </div>
          <div>
            <label className="label">Nama Kepala Sekolah</label>
            <input
              className="input"
              placeholder="Nama lengkap kepala sekolah"
              value={values.namaKepsek}
              onChange={e => set('namaKepsek', e.target.value)}
            />
          </div>
          <div>
            <label className="label">NIP Kepala Sekolah</label>
            <input
              className="input"
              placeholder="NIP kepala sekolah"
              value={values.nipKepsek}
              onChange={e => set('nipKepsek', e.target.value)}
            />
          </div>
          <div className="sm:col-span-2">
            <label className="label">Alamat Sekolah</label>
            <input
              className="input"
              placeholder="Alamat lengkap sekolah"
              value={values.alamat}
              onChange={e => set('alamat', e.target.value)}
            />
          </div>
          <div>
            <label className="label">Kota / Kabupaten</label>
            <input
              className="input"
              placeholder="Contoh: Banggai Kepulauan"
              value={values.kota}
              onChange={e => set('kota', e.target.value)}
            />
          </div>
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
                <input
                  type="file"
                  accept="image/*"
                  className="sr-only"
                  onChange={handleLogoUpload}
                  disabled={uploadingLogo}
                />
              </label>
              {logoPreview && (
                <button
                  type="button"
                  onClick={() => setConfirmHapusLogo(true)}
                  className="btn-ghost btn-sm text-danger-600 hover:bg-danger-50"
                  disabled={saving}
                >
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
            onClick={() => saveSection(['namaSekolah','npsn','namaKepsek','nipKepsek','alamat','kota','tahunAjaran','logoUrl'], 'Informasi Sekolah')}
            className="btn-primary btn-sm"
            disabled={savingSection === 'Informasi Sekolah'}
          >
            {savingSection === 'Informasi Sekolah' ? <Spinner size="sm" /> : <><Save className="w-4 h-4" /> Simpan</>}
          </button>
        </div>
      </div>

      {/* ── Pengaturan Ujian ── */}
      <div className="card space-y-5">
        <div className="flex items-center gap-2 pb-3 border-b border-slate-100">
          <Settings className="w-4 h-4 text-brand-600" />
          <h2 className="font-semibold text-slate-900">Pengaturan Ujian</h2>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="label">Batas Pelanggaran</label>
            <input
              type="number"
              className="input"
              min={1}
              max={10}
              value={values.batasPelanggaran}
              onChange={e => set('batasPelanggaran', e.target.value)}
            />
            <p className="text-xs text-slate-400 mt-1">
              Jumlah pelanggaran sebelum siswa dikunci otomatis (default: 3)
            </p>
          </div>
          <div>
            <label className="label">Jumlah Opsi Jawaban Default</label>
            <select
              className="select"
              value={values.jumlahOpsi}
              onChange={e => set('jumlahOpsi', e.target.value)}
            >
              <option value="4">4 Opsi (A–D)</option>
              <option value="5">5 Opsi (A–E)</option>
            </select>
            <p className="text-xs text-slate-400 mt-1">
              Default jumlah opsi untuk soal baru
            </p>
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

      {/* ── Maintenance Mode ── */}
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
            {isMaintenance
              ? <><ToggleRight className="w-4 h-4" /> Nonaktifkan</>
              : <><ToggleLeft className="w-4 h-4" /> Aktifkan</>
            }
          </button>
        </div>

        {isMaintenance && (
          <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
            <span>Maintenance mode aktif. Semua pengguna kecuali Admin dan akun IS_TESTER tidak bisa login.</span>
          </div>
        )}

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
              <input
                type="datetime-local"
                className="input"
                value={values.maintenanceMulai}
                onChange={e => set('maintenanceMulai', e.target.value)}
              />
            </div>
            <div>
              <label className="label">Jadwal Selesai</label>
              <input
                type="datetime-local"
                className="input"
                value={values.maintenanceSelesai}
                onChange={e => set('maintenanceSelesai', e.target.value)}
              />
            </div>
          </div>
        </div>

        <div className="pt-2 flex justify-end">
          <button
            type="button"
            onClick={() => saveSection(['maintenanceAktif','maintenancePesan','maintenanceMulai','maintenanceSelesai'], 'Maintenance Mode')}
            className={`btn-sm font-medium ${isMaintenance ? 'btn-danger' : 'btn-primary'}`}
            disabled={savingSection === 'Maintenance Mode'}
          >
            {savingSection === 'Maintenance Mode'
              ? <Spinner size="sm" />
              : <><Save className="w-4 h-4" /> Simpan Maintenance</>
            }
          </button>
        </div>
      </div>

      {/* ── Keamanan ── */}
      <div className="card space-y-4">
        <div className="flex items-center gap-2 pb-3 border-b border-slate-100">
          <Shield className="w-4 h-4 text-brand-600" />
          <h2 className="font-semibold text-slate-900">Info Pengaturan Keamanan</h2>
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

      <Confirm
        open={confirmHapusLogo}
        onClose={() => setConfirmHapusLogo(false)}
        onConfirm={handleHapusLogo}
        title="Hapus Logo Sekolah"
        message="Logo sekolah akan dihapus. Lanjutkan?"
        confirmLabel="Ya, Hapus"
        loading={saving}
      />
    </div>
  )
}
