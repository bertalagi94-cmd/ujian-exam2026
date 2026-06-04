'use client'

import { useState, useEffect, useCallback } from 'react'
import { Plus, Pencil, Trash2, RotateCcw } from 'lucide-react'
import { Modal, Confirm, StatusBadge, SearchInput, EmptyState, Spinner, Toast, Badge } from '@/components/ui'
import { apiRequest, formatDateTime } from '@/lib/utils'
import { User, Mapel } from '@/types'

export default function AdminUsersPage() {
  const [users, setUsers] = useState<User[]>([])
  const [mapelList, setMapelList] = useState<Mapel[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filterRole, setFilterRole] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [editData, setEditData] = useState<Partial<User> | null>(null)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [resetId, setResetId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null)

  const showToast = (msg: string, type: 'success' | 'error' = 'success') => setToast({ msg, type })

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await apiRequest<{ data: User[] }>('/api/admin/users')
      setUsers(res.data)
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

  async function handleSave(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    const payload = Object.fromEntries(fd.entries())
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

  const roleColors: Record<string, string> = {
    ADMIN: 'badge-red',
    GURU: 'badge-blue',
    PENGAWAS: 'badge-yellow',
    KEPSEK: 'badge-purple',
  }

  return (
    <div className="space-y-6 animate-fade-in">
      {toast && <Toast message={toast.msg} type={toast.type} onClose={() => setToast(null)} />}

      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="page-title">Data Pengguna</h1>
          <p className="page-subtitle">{users.length} pengguna terdaftar (guru, admin, pengawas)</p>
        </div>
        <button onClick={() => { setEditData({}); setModalOpen(true) }} className="btn-primary btn-sm">
          <Plus className="w-4 h-4" /> Tambah Pengguna
        </button>
      </div>

      {/* Filters */}
      <div className="card py-4 flex gap-3 flex-wrap">
        <SearchInput value={search} onChange={setSearch} placeholder="Cari nama atau username..." className="flex-1 min-w-[200px]" />
        <select value={filterRole} onChange={e => setFilterRole(e.target.value)} className="select w-40">
          <option value="">Semua Role</option>
          {['ADMIN', 'GURU', 'PENGAWAS', 'KEPSEK'].map(r => (
            <option key={r} value={r}>{r}</option>
          ))}
        </select>
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
                    <td className="font-medium text-slate-800">{u.nama}</td>
                    <td>
                      <span className={`badge ${roleColors[u.role] ?? 'badge-slate'}`}>{u.role}</span>
                    </td>
                    <td><StatusBadge status={u.status} /></td>
                    <td className="text-xs text-slate-400">
                      {u.last_login ? formatDateTime(u.last_login) : 'Belum pernah'}
                    </td>
                    <td>
                      <div className="flex items-center gap-1">
                        <button onClick={() => { setEditData(u); setModalOpen(true) }}
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
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Role *</label>
              <select name="role" className="select" required defaultValue={editData?.role ?? 'GURU'}>
                <option value="ADMIN">Admin</option>
                <option value="GURU">Guru</option>
                <option value="PENGAWAS">Pengawas</option>
                <option value="KEPSEK">Kepala Sekolah</option>
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
            <label className="label">Mata Pelajaran (untuk Guru)</label>
            <select name="mapel_id" className="select" defaultValue={editData?.mapel_id ?? ''}>
              <option value="">- Tidak ada -</option>
              {mapelList.map(m => <option key={m.id} value={m.id}>{m.nama}</option>)}
            </select>
          </div>
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
