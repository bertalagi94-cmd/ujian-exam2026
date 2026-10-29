'use client'

import { useState, useEffect, useCallback } from 'react'
import { Spinner, Toast } from '@/components/ui'
import { apiRequest } from '@/lib/utils'

interface Guru { username: string; nama: string; status?: string; kelas_ids: string[] }
interface Kelas { id: string; nama: string }

export default function AdminKelasKelolaPage() {
  const [guru, setGuru] = useState<Guru[]>([])
  const [kelas, setKelas] = useState<Kelas[]>([])
  const [loading, setLoading] = useState(true)
  const [edit, setEdit] = useState<Guru | null>(null)
  const [pilih, setPilih] = useState<Set<string>>(new Set())
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await apiRequest<{ guru: Guru[]; kelas: Kelas[] }>('/api/admin/admin-kelas')
      setGuru(r.guru); setKelas(r.kelas)
    } catch (e) {
      setToast({ msg: e instanceof Error ? e.message : 'Gagal memuat', type: 'error' })
    } finally { setLoading(false) }
  }, [])
  useEffect(() => { load() }, [load])

  const namaKelas = (id: string) => kelas.find(k => k.id === id)?.nama ?? id

  function buka(g: Guru) { setEdit(g); setPilih(new Set(g.kelas_ids)) }
  function toggle(id: string) {
    setPilih(p => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n })
  }

  async function simpan() {
    if (!edit) return
    setSaving(true)
    try {
      const r = await apiRequest<{ message: string }>('/api/admin/admin-kelas', {
        method: 'PUT',
        body: JSON.stringify({ username: edit.username, kelas_ids: [...pilih] }),
      })
      setToast({ msg: r.message, type: 'success' })
      setEdit(null)
      load()
    } catch (e) {
      setToast({ msg: e instanceof Error ? e.message : 'Gagal menyimpan', type: 'error' })
    } finally { setSaving(false) }
  }

  return (
    <div className="space-y-6 animate-fade-in">
      {toast && <Toast message={toast.msg} type={toast.type} onClose={() => setToast(null)} />}
      <div>
        <h1 className="page-title">Admin Kelas</h1>
        <p className="page-subtitle">
          Tunjuk guru untuk memvalidasi paket soal di kelas tertentu. Kelas tanpa Admin Kelas tetap divalidasi Super Admin.
        </p>
      </div>

      {loading ? <div className="flex justify-center py-16"><Spinner /></div> : (
        <div className="card divide-y divide-slate-100">
          {guru.map(g => (
            <div key={g.username} className="flex items-center justify-between gap-4 p-4">
              <div className="min-w-0">
                <p className="font-medium text-slate-900 truncate">{g.nama}</p>
                <p className="text-xs text-slate-500">
                  {g.kelas_ids.length
                    ? `Admin Kelas: ${g.kelas_ids.map(namaKelas).join(', ')}`
                    : 'Bukan Admin Kelas'}
                </p>
              </div>
              <button className="btn-secondary text-sm" onClick={() => buka(g)}>Atur kelas</button>
            </div>
          ))}
        </div>
      )}

      {edit && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-2xl p-6 w-full max-w-md space-y-4 max-h-[85vh] overflow-y-auto">
            <h2 className="font-semibold text-lg">Kelas untuk {edit.nama}</h2>
            <div className="grid grid-cols-3 gap-2">
              {kelas.map(k => (
                <label key={k.id} className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-sm cursor-pointer ${
                  pilih.has(k.id) ? 'border-emerald-500 bg-emerald-50' : 'border-slate-200'}`}>
                  <input type="checkbox" checked={pilih.has(k.id)} onChange={() => toggle(k.id)} />
                  {k.nama}
                </label>
              ))}
            </div>
            <p className="text-xs text-slate-500">Kosongkan semua pilihan untuk mencabut status Admin Kelas.</p>
            <div className="flex justify-end gap-2">
              <button className="btn-secondary" onClick={() => setEdit(null)} disabled={saving}>Batal</button>
              <button className="btn-primary" onClick={simpan} disabled={saving}>{saving ? 'Menyimpan…' : 'Simpan'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
