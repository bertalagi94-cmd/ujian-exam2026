'use client'

import { useState, useEffect, useCallback } from 'react'
import { Plus, Pencil, Trash2, BookOpen, Search } from 'lucide-react'
import { Modal, Confirm, EmptyState, Spinner, Toast, SearchInput } from '@/components/ui'
import { apiRequest } from '@/lib/utils'
import { Mapel, User, Kelas } from '@/types'

export default function AdminMapelPage() {
  const [mapel, setMapel] = useState<Mapel[]>([])
  const [users, setUsers] = useState<User[]>([])
  const [kelas, setKelas] = useState<Kelas[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [editData, setEditData] = useState<Partial<Mapel> | null>(null)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null)
  // kelas_list checkboxes state
  const [selectedKelas, setSelectedKelas] = useState<string[]>([])

  const showToast = (msg: string, type: 'success' | 'error' = 'success') => {
    setToast({ msg, type })
  }

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await apiRequest<{ data: Mapel[] }>('/api/admin/mapel')
      setMapel(res.data)
    } catch (e) {
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
    apiRequest<{ data: Kelas[] }>('/api/admin/kelas')
      .then(r => setKelas(r.data))
      .catch(() => {})
  }, [])

  function openAdd() {
    setEditData({})
    setSelectedKelas([])
    setModalOpen(true)
  }

  function openEdit(m: Mapel) {
    setEditData(m)
    setSelectedKelas(m.kelas_list ? m.kelas_list.split(',').map(s => s.trim()).filter(Boolean) : [])
    setModalOpen(true)
  }

  function toggleKelas(nama: string) {
    setSelectedKelas(prev =>
      prev.includes(nama) ? prev.filter(k => k !== nama) : [...prev, nama]
    )
  }

  async function handleSave(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = new FormData(e.currentTarget)
    const payload: Record<string, unknown> = Object.fromEntries(form.entries())
    payload.jumlah_opsi = Number(payload.jumlah_opsi) || 4
    payload.kkm = Number(payload.kkm) || 75
    payload.kelas_list = selectedKelas.join(',')

    setSaving(true)
    try {
      if (editData?.id) {
        await apiRequest('/api/admin/mapel', { method: 'PUT', body: JSON.stringify({ id: editData.id, ...payload }) })
        showToast('Mata pelajaran berhasil diperbarui')
      } else {
        await apiRequest('/api/admin/mapel', { method: 'POST', body: JSON.stringify(payload) })
        showToast('Mata pelajaran berhasil ditambahkan')
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
      await apiRequest('/api/admin/mapel', { method: 'DELETE', body: JSON.stringify({ id: deleteId }) })
      showToast('Mata pelajaran berhasil dihapus')
      setDeleteId(null)
      load()
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Gagal menghapus', 'error')
    } finally {
      setSaving(false)
    }
  }

  const filtered = mapel.filter(m =>
    !search || m.nama.toLowerCase().includes(search.toLowerCase()) ||
    (m.nama_guru ?? '').toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div className="space-y-6 animate-fade-in">
      {toast && <Toast message={toast.msg} type={toast.type} onClose={() => setToast(null)} />}

      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="page-title">Mata Pelajaran</h1>
          <p className="page-subtitle">{mapel.length} mata pelajaran terdaftar</p>
        </div>
        <button onClick={openAdd} className="btn-primary btn-sm">
          <Plus className="w-4 h-4" /> Tambah Mapel
        </button>
      </div>

      {/* Filter */}
      <div className="card py-4">
        <SearchInput
          value={search}
          onChange={v => setSearch(v)}
          placeholder="Cari nama mapel atau guru..."
          className="max-w-sm"
        />
      </div>

      {/* Table */}
      <div className="card p-0 overflow-hidden">
        <div className="table-wrapper">
          {loading ? (
            <div className="flex items-center justify-center py-20">
              <Spinner size="lg" />
            </div>
          ) : filtered.length === 0 ? (
            <EmptyState message="Tidak ada mata pelajaran ditemukan" icon={search ? Search : BookOpen} />
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Nama Mapel</th>
                  <th>Guru Pengampu</th>
                  <th>Kelas</th>
                  <th>Jml Opsi</th>
                  <th>KKM</th>
                  <th>Aksi</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((m, i) => (
                  <tr key={m.id}>
                    <td className="text-slate-400 text-xs">{i + 1}</td>
                    <td>
                      <div className="font-semibold text-slate-800">{m.nama}</div>
                      <div className="text-xs text-slate-400 font-mono">{m.id}</div>
                    </td>
                    <td className="text-slate-600">
                      {m.nama_guru
                        ? <span>{m.nama_guru}</span>
                        : <span className="text-slate-400 text-xs">Belum ditentukan</span>
                      }
                    </td>
                    <td>
                      <div className="flex flex-wrap gap-1">
                        {m.kelas_list
                          ? m.kelas_list.split(',').map(k => (
                              <span key={k} className="badge-blue">{k.trim()}</span>
                            ))
                          : <span className="text-slate-400 text-xs">-</span>
                        }
                      </div>
                    </td>
                    <td className="text-center text-slate-600">{m.jumlah_opsi}</td>
                    <td>
                      <span className={`font-semibold text-sm ${m.kkm >= 75 ? 'text-green-600' : 'text-amber-600'}`}>
                        {m.kkm}
                      </span>
                    </td>
                    <td>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => openEdit(m)}
                          className="btn-ghost btn-icon btn-sm text-blue-600 hover:bg-blue-50"
                          title="Edit"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => setDeleteId(m.id)}
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

      {/* Modal Form */}
      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editData?.id ? 'Edit Mata Pelajaran' : 'Tambah Mata Pelajaran'}
        footer={
          <>
            <button onClick={() => setModalOpen(false)} className="btn-secondary" disabled={saving}>Batal</button>
            <button form="mapel-form" type="submit" className="btn-primary" disabled={saving}>
              {saving ? <Spinner size="sm" /> : (editData?.id ? 'Simpan Perubahan' : 'Tambah Mapel')}
            </button>
          </>
        }
      >
        <form id="mapel-form" onSubmit={handleSave} className="space-y-4">
          <div>
            <label className="label">Nama Mata Pelajaran *</label>
            <input
              name="nama"
              className="input"
              placeholder="Contoh: MATEMATIKA"
              required
              defaultValue={editData?.nama ?? ''}
            />
          </div>
          <div>
            <label className="label">Guru Pengampu</label>
            <select name="guru_id" className="select" defaultValue={editData?.guru_id ?? ''}>
              <option value="">-- Pilih Guru --</option>
              {users.map(u => (
                <option key={u.username} value={u.username}>{u.nama}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Kelas yang Diajar</label>
            {kelas.length === 0 ? (
              <p className="text-xs text-slate-400">Belum ada kelas. Tambahkan kelas terlebih dahulu.</p>
            ) : (
              <div className="flex flex-wrap gap-2 mt-1">
                {kelas.map(k => (
                  <label
                    key={k.id}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border cursor-pointer text-sm transition-colors
                      ${selectedKelas.includes(String(k.nama))
                        ? 'bg-brand-50 border-brand-400 text-brand-700 font-medium'
                        : 'border-slate-200 text-slate-600 hover:border-slate-300'
                      }`}
                  >
                    <input
                      type="checkbox"
                      className="sr-only"
                      checked={selectedKelas.includes(String(k.nama))}
                      onChange={() => toggleKelas(String(k.nama))}
                    />
                    Kelas {k.nama}
                  </label>
                ))}
              </div>
            )}
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Jumlah Opsi Jawaban</label>
              <select name="jumlah_opsi" className="select" defaultValue={editData?.jumlah_opsi ?? 4}>
                <option value={4}>4 Opsi (A–D)</option>
                <option value={5}>5 Opsi (A–E)</option>
              </select>
            </div>
            <div>
              <label className="label">KKM</label>
              <input
                name="kkm"
                type="number"
                className="input"
                placeholder="75"
                min={0}
                max={100}
                defaultValue={editData?.kkm ?? 75}
              />
            </div>
          </div>
        </form>
      </Modal>

      {/* Confirm Delete */}
      <Confirm
        open={!!deleteId}
        onClose={() => setDeleteId(null)}
        onConfirm={handleDelete}
        title="Hapus Mata Pelajaran"
        message="Apakah Anda yakin ingin menghapus mata pelajaran ini? Data soal dan jadwal terkait juga akan terpengaruh."
        confirmLabel="Ya, Hapus"
        loading={saving}
      />
    </div>
  )
}
