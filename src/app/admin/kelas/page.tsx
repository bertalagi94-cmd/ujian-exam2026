'use client'

import { useState, useEffect, useCallback } from 'react'
import { Plus, Pencil, Trash2, School, CreditCard } from 'lucide-react'
import { Modal, Confirm, EmptyState, Spinner, Toast } from '@/components/ui'
import { apiRequest } from '@/lib/utils'
import { Kelas, User } from '@/types'

export default function AdminKelasPage() {
  const [kelas, setKelas] = useState<Kelas[]>([])
  const [users, setUsers] = useState<User[]>([])
  const [loading, setLoading] = useState(true)
  const [modalOpen, setModalOpen] = useState(false)
  const [editData, setEditData] = useState<Partial<Kelas> | null>(null)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null)

  const showToast = (msg: string, type: 'success' | 'error' = 'success') => setToast({ msg, type })

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await apiRequest<{ data: Kelas[] }>('/api/admin/kelas')
      setKelas(res.data)
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Gagal memuat data', 'error')
      console.error(e)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    apiRequest<{ data: User[] }>('/api/admin/users')
      .then(r => setUsers(r.data.filter(u => u.role === 'GURU')))
      .catch(() => {})
  }, [])

  function openAdd() { setEditData({}); setModalOpen(true) }
  function openEdit(k: Kelas) { setEditData(k); setModalOpen(true) }

  // Buka tab cetak kartu siswa
  function cetakKartu(k: Kelas) {
    window.open(`/admin/cetak/kartu-siswa?kelas=${encodeURIComponent(k.nama)}`, '_blank')
  }

  async function handleSave(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = new FormData(e.currentTarget)
    const payload: Record<string, unknown> = Object.fromEntries(form.entries())
    payload.jumlah = Number(payload.jumlah) || 0
    setSaving(true)
    try {
      if (editData?.id) {
        await apiRequest('/api/admin/kelas', { method: 'PUT', body: JSON.stringify({ id: editData.id, ...payload }) })
        showToast('Kelas berhasil diperbarui')
      } else {
        await apiRequest('/api/admin/kelas', { method: 'POST', body: JSON.stringify(payload) })
        showToast('Kelas berhasil ditambahkan')
      }
      setModalOpen(false)
      load()
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Gagal menyimpan', 'error')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!deleteId) return
    setSaving(true)
    try {
      await apiRequest('/api/admin/kelas', { method: 'DELETE', body: JSON.stringify({ id: deleteId }) })
      showToast('Kelas berhasil dihapus')
      setDeleteId(null)
      load()
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Gagal menghapus', 'error')
    } finally {
      setSaving(false)
    }
  }

  const guruMap = Object.fromEntries(users.map(u => [u.username, u.nama]))

  return (
    <div className="space-y-6 animate-fade-in">
      {toast && <Toast message={toast.msg} type={toast.type} onClose={() => setToast(null)} />}

      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="page-title">Data Kelas</h1>
          <p className="page-subtitle">{kelas.length} kelas terdaftar</p>
        </div>
        <button onClick={openAdd} className="btn-primary btn-sm">
          <Plus className="w-4 h-4" /> Tambah Kelas
        </button>
      </div>

      <div className="card p-0 overflow-hidden">
        <div className="table-wrapper">
          {loading ? (
            <div className="flex items-center justify-center py-20">
              <Spinner size="lg" />
            </div>
          ) : kelas.length === 0 ? (
            <EmptyState message="Belum ada kelas terdaftar" icon={School} />
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Nama Kelas</th>
                  <th>Jurusan</th>
                  <th>Wali Kelas</th>
                  <th>Jumlah Siswa</th>
                  <th>Aksi</th>
                </tr>
              </thead>
              <tbody>
                {kelas.map((k, i) => (
                  <tr key={k.id}>
                    <td className="text-slate-400 text-xs">{i + 1}</td>
                    <td>
                      <div className="font-semibold text-slate-800">Kelas {k.nama}</div>
                      <div className="text-xs text-slate-400 font-mono">{k.id}</div>
                    </td>
                    <td className="text-slate-600">{k.jurusan || '-'}</td>
                    <td className="text-slate-600">
                      {k.wali_kelas
                        ? <span>{guruMap[k.wali_kelas] || k.wali_kelas}</span>
                        : <span className="text-slate-400">-</span>
                      }
                    </td>
                    <td>
                      <span className="badge-blue">{k.jumlah ?? 0} siswa</span>
                    </td>
                    <td>
                      <div className="flex items-center gap-1">
                        {/* Tombol cetak kartu siswa */}
                        <button
                          onClick={() => cetakKartu(k)}
                          className="btn-ghost btn-icon btn-sm text-purple-600 hover:bg-purple-50"
                          title={`Cetak Kartu Siswa Kelas ${k.nama}`}
                        >
                          <CreditCard className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => openEdit(k)}
                          className="btn-ghost btn-icon btn-sm text-blue-600 hover:bg-blue-50"
                          title="Edit"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => setDeleteId(k.id)}
                          className="btn-ghost btn-icon btn-sm text-red-600 hover:bg-red-50"
                          title="Hapus"
                        >
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

      {/* Legend ikon */}
      <div className="flex gap-4 text-xs text-slate-400 px-1">
        <span className="flex items-center gap-1"><CreditCard className="w-3.5 h-3.5 text-purple-400" /> Cetak Kartu Siswa</span>
        <span className="flex items-center gap-1"><Pencil className="w-3.5 h-3.5 text-blue-400" /> Edit</span>
        <span className="flex items-center gap-1"><Trash2 className="w-3.5 h-3.5 text-red-400" /> Hapus</span>
      </div>

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editData?.id ? 'Edit Kelas' : 'Tambah Kelas Baru'}
        footer={
          <>
            <button onClick={() => setModalOpen(false)} className="btn-secondary" disabled={saving}>Batal</button>
            <button form="kelas-form" type="submit" className="btn-primary" disabled={saving}>
              {saving ? <Spinner size="sm" /> : (editData?.id ? 'Simpan Perubahan' : 'Tambah Kelas')}
            </button>
          </>
        }
      >
        <form id="kelas-form" onSubmit={handleSave} className="space-y-4">
          <div>
            <label className="label">Nama Kelas *</label>
            <input
              name="nama"
              className="input"
              placeholder="Contoh: 7, 8, 9"
              required
              defaultValue={editData?.nama ?? ''}
            />
            <p className="text-xs text-slate-400 mt-1">Isi angka kelas saja, contoh: 7, 8, 9, 10, 11, 12</p>
          </div>
          <div>
            <label className="label">Jurusan</label>
            <input
              name="jurusan"
              className="input"
              placeholder="Contoh: IPA, IPS, atau - jika tidak ada"
              defaultValue={editData?.jurusan ?? '-'}
            />
          </div>
          <div>
            <label className="label">Wali Kelas</label>
            <select name="wali_kelas" className="select" defaultValue={editData?.wali_kelas ?? ''}>
              <option value="">-- Pilih Wali Kelas --</option>
              {users.map(u => (
                <option key={u.username} value={u.username}>{u.nama}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Jumlah Siswa</label>
            <input
              name="jumlah"
              type="number"
              className="input"
              placeholder="0"
              min={0}
              defaultValue={editData?.jumlah ?? 0}
            />
          </div>
        </form>
      </Modal>

      <Confirm
        open={!!deleteId}
        onClose={() => setDeleteId(null)}
        onConfirm={handleDelete}
        title="Hapus Kelas"
        message="Apakah Anda yakin ingin menghapus kelas ini? Pastikan tidak ada siswa yang masih terdaftar di kelas ini."
        confirmLabel="Ya, Hapus"
        loading={saving}
      />
    </div>
  )
}
