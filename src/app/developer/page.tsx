'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

interface Yayasan {
  id: string; kode: string; nama: string; status: 'MENUNGGU' | 'AKTIF' | 'NONAKTIF'
  kode_aktif: number; kode_terpakai: number
}
interface KodeBaru { kode_registrasi: string; kode_sekolah: string; nama: string; berlaku_sampai: string }

const input = 'px-3 py-2 rounded-lg text-sm border border-slate-300 bg-white'

export default function DeveloperPage() {
  const router = useRouter()
  const [daftar, setDaftar] = useState<Yayasan[]>([])
  const [form, setForm] = useState({ kode: '', nama: '' })
  const [kodeBaru, setKodeBaru] = useState<KodeBaru | null>(null)
  const [error, setError] = useState('')
  const [ready, setReady] = useState(false)

  const api = useCallback(async (url: string, init?: RequestInit) => {
    const token = localStorage.getItem('token')
    const res = await fetch(url, {
      ...init,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(res.status === 403 ? 'Akun ini bukan developer' : json.error || 'Gagal')
    return json
  }, [])

  const muat = useCallback(async () => {
    try { setDaftar((await api('/api/developer/yayasan')).data) }
    catch (e) { setError((e as Error).message) }
  }, [api])

  useEffect(() => {
    if (!localStorage.getItem('token')) { router.replace('/login'); return }
    setReady(true); muat()
  }, [router, muat])

  async function tambah(e: React.FormEvent) {
    e.preventDefault(); setError('')
    try {
      await api('/api/developer/yayasan', { method: 'POST', body: JSON.stringify(form) })
      setForm({ kode: '', nama: '' }); muat()
    } catch (err) { setError((err as Error).message) }
  }

  async function buatKode(id: string) {
    setError('')
    try { setKodeBaru((await api(`/api/developer/yayasan/${id}/kode`, { method: 'POST' })).data); muat() }
    catch (err) { setError((err as Error).message) }
  }

  async function ubahStatus(id: string, status: string) {
    setError('')
    try { await api(`/api/developer/yayasan/${id}`, { method: 'PATCH', body: JSON.stringify({ status }) }); muat() }
    catch (err) { setError((err as Error).message) }
  }

  if (!ready) return null
  const linkRegistrasi = typeof window !== 'undefined' ? `${window.location.origin}/registrasi` : '/registrasi'

  return (
    <main className="min-h-screen bg-slate-100 p-4 md:p-8">
      <div className="max-w-4xl mx-auto space-y-6">
        <h1 className="text-2xl font-bold text-slate-800">Panel Developer</h1>
        {error && <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-red-600 text-sm">{error}</div>}

        {kodeBaru && (
          <div className="p-4 rounded-2xl bg-emerald-50 border border-emerald-200 space-y-2">
            <p className="text-sm font-semibold text-emerald-800">Kode registrasi untuk {kodeBaru.nama}. Salin sekarang, tidak akan ditampilkan lagi.</p>
            <p className="font-mono text-2xl font-bold tracking-widest text-emerald-900">{kodeBaru.kode_registrasi}</p>
            <p className="text-xs text-emerald-800">Berlaku sampai {new Date(kodeBaru.berlaku_sampai).toLocaleString('id-ID')} · Kode Sekolah untuk login: <b>{kodeBaru.kode_sekolah}</b></p>
            <p className="text-xs text-emerald-800">Kirim ke sekolah beserta tautan: {linkRegistrasi}</p>
            <button className="text-sm underline" onClick={() => navigator.clipboard?.writeText(`Kode Registrasi: ${kodeBaru.kode_registrasi}\nDaftar di: ${linkRegistrasi}`)}>Salin pesan</button>
            <button className="text-sm underline ml-4" onClick={() => setKodeBaru(null)}>Tutup</button>
          </div>
        )}

        <form onSubmit={tambah} className="bg-white rounded-2xl shadow p-4 flex flex-wrap gap-3 items-end">
          <div>
            <label className="block text-xs text-slate-500 mb-1">Kode Sekolah (untuk login)</label>
            <input className={`${input} uppercase font-mono`} placeholder="AGRABIL" required value={form.kode} onChange={e => setForm({ ...form, kode: e.target.value })} />
          </div>
          <div className="flex-1 min-w-[200px]">
            <label className="block text-xs text-slate-500 mb-1">Nama sekolah / yayasan</label>
            <input className={`${input} w-full`} placeholder="Yayasan Contoh" required value={form.nama} onChange={e => setForm({ ...form, nama: e.target.value })} />
          </div>
          <button className="px-4 py-2 rounded-lg bg-sky-600 text-white text-sm font-semibold">Daftarkan</button>
        </form>

        <div className="bg-white rounded-2xl shadow overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-slate-500 border-b">
              <tr><th className="p-3">Kode</th><th className="p-3">Nama</th><th className="p-3">Status</th><th className="p-3">Kode registrasi</th><th className="p-3" /></tr>
            </thead>
            <tbody>
              {daftar.map(y => (
                <tr key={y.id} className="border-b last:border-0">
                  <td className="p-3 font-mono font-semibold">{y.kode}</td>
                  <td className="p-3">{y.nama}</td>
                  <td className="p-3">{y.status === 'MENUNGGU' ? 'Menunggu registrasi' : y.status === 'AKTIF' ? 'Aktif' : 'Nonaktif'}</td>
                  <td className="p-3 text-slate-500">{y.kode_aktif} aktif · {y.kode_terpakai} terpakai</td>
                  <td className="p-3 text-right space-x-3 whitespace-nowrap">
                    {y.status !== 'NONAKTIF' && <button className="text-sky-700 font-medium" onClick={() => buatKode(y.id)}>Buat kode</button>}
                    {y.id !== 'YYS_AWAL' && (y.status === 'NONAKTIF'
                      ? <button className="text-emerald-700" onClick={() => ubahStatus(y.id, 'AKTIF')}>Aktifkan</button>
                      : <button className="text-red-600" onClick={() => ubahStatus(y.id, 'NONAKTIF')}>Nonaktifkan</button>)}
                  </td>
                </tr>
              ))}
              {daftar.length === 0 && <tr><td colSpan={5} className="p-6 text-center text-slate-400">Belum ada data</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </main>
  )
}
