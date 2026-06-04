'use client'

import { useState, useEffect, useCallback } from 'react'
import { Pencil, Trash2, School, CreditCard, AlertTriangle } from 'lucide-react'
import { Modal, Confirm, EmptyState, Spinner, Toast } from '@/components/ui'
import { apiRequest } from '@/lib/utils'
import { Kelas, User } from '@/types'

export default function AdminKelasPage() {
  const [kelas, setKelas] = useState<Kelas[]>([])
  const [users, setUsers] = useState<User[]>([])
  const [loading, setLoading] = useState(true)

  // Modal edit wali kelas
  const [editOpen, setEditOpen] = useState(false)
  const [editData, setEditData] = useState<Partial<Kelas> | null>(null)
  const [saving, setSaving] = useState(false)

  // Konfirmasi hapus kelas
  const [deleteTarget, setDeleteTarget] = useState<Kelas | null>(null)
  const [deleteConfirmText, setDeleteConfirmText] = useState('')

  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null)
  const showToast = (msg: string, type: 'success' | 'error' = 'success') => setToast({ msg, type })

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await apiRequest<{ data: Kelas[] }>('/api/admin/kelas')
      setKelas(res.data)
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Gagal memuat data', 'error')
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

  const guruMap = Object.fromEntries(users.map(u => [u.username, u.nama]))

  // ── Cetak kartu siswa ──────────────────────────────────────────────────
  function cetakKartu(k: Kelas) {
    if (!k.wali_kelas) {
      showToast(`Wali kelas untuk Kelas ${k.nama} belum diisi. Silakan input wali kelas terlebih dahulu.`, 'error')
      return
    }
    window.open(`/admin/cetak/kartu-siswa?kelas=${encodeURIComponent(k.nama)}`, '_blank')
  }

  // ── Edit wali kelas ────────────────────────────────────────────────────
  function openEdit(k: Kelas) {
    setEditData(k)
    setEditOpen(true)
  }

  async function handleSaveWali(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!editData) return
    const form = new FormData(e.currentTarget)
    const wali_kelas = form.get('wali_kelas') as string
    setSaving(true)
    try {
      await apiRequest('/api/admin/kelas', {
        method: 'PUT',
        body: JSON.stringify({ nama: editData.nama, wali_kelas }),
      })
      showToast('Wali kelas berhasil disimpan')
      setEditOpen(false)
      load()
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Gagal menyimpan', 'error')
    } finally {
      setSaving(false)
    }
  }

  // ── Hapus kelas ────────────────────────────────────────────────────────
  function openDelete(k: Kelas) {
    setDeleteTarget(k)
    setDeleteConfirmText('')
  }

  async function handleDelete() {
    if (!deleteTarget) return
    // Pastikan user mengetik nama kelas dengan benar
    if (deleteConfirmText.trim() !== deleteTarget.nama) {
      showToast('Nama kelas tidak sesuai. Penghapusan dibatalkan.', 'error')
      return
    }
    setSaving(true)
    try {
      await apiRequest('/api/admin/kelas', {
        method: 'DELETE',
        body: JSON.stringify({ nama: deleteTarget.nama }),
      })
      showToast(`Kelas ${deleteTarget.nama} dan semua siswanya berhasil dihapus`)
      setDeleteTarget(null)
      load()
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Gagal menghapus', 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-6 animate-fade-in">
      {toast && <Toast message={toast.msg} type={toast.type} onClose={() => setToast(null)} />}

      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="page-title">Data Kelas</h1>
          <p className="page-subtitle">
            {kelas.length} kelas · muncul otomatis dari data siswa
          </p>
        </div>
      </div>

      <div className="card p-0 overflow-hidden">
        <div className="table-wrapper">
          {loading ? (
            <div className="flex items-center justify-center py-20">
              <Spinner size="lg" />
            </div>
          ) : kelas.length === 0 ? (
            <EmptyState message="Belum ada kelas — tambahkan data siswa terlebih dahulu" icon={School} />
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Nama Kelas</th>
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
                    </td>
                    <td>
                      {k.wali_kelas ? (
                        <span className="text-slate-700">{guruMap[k.wali_kelas] || k.wali_kelas}</span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-amber-600 text-xs font-medium">
                          <AlertTriangle className="w-3 h-3" /> Belum diisi
                        </span>
                      )}
                    </td>
                    <td>
                      <span className="badge-blue">{k.jumlah ?? 0} siswa</span>
                    </td>
                    <td>
                      <div className="flex items-center gap-1">
                        {/* Cetak kartu siswa */}
                        <button
                          onClick={() => cetakKartu(k)}
                          className="btn-ghost btn-icon btn-sm text-purple-600 hover:bg-purple-50"
                          title={k.wali_kelas ? `Cetak Kartu Siswa Kelas ${k.nama}` : 'Wali kelas belum diisi'}
                        >
                          <CreditCard className="w-3.5 h-3.5" />
                        </button>
                        {/* Edit wali kelas */}
                        <button
                          onClick={() => openEdit(k)}
                          className="btn-ghost btn-icon btn-sm text-blue-600 hover:bg-blue-50"
                          title="Set Wali Kelas"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        {/* Hapus kelas */}
                        <button
                          onClick={() => openDelete(k)}
                          className="btn-ghost btn-icon btn-sm text-red-600 hover:bg-red-50"
                          title="Hapus Kelas"
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
        <span className="flex items-center gap-1"><Pencil className="w-3.5 h-3.5 text-blue-400" /> Set Wali Kelas</span>
        <span className="flex items-center gap-1"><Trash2 className="w-3.5 h-3.5 text-red-400" /> Hapus Kelas</span>
      </div>

      {/* ── Modal Edit Wali Kelas ── */}
      <Modal
        open={editOpen}
        onClose={() => setEditOpen(false)}
        title={`Wali Kelas — Kelas ${editData?.nama ?? ''}`}
        footer={
          <>
            <button onClick={() => setEditOpen(false)} className="btn-secondary" disabled={saving}>Batal</button>
            <button form="wali-form" type="submit" className="btn-primary" disabled={saving}>
              {saving ? <Spinner size="sm" /> : 'Simpan'}
            </button>
          </>
        }
      >
        <form id="wali-form" onSubmit={handleSaveWali} className="space-y-4">
          <div>
            <label className="label">Wali Kelas *</label>
            <select name="wali_kelas" className="select" required defaultValue={editData?.wali_kelas ?? ''}>
              <option value="">-- Pilih Wali Kelas --</option>
              {users.map(u => (
                <option key={u.username} value={u.username}>{u.nama}</option>
              ))}
            </select>
            <p className="text-xs text-slate-400 mt-1">
              Wali kelas wajib diisi agar kartu siswa dapat dicetak.
            </p>
          </div>
        </form>
      </Modal>

      {/* ── Modal Konfirmasi Hapus Kelas (dengan ketik ulang nama) ── */}
      <Modal
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        title="⚠️ Hapus Kelas — Tindakan Berbahaya"
        footer={
          <>
            <button onClick={() => setDeleteTarget(null)} className="btn-secondary" disabled={saving}>Batal</button>
            <button
              onClick={handleDelete}
              className="btn-danger"
              disabled={saving || deleteConfirmText.trim() !== (deleteTarget?.nama ?? '')}
            >
              {saving ? <Spinner size="sm" /> : 'Ya, Hapus Semua'}
            </button>
          </>
        }
      >
        <div className="space-y-4">
          {/* Peringatan merah */}
          <div className="bg-red-50 border border-red-200 rounded-lg p-3 flex gap-2">
            <AlertTriangle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
            <div className="text-sm text-red-700 space-y-1">
              <p className="font-semibold">Tindakan ini tidak dapat dibatalkan!</p>
              <p>
                Menghapus <span className="font-bold">Kelas {deleteTarget?.nama}</span> akan
                sekaligus menghapus <span className="font-bold">semua {deleteTarget?.jumlah ?? 0} siswa</span> yang
                terdaftar di kelas ini secara permanen.
              </p>
            </div>
          </div>

          {/* Konfirmasi ketik nama kelas */}
          <div>
            <label className="label">
              Ketik <span className="font-bold text-slate-800">{deleteTarget?.nama}</span> untuk mengkonfirmasi
            </label>
            <input
              className="input"
              placeholder={`Ketik: ${deleteTarget?.nama}`}
              value={deleteConfirmText}
              onChange={e => setDeleteConfirmText(e.target.value)}
              autoComplete="off"
            />
          </div>
        </div>
      </Modal>
    </div>
  )
}
