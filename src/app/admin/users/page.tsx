'use client'

import { useState, useEffect, useCallback } from 'react'
import { Plus, Pencil, Trash2, RotateCcw, Building2 } from 'lucide-react'
import { Modal, Confirm, StatusBadge, SearchInput, EmptyState, Spinner, Toast } from '@/components/ui'
import { apiRequest, formatDateTime } from '@/lib/utils'
import { User, Mapel, Sekolah } from '@/types'

// Role "Pengawas" SENGAJA tidak ada di sini. Pengawas bukan role akun yang
// berdiri sendiri — kapabilitas mengawasi ujian otomatis aktif di akun GURU
// ketika admin menugaskannya lewat menu Jadwal Ujian (kolom jadwal.pengawas
// diisi username guru tersebut). Lihat src/app/guru/mode-pengawas.
const ALL_ROLES = ['ADMIN', 'GURU', 'KEPSEK'] as const
const ROLE_TABS = [
  { value: '', label: 'Semua' },
  { value: 'ADMIN', label: 'Admin' },
  { value: 'GURU', label: 'Guru' },
  { value: 'KEPSEK', label: 'Kepsek' },
]
const roleColors: Record<string, string> = {
  ADMIN: 'badge-red',
  GURU: 'badge-blue',
  KEPSEK: 'badge-purple',
}

export default function AdminUsersPage() {
  const [users, setUsers] = useState<User[]>([])
  const [mapelList, setMapelList] = useState<Mapel[]>([])
  const [sekolahList, setSekolahList] = useState<Sekolah[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filterRole, setFilterRole] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [editData, setEditData] = useState<Partial<User> | null>(null)
  const [formRole, setFormRole] = useState<string>('GURU')
  const [formNip, setFormNip] = useState('')
  const [formSekolahId, setFormSekolahId] = useState('')
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [resetId, setResetId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null)

  const showToast = (msg: string, type: 'success' | 'error' = 'success') => setToast({ msg, type })

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [usersRes, sekolahRes] = await Promise.all([
        apiRequest<{ data: User[] }>('/api/admin/users'),
        apiRequest<{ data: Sekolah[] }>('/api/admin/sekolah'),
      ])
      setUsers(usersRes.data)
      setSekolahList(sekolahRes.data)
    } finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])
  useEffect(() => {
    apiRequest<{ data: Mapel[] }>('/api/admin/mapel').then(r => setMapelList(r.data))
  }, [])

  const filtered = users.filter(u => {
    const matchSearch = !search ||
      u.nama.toLowerCase().includes(search.toLowerCase()) ||
      u.username.toLowerCase().includes(search.toLowerCase())
    const matchRole = !filterRole || u.role === filterRole
    return matchSearch && matchRole
  })

  function openAdd() {
    setEditData({})
    setFormRole('GURU')
    setFormNip('')
    setFormSekolahId('')
    setModalOpen(true)
  }

  function openEdit(u: User) {
    setEditData(u)
    setFormRole(u.role)
    setFormNip(u.nip ?? '')
    setFormSekolahId(u.sekolah_id ?? '')
    setModalOpen(true)
  }

  async function handleSave(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    const payload = {
      ...Object.fromEntries(fd.entries()),
      nip: formNip,
      sekolah_id: formRole === 'KEPSEK' ? (formSekolahId || null) : null,
    }
    setSaving(true)
    try {
      if (editData?.username) {
        await apiRequest(`/api/admin/users/${editData.username}`, { method: 'PUT', body: JSON.stringify(payload) })
        showToast('Data pengguna berhasil diperbarui')
      } else {
        await apiRequest('/api/admin/users', { method: 'POST', body: JSON.stringify(payload) })
        showToast('Pengguna berhasil ditambahkan')
      }
      setModalOpen(false)
      load()
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Gagal menyimpan', 'error')
    } finally { setSaving(false) }
  }

  async function handleDelete() {
    if (!deleteId) return
    setSaving(true)
    try {
      await apiRequest(`/api/admin/users/${deleteId}`, { method: 'DELETE' })
      showToast('Pengguna berhasil dihapus')
      setDeleteId(null)
      load()
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Gagal menghapus', 'error')
    } finally { setSaving(false) }
  }

  async function handleReset() {
    if (!resetId) return
    setSaving(true)
    try {
      await apiRequest(`/api/admin/users/${resetId}/reset-password`, { method: 'POST' })
      showToast('Password berhasil direset ke username')
      setResetId(null)
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Gagal reset', 'error')
    } finally { setSaving(false) }
  }

  return (
    <div className="space-y-6 animate-fade-in">
      {toast && <Toast message={toast.msg} type={toast.type} onClose={() => setToast(null)} />}

      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="page-title">Data Pengguna</h1>
          <p className="page-subtitle">{users.length} pengguna terdaftar</p>
        </div>
        <button onClick={openAdd} className="btn-primary btn-sm">
          <Plus className="w-4 h-4" /> Tambah Pengguna
        </button>
      </div>

      {/* Filter */}
      <div className="card py-3 flex gap-3 flex-wrap items-center">
        <SearchInput value={search} onChange={setSearch} placeholder="Cari nama atau username..." className="flex-1 min-w-[200px]" />
        {/* Tab role */}
        <div className="flex gap-1 bg-slate-100 p-1 rounded-xl">
          {ROLE_TABS.map(tab => (
            <button
              key={tab.value}
              onClick={() => setFilterRole(tab.value)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                filterRole === tab.value
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              {tab.label}
              <span className="ml-1 text-slate-400">
                ({tab.value ? users.filter(u => u.role === tab.value).length : users.length})
              </span>
            </button>
          ))}
        </div>
      </div>

      <div className="card p-0 overflow-hidden">
        <div className="table-wrapper">
          {loading ? (
            <div className="flex justify-center py-20"><Spinner size="lg" /></div>
          ) : filtered.length === 0 ? (
            <EmptyState message="Tidak ada pengguna ditemukan" />
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Username</th>
                  <th>Nama</th>
                  <th>Role</th>
                  <th>Sekolah</th>
                  <th>Status</th>
                  <th>Last Login</th>
                  <th>Aksi</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((u, i) => (
                  <tr key={u.username}>
                    <td className="text-slate-400 text-xs">{i + 1}</td>
                    <td className="font-mono text-xs text-slate-600">{u.username}</td>
                    <td>
                      <div className="font-medium text-slate-800">{u.nama}</div>
                      {u.nip && <div className="text-xs text-slate-400">NIP: {u.nip}</div>}
                    </td>
                    <td>
                      <span className={`badge ${roleColors[u.role] ?? 'badge-slate'}`}>{u.role}</span>
                    </td>
                    <td>
                      {u.role === 'KEPSEK' ? (
                        u.sekolah ? (
                          <span className="badge badge-blue">{u.sekolah.label}</span>
                        ) : (
                          <span className="text-xs text-amber-600">Belum diset</span>
                        )
                      ) : (
                        <span className="text-slate-300 text-xs">—</span>
                      )}
                    </td>
                    <td><StatusBadge status={u.status} /></td>
                    <td className="text-xs text-slate-400">
                      {u.last_login ? formatDateTime(u.last_login) : 'Belum pernah'}
                    </td>
                    <td>
                      <div className="flex items-center gap-1">
                        <button onClick={() => openEdit(u)}
                          className="btn-ghost btn-icon btn-sm text-blue-600 hover:bg-blue-50">
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button onClick={() => setResetId(u.username)}
                          className="btn-ghost btn-icon btn-sm text-amber-600 hover:bg-amber-50">
                          <RotateCcw className="w-3.5 h-3.5" />
                        </button>
                        <button onClick={() => setDeleteId(u.username)}
                          className="btn-ghost btn-icon btn-sm text-red-600 hover:bg-red-50">
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
      </div>

      {/* Form Modal */}
      <Modal open={modalOpen} onClose={() => setModalOpen(false)}
        title={editData?.username ? 'Edit Pengguna' : 'Tambah Pengguna Baru'}
        footer={
          <>
            <button onClick={() => setModalOpen(false)} className="btn-secondary" disabled={saving}>Batal</button>
            <button form="user-form" type="submit" className="btn-primary" disabled={saving}>
              {saving ? <Spinner size="sm" /> : (editData?.username ? 'Simpan' : 'Tambah')}
            </button>
          </>
        }
      >
        <form id="user-form" onSubmit={handleSave} className="space-y-4">
          {!editData?.username && (
            <div>
              <label className="label">Username *</label>
              <input name="username" className="input" required placeholder="username unik" />
            </div>
          )}
          <div>
            <label className="label">Nama Lengkap *</label>
            <input name="nama" className="input" required defaultValue={editData?.nama} />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="label">Role *</label>
              <select
                name="role"
                className="select"
                required
                value={formRole}
                onChange={e => { setFormRole(e.target.value); if (e.target.value !== 'KEPSEK') setFormSekolahId('') }}
              >
                {ALL_ROLES.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Status</label>
              <select name="status" className="select" defaultValue={editData?.status ?? 'AKTIF'}>
                <option value="AKTIF">Aktif</option>
                <option value="NONAKTIF">Nonaktif</option>
              </select>
            </div>
          </div>
          <div>
            <label className="label">Nomor WhatsApp</label>
            <input
              name="no_hp"
              className="input"
              placeholder="contoh: 6281234567890"
              defaultValue={editData?.no_hp ?? ''}
            />
            <p className="text-xs text-slate-400 mt-1">Format internasional tanpa tanda "+", dipakai untuk notifikasi WA.</p>
          </div>

          {/* NIP — tampil untuk semua role, wajib untuk Kepsek */}
          <div>
            <label className="label">NIP{formRole === 'KEPSEK' ? ' *' : ''}</label>
            <input
              className="input"
              placeholder="Nomor Induk Pegawai"
              value={formNip}
              onChange={e => setFormNip(e.target.value)}
              required={formRole === 'KEPSEK'}
            />
            {formRole === 'KEPSEK' && (
              <p className="text-xs text-slate-400 mt-1">NIP Kepsek digunakan otomatis di dokumen cetak (kop surat).</p>
            )}
          </div>

          {/* Sekolah yang diawasi — HANYA untuk Kepsek */}
          {formRole === 'KEPSEK' && (
            <div>
              <label className="label flex items-center gap-1">
                <Building2 className="w-3.5 h-3.5" /> Sekolah yang Diawasi *
              </label>
              {sekolahList.length > 0 ? (
                <select
                  className="select"
                  value={formSekolahId}
                  onChange={e => setFormSekolahId(e.target.value)}
                  required
                >
                  <option value="">-- Pilih Sekolah --</option>
                  {sekolahList.map(s => (
                    <option key={s.id} value={s.id}>{s.label} — {s.nama_sekolah}</option>
                  ))}
                </select>
              ) : (
                <div className="input bg-slate-50 text-slate-400">
                  Belum ada sekolah — tambahkan di Pengaturan → Sekolah &amp; Jenjang
                </div>
              )}
              <p className="text-xs text-slate-400 mt-1">
                Kepsek hanya dapat melihat data kelas yang terdaftar di sekolah ini.
              </p>
            </div>
          )}

          {/* Mapel yang diampu (tampil-only saat edit guru) */}
          {formRole === 'GURU' && editData?.username && (
            <div>
              <label className="label">Mata Pelajaran yang Diampu</label>
              <div className="flex flex-wrap gap-1.5 border border-slate-200 rounded-lg px-3 py-2.5 bg-slate-50 min-h-[42px]">
                {mapelList.filter(m => m.guru_id === editData?.username).length === 0 ? (
                  <span className="text-xs text-slate-400">Belum mengampu mapel apa pun</span>
                ) : (
                  mapelList.filter(m => m.guru_id === editData?.username).map(m => (
                    <span key={m.id} className="badge-blue text-xs">
                      {m.nama}{m.kelas_list ? ` (${m.kelas_list})` : ''}
                    </span>
                  ))
                )}
              </div>
              <p className="text-xs text-slate-400 mt-1">
                Diatur dari menu <span className="font-medium">Mata Pelajaran</span>.
              </p>
            </div>
          )}

          {!editData?.username && (
            <div>
              <label className="label">Password *</label>
              <input name="password" type="password" className="input" required placeholder="Password awal" />
            </div>
          )}
        </form>
      </Modal>

      <Confirm open={!!deleteId} onClose={() => setDeleteId(null)} onConfirm={handleDelete}
        title="Hapus Pengguna" message="Pengguna ini akan dihapus permanen. Lanjutkan?"
        confirmLabel="Ya, Hapus" loading={saving} />
      <Confirm open={!!resetId} onClose={() => setResetId(null)} onConfirm={handleReset}
        title="Reset Password" message="Password akan direset ke username. Lanjutkan?"
        confirmLabel="Reset" variant="primary" loading={saving} />
    </div>
  )
}
