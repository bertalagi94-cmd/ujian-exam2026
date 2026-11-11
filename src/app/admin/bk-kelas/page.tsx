'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { Spinner, Toast, EmptyState } from '@/components/ui'
import { apiRequest } from '@/lib/utils'
import { HeartHandshake } from 'lucide-react'

interface GuruBk { username: string; nama: string; status?: string; kelas_ids: string[] }
interface Kelas { id: string; nama: string }

export default function KelasBinaanBkPage() {
  const [bk, setBk] = useState<GuruBk[]>([])
  const [kelas, setKelas] = useState<Kelas[]>([])
  const [loading, setLoading] = useState(true)
  const [edit, setEdit] = useState<GuruBk | null>(null)
  const [pilih, setPilih] = useState<Set<string>>(new Set())
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await apiRequest<{ bk: GuruBk[]; kelas: Kelas[] }>('/api/admin/bk-kelas')
      setBk(r.bk); setKelas(r.kelas)
    } catch (e) {
      setToast({ msg: e instanceof Error ? e.message : 'Gagal memuat', type: 'error' })
    } finally { setLoading(false) }
  }, [])
  useEffect(() => { load() }, [load])

  const namaKelas = (id: string) => kelas.find(k => k.id === id)?.nama ?? id

  // kelas_id → guru BK pembinanya (satu kelas hanya boleh satu guru BK).
  const pemegang = new Map<string, GuruBk>()
  for (const g of bk) for (const id of g.kelas_ids) pemegang.set(id, g)

  function buka(g: GuruBk) { setEdit(g); setPilih(new Set(g.kelas_ids)) }
  function toggle(id: string) {
    setPilih(p => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n })
  }

  // Kelas yang sudah dibina guru BK LAIN tidak bisa ikut dipilih.
  const kelasBisaDipilih = edit
    ? kelas.filter(k => { const l = pemegang.get(k.id); return !l || l.username === edit.username })
    : []
  const jumlahTerkunci = kelas.length - kelasBisaDipilih.length
  const semuaBisaTerpilih = kelasBisaDipilih.length > 0 && kelasBisaDipilih.every(k => pilih.has(k.id))
  const sebagianTerpilih = !semuaBisaTerpilih && kelasBisaDipilih.some(k => pilih.has(k.id))
  function togglePilihSemua() {
    setPilih(p => {
      const n = new Set(p)
      if (semuaBisaTerpilih) kelasBisaDipilih.forEach(k => n.delete(k.id))
      else kelasBisaDipilih.forEach(k => n.add(k.id))
      return n
    })
  }

  async function simpan() {
    if (!edit) return
    setSaving(true)
    try {
      const r = await apiRequest<{ message: string }>('/api/admin/bk-kelas', {
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
        <h1 className="page-title flex items-center gap-2">
          <HeartHandshake className="w-6 h-6 text-pink-600" /> Kelas Binaan BK
        </h1>
        <p className="page-subtitle">
          Tetapkan kelas yang dibina tiap guru BK. Guru BK hanya dapat melihat siswa, pelanggaran, dan nilai dari kelas binaannya.
        </p>
      </div>

      {loading ? <div className="flex justify-center py-16"><Spinner /></div> : bk.length === 0 ? (
        <div className="card">
          <EmptyState message="Belum ada akun guru BK" icon={HeartHandshake} />
          <p className="text-sm text-slate-500 text-center pb-6">
            Buat akun dengan role <strong>BK</strong> di menu{' '}
            <Link href="/admin/users" className="text-brand-600 underline">Data Pengguna</Link>, lalu atur kelasnya di sini.
          </p>
        </div>
      ) : (
        <div className="card divide-y divide-slate-100">
          {bk.map(g => (
            <div key={g.username} className="flex items-center justify-between gap-4 p-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="font-medium text-slate-900 truncate">{g.nama}</p>
                  <span className="text-xs text-slate-400 font-mono">{g.username}</span>
                  {g.status && g.status !== 'AKTIF' && (
                    <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-500 text-xs">{g.status}</span>
                  )}
                </div>
                {g.kelas_ids.length > 0 ? (
                  <div className="flex flex-wrap gap-1 mt-1.5">
                    {g.kelas_ids.map(id => (
                      <span key={id} className="px-2 py-0.5 rounded-md bg-pink-50 border border-pink-200 text-pink-700 text-xs">
                        Kelas {namaKelas(id)}
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-amber-600 mt-1">Belum ada kelas binaan — belum bisa melihat data apa pun.</p>
                )}
              </div>
              <button className="btn-secondary text-sm" onClick={() => buka(g)}>Atur kelas</button>
            </div>
          ))}
        </div>
      )}

      {edit && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-2xl p-6 w-full max-w-md space-y-4 max-h-[85vh] overflow-y-auto">
            <h2 className="font-semibold text-lg">Kelas binaan {edit.nama}</h2>
            {kelas.length > 0 && (
              <div className="space-y-1.5">
                <label className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-sm font-medium ${
                  kelasBisaDipilih.length === 0 ? 'border-slate-200 bg-slate-50 text-slate-400 cursor-not-allowed'
                  : semuaBisaTerpilih ? 'border-pink-500 bg-pink-50 cursor-pointer' : 'border-slate-300 cursor-pointer'}`}>
                  <input
                    type="checkbox"
                    disabled={kelasBisaDipilih.length === 0}
                    checked={semuaBisaTerpilih}
                    ref={el => { if (el) el.indeterminate = sebagianTerpilih }}
                    onChange={togglePilihSemua}
                  />
                  Pilih semua kelas yang tersedia ({kelasBisaDipilih.length})
                </label>
                {jumlahTerkunci > 0 && (
                  <p className="text-xs text-amber-700">
                    {jumlahTerkunci} kelas sedang dibina guru BK lain dan tidak bisa dipilih. Lepaskan dulu dari guru tersebut bila perlu.
                  </p>
                )}
              </div>
            )}
            <div className="grid grid-cols-3 gap-2">
              {kelas.map(k => {
                const lain = pemegang.get(k.id)
                const terkunci = !!lain && lain.username !== edit.username
                return (
                  <label key={k.id} title={terkunci ? `Dibina ${lain!.nama}` : undefined}
                    className={`flex flex-col gap-0.5 px-3 py-2 rounded-lg border text-sm ${
                      terkunci ? 'border-slate-200 bg-slate-50 text-slate-400 cursor-not-allowed'
                      : pilih.has(k.id) ? 'border-pink-500 bg-pink-50 cursor-pointer' : 'border-slate-200 cursor-pointer'}`}>
                    <span className="flex items-center gap-2">
                      <input type="checkbox" disabled={terkunci} checked={pilih.has(k.id)} onChange={() => toggle(k.id)} />
                      {k.nama}
                    </span>
                    {terkunci && <span className="text-[10px] leading-tight truncate">Dibina {lain!.nama}</span>}
                  </label>
                )
              })}
            </div>
            <p className="text-xs text-slate-500">Kosongkan semua pilihan untuk melepas semua kelas binaan.</p>
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
