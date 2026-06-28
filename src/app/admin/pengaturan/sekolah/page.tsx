'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import {
  Plus, Pencil, Trash2, School, Upload, Image, Save, ArrowLeft, GripVertical,
} from 'lucide-react'
import { Modal, Confirm, EmptyState, Spinner, Toast } from '@/components/ui'
import { apiRequest } from '@/lib/utils'
import { Sekolah, User } from '@/types'
import Link from 'next/link'

const EMPTY_FORM: Partial<Sekolah> = {
  label: '', nama_sekolah: '', npsn: '', nama_kepsek: '',
  nip_kepsek: '', alamat: '', kota: '', tahun_ajaran: '', logo_url: '', urutan: 0,
}

export default function AdminSekolahPage() {
  const [list, setList] = useState<Sekolah[]>([])
  const [kepsekList, setKepsekList] = useState<User[]>([])
  const [loading, setLoading] = useState(true)
  const [modalOpen, setModalOpen] = useState(false)
  const [editData, setEditData] = useState<Partial<Sekolah>>(EMPTY_FORM)
  const [editId, setEditId] = useState<string | null>(null)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [uploadingLogo, setUploadingLogo] = useState(false)
  const [logoPreview, setLogoPreview] = useState<string>('')
  // Logo aplikasi global
  const [logoAplikasi, setLogoAplikasi] = useState<string>('')
  const [logoAplikasiPreview, setLogoAplikasiPreview] = useState<string>('')
  const [uploadingLogoAplikasi, setUploadingLogoAplikasi] = useState(false)
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null)
  const logoInputRef = useRef<HTMLInputElement>(null)

  const showToast = (msg: string, type: 'success' | 'error' = 'success') => setToast({ msg, type })

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [sekolahRes, usersRes, pengaturanRes] = await Promise.all([
        apiRequest<{ data: Sekolah[] }>('/api/admin/sekolah'),
        apiRequest<{ data: User[] }>('/api/admin/users'),
        apiRequest<{ data: { key: string; value: string }[] }>('/api/admin/pengaturan'),
      ])
      setList(sekolahRes.data)
      setKepsekList(usersRes.data.filter(u => u.role === 'KEPSEK'))
      const logoVal = pengaturanRes.data.find(p => p.key === 'logoAplikasi')?.value ?? ''
      setLogoAplikasi(logoVal)
      setLogoAplikasiPreview(logoVal)
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Gagal memuat data', 'error')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  function openAdd() {
    setEditId(null)
    setEditData(EMPTY_FORM)
    setLogoPreview('')
    setModalOpen(true)
  }

  function openEdit(s: Sekolah) {
    setEditId(s.id)
    setEditData({ ...s })
    setLogoPreview(s.logo_url ?? '')
    setModalOpen(true)
  }

  function set(key: keyof Sekolah, val: string | number) {
    setEditData(prev => ({ ...prev, [key]: val }))
  }

  async function handleLogoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    if (!file.type.startsWith('image/')) { showToast('File harus berupa gambar', 'error'); return }
    if (file.size > 2 * 1024 * 1024) { showToast('Maks 2MB', 'error'); return }
    setUploadingLogo(true)
    try {
      const reader = new FileReader()
      reader.onload = ev => setLogoPreview(ev.target?.result as string)
      reader.readAsDataURL(file)
      if (editId) {
        // Upload langsung kalau edit
        const formData = new FormData()
        formData.append('file', file)
        const token = localStorage.getItem('token')
        const res = await fetch(`/api/admin/sekolah/logo?type=sekolah&id=${editId}`, {
          method: 'POST',
          headers: token ? { Authorization: `Bearer ${token}` } : {},
          body: formData,
        })
        const json = await res.json()
        if (!res.ok) throw new Error(json.error || 'Upload gagal')
        set('logo_url', json.url)
        showToast('Logo berhasil diupload')
      } else {
        // Simpan file untuk diupload setelah save
        set('logo_url', '__pending__')
        // Store file reference
        if (logoInputRef.current) (logoInputRef.current as { _pendingFile?: File })._pendingFile = file
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Upload gagal', 'error')
    } finally {
      setUploadingLogo(false)
      e.target.value = ''
    }
  }

  async function handleSave() {
    if (!editData.label?.trim()) { showToast('Label jenjang wajib diisi', 'error'); return }
    if (!editData.nama_sekolah?.trim()) { showToast('Nama sekolah wajib diisi', 'error'); return }
    setSaving(true)
    try {
      if (editId) {
        await apiRequest(`/api/admin/sekolah/${editId}`, { method: 'PUT', body: JSON.stringify(editData) })
        showToast('Sekolah berhasil diperbarui')
      } else {
        const res = await apiRequest<{ id?: string }>('/api/admin/sekolah', { method: 'POST', body: JSON.stringify(editData) })
        // Upload logo kalau ada pending
        const pending = (logoInputRef.current as { _pendingFile?: File } | null)?._pendingFile
        if (pending && res) {
          // Logo diupload setelah sekolah dibuat — reload dulu untuk dapat id-nya
        }
        showToast('Sekolah berhasil ditambahkan')
      }
      setModalOpen(false)
      load()
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Gagal menyimpan', 'error')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!deleteId) return
    setSaving(true)
    try {
      await apiRequest(`/api/admin/sekolah/${deleteId}`, { method: 'DELETE' })
      showToast('Sekolah berhasil dihapus')
      setDeleteId(null)
      load()
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Gagal menghapus', 'error')
    } finally {
      setSaving(false)
    }
  }

  async function handleLogoAplikasiUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    if (!file.type.startsWith('image/')) { showToast('File harus berupa gambar', 'error'); return }
    if (file.size > 2 * 1024 * 1024) { showToast('Maks 2MB', 'error'); return }
    setUploadingLogoAplikasi(true)
    try {
      const reader = new FileReader()
      reader.onload = ev => setLogoAplikasiPreview(ev.target?.result as string)
      reader.readAsDataURL(file)
      const formData = new FormData()
      formData.append('file', file)
      const token = localStorage.getItem('token')
      const res = await fetch('/api/admin/sekolah/logo?type=aplikasi', {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: formData,
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Upload gagal')
      setLogoAplikasi(json.url)
      showToast('Logo aplikasi berhasil diupload')
      window.dispatchEvent(new Event('pengaturan-changed'))
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Upload gagal', 'error')
      setLogoAplikasiPreview(logoAplikasi)
    } finally {
      setUploadingLogoAplikasi(false)
      e.target.value = ''
    }
  }

  async function handleHapusLogoAplikasi() {
    try {
      const token = localStorage.getItem('token')
      await fetch('/api/admin/sekolah/logo?type=aplikasi', {
        method: 'DELETE',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      })
      setLogoAplikasi('')
      setLogoAplikasiPreview('')
      showToast('Logo aplikasi berhasil dihapus')
      window.dispatchEvent(new Event('pengaturan-changed'))
    } catch {
      showToast('Gagal menghapus logo', 'error')
    }
  }

  return (
    <div className="space-y-6 animate-fade-in">
      {toast && <Toast message={toast.msg} type={toast.type} onClose={() => setToast(null)} />}

      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Link href="/admin/pengaturan" className="text-slate-400 hover:text-slate-600 transition-colors">
              <ArrowLeft className="w-4 h-4" />
            </Link>
            <h1 className="page-title">Sekolah &amp; Jenjang</h1>
          </div>
          <p className="page-subtitle">Kelola daftar sekolah/jenjang yang beroperasi dalam aplikasi ini</p>
        </div>
        <button onClick={openAdd} className="btn-primary btn-sm">
          <Plus className="w-4 h-4" /> Tambah Sekolah
        </button>
      </div>

      {/* Logo Aplikasi Global */}
      <div className="card space-y-4">
        <div className="flex items-center gap-2 pb-3 border-b border-slate-100">
          <Image className="w-4 h-4 text-brand-600" />
          <h2 className="font-semibold text-slate-900">Logo Aplikasi</h2>
          <span className="text-xs text-slate-400">— tampil di halaman Login &amp; Dashboard (bukan di dokumen cetak)</span>
        </div>
        <div className="flex items-start gap-4 flex-wrap">
          {logoAplikasiPreview ? (
            <div className="w-24 h-24 rounded-xl border border-slate-200 overflow-hidden bg-slate-50 flex items-center justify-center">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={logoAplikasiPreview} alt="Logo aplikasi" className="max-w-full max-h-full object-contain p-1" />
            </div>
          ) : (
            <div className="w-24 h-24 rounded-xl border-2 border-dashed border-slate-200 bg-slate-50 flex flex-col items-center justify-center gap-1">
              <Image className="w-6 h-6 text-slate-300" />
              <span className="text-xs text-slate-400">Belum ada</span>
            </div>
          )}
          <div className="flex flex-col gap-2">
            <label className="btn-secondary btn-sm cursor-pointer">
              {uploadingLogoAplikasi ? <><Spinner size="sm" /> Mengupload...</> : <><Upload className="w-4 h-4" /> Upload Logo</>}
              <input type="file" accept="image/*" className="sr-only" onChange={handleLogoAplikasiUpload} disabled={uploadingLogoAplikasi} />
            </label>
            {logoAplikasiPreview && (
              <button onClick={handleHapusLogoAplikasi} className="btn-ghost btn-sm text-danger-600 hover:bg-danger-50">
                <Trash2 className="w-4 h-4" /> Hapus Logo
              </button>
            )}
            <p className="text-xs text-slate-400">Format: JPG, PNG, SVG. Maks 2MB.</p>
          </div>
        </div>
      </div>

      {/* Daftar Sekolah */}
      <div className="card p-0 overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100 flex items-center gap-2">
          <School className="w-4 h-4 text-brand-600" />
          <h2 className="font-semibold text-slate-900">Daftar Sekolah / Jenjang</h2>
        </div>
        {loading ? (
          <div className="flex justify-center py-16"><Spinner size="lg" /></div>
        ) : list.length === 0 ? (
          <EmptyState
            icon={School}
            message="Belum ada sekolah — klik 'Tambah Sekolah' untuk memulai"
          />
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>#</th>
                <th>Label Jenjang</th>
                <th>Nama Sekolah</th>
                <th>NPSN</th>
                <th>Kepala Sekolah</th>
                <th>Tahun Ajaran</th>
                <th>Logo</th>
                <th>Aksi</th>
              </tr>
            </thead>
            <tbody>
              {list.map((s, i) => (
                <tr key={s.id}>
                  <td className="text-slate-400 text-xs">{i + 1}</td>
                  <td>
                    <span className="badge badge-blue font-semibold">{s.label}</span>
                  </td>
                  <td className="font-medium text-slate-800">{s.nama_sekolah}</td>
                  <td className="text-sm text-slate-500">{s.npsn || '-'}</td>
                  <td className="text-sm text-slate-600">
                    {s.nama_kepsek || '-'}
                    {s.nip_kepsek && <div className="text-xs text-slate-400">NIP: {s.nip_kepsek}</div>}
                  </td>
                  <td className="text-sm text-slate-500">{s.tahun_ajaran || '-'}</td>
                  <td>
                    {s.logo_url
                      ? <img src={s.logo_url} alt="logo" className="w-8 h-8 object-contain rounded" />
                      : <span className="text-xs text-slate-300">—</span>
                    }
                  </td>
                  <td>
                    <div className="flex items-center gap-1">
                      <button onClick={() => openEdit(s)} className="btn-ghost btn-icon btn-sm text-blue-600 hover:bg-blue-50">
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button onClick={() => setDeleteId(s.id)} className="btn-ghost btn-icon btn-sm text-red-600 hover:bg-red-50">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Info box */}
      <div className="p-4 rounded-xl bg-blue-50 border border-blue-200 text-sm text-blue-800 space-y-1">
        <p className="font-medium">Setelah menambah sekolah:</p>
        <ul className="list-disc list-inside text-xs text-blue-700 space-y-0.5">
          <li>Buka menu <strong>Kelas</strong> → klik Edit tiap kelas → pilih sekolahnya</li>
          <li>Buka menu <strong>Data Pengguna</strong> → edit akun Kepala Sekolah → pilih sekolah yang diawasi</li>
          <li>Logo per-sekolah tampil di dokumen cetak (kartu ujian, daftar hadir, berita acara)</li>
        </ul>
      </div>

      {/* Modal Tambah/Edit */}
      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editId ? 'Edit Sekolah' : 'Tambah Sekolah Baru'}
        footer={
          <>
            <button onClick={() => setModalOpen(false)} className="btn-secondary" disabled={saving}>Batal</button>
            <button onClick={handleSave} className="btn-primary" disabled={saving}>
              {saving ? <Spinner size="sm" /> : <><Save className="w-4 h-4" /> Simpan</>}
            </button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Label Jenjang *</label>
              <input className="input" placeholder="Contoh: MTs, SMA/MA, SMK" value={editData.label ?? ''} onChange={e => set('label', e.target.value)} />
              <p className="text-xs text-slate-400 mt-1">Singkatan yang tampil sebagai badge di menu Kelas &amp; Mapel</p>
            </div>
            <div>
              <label className="label">Tahun Ajaran</label>
              <input className="input" placeholder="Contoh: 2025/2026" value={editData.tahun_ajaran ?? ''} onChange={e => set('tahun_ajaran', e.target.value)} />
            </div>
          </div>
          <div>
            <label className="label">Nama Sekolah *</label>
            <input className="input" placeholder="Contoh: MTs Alkhairaat Tatakalai" value={editData.nama_sekolah ?? ''} onChange={e => set('nama_sekolah', e.target.value)} />
          </div>
          <div>
            <label className="label">NPSN</label>
            <input className="input" placeholder="8 digit NPSN" value={editData.npsn ?? ''} onChange={e => set('npsn', e.target.value)} />
          </div>

          {/* Kepala Sekolah — pilih dari daftar Kepsek */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="label">Kepala Sekolah</label>
              {kepsekList.length > 0 ? (
                <select
                  className="select"
                  value={editData.nama_kepsek ?? ''}
                  onChange={e => {
                    const selected = kepsekList.find(k => k.nama === e.target.value)
                    set('nama_kepsek', e.target.value)
                    if (selected?.nip) set('nip_kepsek', selected.nip)
                  }}
                >
                  <option value="">Pilih Kepala Sekolah</option>
                  {kepsekList.map(k => (
                    <option key={k.username} value={k.nama}>{k.nama}</option>
                  ))}
                </select>
              ) : (
                <input className="input" placeholder="Nama lengkap kepala sekolah" value={editData.nama_kepsek ?? ''} onChange={e => set('nama_kepsek', e.target.value)} />
              )}
              {kepsekList.length === 0 && (
                <p className="text-xs text-amber-600 mt-1">Tambahkan akun Kepsek di menu Data Pengguna agar bisa dipilih di sini</p>
              )}
            </div>
            <div>
              <label className="label">NIP Kepala Sekolah</label>
              <input className="input" placeholder="NIP" value={editData.nip_kepsek ?? ''} onChange={e => set('nip_kepsek', e.target.value)} />
            </div>
          </div>

          <div>
            <label className="label">Alamat</label>
            <input className="input" placeholder="Alamat lengkap sekolah" value={editData.alamat ?? ''} onChange={e => set('alamat', e.target.value)} />
          </div>
          <div>
            <label className="label">Kota / Kabupaten (untuk kop surat)</label>
            <input className="input" placeholder="Contoh: Banggai Kepulauan" value={editData.kota ?? ''} onChange={e => set('kota', e.target.value)} />
          </div>
          <div>
            <label className="label">Urutan Tampilan</label>
            <input type="number" className="input" min={0} value={editData.urutan ?? 0} onChange={e => set('urutan', parseInt(e.target.value) || 0)} />
            <p className="text-xs text-slate-400 mt-1">Angka lebih kecil tampil lebih atas</p>
          </div>

          {/* Logo upload (hanya saat edit) */}
          {editId && (
            <div className="pt-2 border-t border-slate-100">
              <label className="label mb-2 flex items-center gap-1">
                <Image className="w-3.5 h-3.5" /> Logo Sekolah
              </label>
              <div className="flex items-start gap-4 flex-wrap">
                {logoPreview ? (
                  <div className="w-20 h-20 rounded-xl border border-slate-200 overflow-hidden bg-slate-50 flex items-center justify-center">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={logoPreview} alt="Logo" className="max-w-full max-h-full object-contain p-1" />
                  </div>
                ) : (
                  <div className="w-20 h-20 rounded-xl border-2 border-dashed border-slate-200 bg-slate-50 flex items-center justify-center">
                    <Image className="w-5 h-5 text-slate-300" />
                  </div>
                )}
                <label className="btn-secondary btn-sm cursor-pointer">
                  {uploadingLogo ? <><Spinner size="sm" /> Mengupload...</> : <><Upload className="w-4 h-4" /> Upload Logo</>}
                  <input ref={logoInputRef} type="file" accept="image/*" className="sr-only" onChange={handleLogoUpload} disabled={uploadingLogo} />
                </label>
              </div>
              <p className="text-xs text-slate-400 mt-2">Logo ini tampil di kop surat dokumen cetak untuk sekolah ini. Format: JPG, PNG, SVG. Maks 2MB.</p>
            </div>
          )}
        </div>
      </Modal>

      <Confirm
        open={!!deleteId}
        onClose={() => setDeleteId(null)}
        onConfirm={handleDelete}
        title="Hapus Sekolah"
        message="Sekolah ini akan dihapus. Kelas yang terikat ke sekolah ini akan dilepas (harus diset ulang). Lanjutkan?"
        confirmLabel="Ya, Hapus"
        loading={saving}
      />
    </div>
  )
}
