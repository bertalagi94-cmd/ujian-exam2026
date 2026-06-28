'use client'

import { useState, useEffect, useCallback } from 'react'
import { Pencil, Trash2, School, CreditCard, AlertTriangle, Building2 } from 'lucide-react'
import { Modal, EmptyState, Spinner, Toast } from '@/components/ui'
import { apiRequest } from '@/lib/utils'
import { Kelas, User, Sekolah } from '@/types'

export default function AdminKelasPage() {
  const [kelas, setKelas] = useState<Kelas[]>([])
  const [users, setUsers] = useState<User[]>([])
  const [sekolahList, setSekolahList] = useState<Sekolah[]>([])
  const [loading, setLoading] = useState(true)

  const [editOpen, setEditOpen] = useState(false)
  const [editData, setEditData] = useState<Partial<Kelas> | null>(null)
  const [editSekolahId, setEditSekolahId] = useState<string>('')
  const [editWaliKelas, setEditWaliKelas] = useState<string>('')
  const [saving, setSaving] = useState(false)

  const [deleteTarget, setDeleteTarget] = useState<Kelas | null>(null)
  const [deleteConfirmText, setDeleteConfirmText] = useState('')

  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null)
  const showToast = (msg: string, type: 'success' | 'error' = 'success') => setToast({ msg, type })

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [kelasRes, usersRes, sekolahRes] = await Promise.all([
        apiRequest<{ data: Kelas[] }>('/api/admin/kelas'),
        apiRequest<{ data: User[] }>('/api/admin/users'),
        apiRequest<{ data: Sekolah[] }>('/api/admin/sekolah'),
      ])
      setKelas(kelasRes.data)
      setUsers(usersRes.data.filter(u => u.role === 'GURU'))
      setSekolahList(sekolahRes.data)
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Gagal memuat data', 'error')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const guruMap = Object.fromEntries(users.map(u => [u.username, u.nama]))

  function cetakKartu(k: Kelas) {
    if (!k.sekolah_id) {
      showToast(`Kelas ${k.nama} belum diatur sekolahnya. Edit kelas ini dan pilih sekolah terlebih dahulu.`, 'error')
      return
    }
    if (!k.wali_kelas) {
      showToast(`Wali kelas untuk Kelas ${k.nama} belum diisi.`, 'error')
      return
    }
    window.open(`/admin/cetak/kartu-siswa?kelas=${encodeURIComponent(k.nama)}`, '_blank')
  }

  function openEdit(k: Kelas) {
    setEditData(k)
    setEditSekolahId(k.sekolah_id ?? '')
    setEditWaliKelas(k.wali_kelas ?? '')
    setEditOpen(true)
  }

  async function handleSave() {
    if (!editData) return
    setSaving(true)
    try {
      await apiRequest('/api/admin/kelas', {
        method: 'PUT',
        body: JSON.stringify({
          nama: editData.nama,
          wali_kelas: editWaliKelas || null,
          sekolah_id: editSekolahId || null,
        }),
      })
      showToast('Data kelas berhasil disimpan')
      setEditOpen(false)
      load()
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Gagal menyimpan', 'error')
    } finally {
      setSaving(false)
    }
  }

  function openDelete(k: Kelas) {
    setDeleteTarget(k)
    setDeleteConfirmText('')
  }

  async function handleDelete() {
    if (!deleteTarget) return
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

  const belumAdaSekolah = sekolahList.length === 0

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

      {/* Peringatan kalau belum ada sekolah */}
      {belumAdaSekolah && (
        <div className="p-4 rounded-xl bg-amber-50 border border-amber-200 flex items-start gap-3 text-sm text-amber-800">
          <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <span>
            Belum ada data sekolah/jenjang. Buka <strong>Pengaturan → Sekolah &amp; Jenjang</strong> untuk menambahkan sekolah terlebih dahulu,
            kemudian kembali ke sini dan set sekolah untuk tiap kelas.
          </span>
        </div>
      )}

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
                  <th>Sekolah / Jenjang</th>
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
                      {k.sekolah ? (
                        <span className="badge badge-blue">{k.sekolah.label}</span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-amber-600 text-xs font-medium">
                          <AlertTriangle className="w-3 h-3" /> Belum diset
                        </span>
                      )}
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
                        <button
                          onClick={() => cetakKartu(k)}
                          className="btn-ghost btn-icon btn-sm text-purple-600 hover:bg-purple-50"
                          title={k.wali_kelas ? `Cetak Kartu Siswa Kelas ${k.nama}` : 'Wali kelas/sekolah belum diisi'}
                        >
                          <CreditCard className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => openEdit(k)}
                          className="btn-ghost btn-icon btn-sm text-blue-600 hover:bg-blue-50"
                          title="Edit Kelas"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
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

      <div className="flex gap-4 text-xs text-slate-400 px-1">
        <span className="flex items-center gap-1"><CreditCard className="w-3.5 h-3.5 text-purple-400" /> Cetak Kartu Siswa</span>
        <span className="flex items-center gap-1"><Pencil className="w-3.5 h-3.5 text-blue-400" /> Edit Kelas</span>
        <span className="flex items-center gap-1"><Trash2 className="w-3.5 h-3.5 text-red-400" /> Hapus Kelas</span>
      </div>

      {/* ── Modal Edit Kelas ── */}
      <Modal
        open={editOpen}
        onClose={() => setEditOpen(false)}
        title={`Edit Kelas ${editData?.nama ?? ''}`}
        footer={
          <>
            <button onClick={() => setEditOpen(false)} className="btn-secondary" disabled={saving}>Batal</button>
            <button onClick={handleSave} className="btn-primary" disabled={saving}>
              {saving ? <Spinner size="sm" /> : 'Simpan'}
            </button>
          </>
        }
      >
        <div className="space-y-4">
          {/* Sekolah / Jenjang */}
          <div>
            <label className="label flex items-center gap-1">
              <Building2 className="w-3.5 h-3.5" /> Sekolah / Jenjang
            </label>
            {sekolahList.length > 0 ? (
              <select className="select" value={editSekolahId} onChange={e => setEditSekolahId(e.target.value)}>
                <option value="">-- Pilih Sekolah --</option>
                {sekolahList.map(s => (
                  <option key={s.id} value={s.id}>{s.label} — {s.nama_sekolah}</option>
                ))}
              </select>
            ) : (
              <div className="input bg-slate-50 text-slate-400 cursor-not-allowed">
                Belum ada sekolah — tambahkan di Pengaturan → Sekolah &amp; Jenjang
              </div>
            )}
            {!editSekolahId && (
              <p className="text-xs text-amber-600 mt-1 flex items-center gap-1">
                <AlertTriangle className="w-3 h-3" />
                Sekolah wajib diisi agar dokumen cetak dapat menampilkan kop surat yang benar
              </p>
            )}
          </div>

          {/* Wali Kelas */}
          <div>
            <label className="label">Wali Kelas</label>
            <select className="select" value={editWaliKelas} onChange={e => setEditWaliKelas(e.target.value)}>
              <option value="">-- Pilih Wali Kelas (opsional) --</option>
              {users.map(u => (
                <option key={u.username} value={u.username}>{u.nama}</option>
              ))}
            </select>
            <p className="text-xs text-slate-400 mt-1">
              Wali kelas wajib diisi agar kartu siswa dapat dicetak.
            </p>
          </div>
        </div>
      </Modal>

      {/* ── Modal Konfirmasi Hapus Kelas ── */}
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
