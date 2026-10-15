'use client'

import { useState } from 'react'
import Link from 'next/link'

interface Jenjang { label: string; nama_sekolah: string; npsn: string; kota: string }
const KOSONG: Jenjang = { label: '', nama_sekolah: '', npsn: '', kota: '' }

const input = 'w-full px-4 py-2.5 rounded-xl text-sm text-slate-900 bg-slate-50 border border-slate-200 focus:outline-none focus:ring-2 focus:ring-sky-400/60'

export default function RegistrasiPage() {
  const [f, setF] = useState({ kode_registrasi: '', nama: '', username: '', password: '', no_hp: '' })
  const [jenjang, setJenjang] = useState<Jenjang[]>([{ ...KOSONG }])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [kodeSekolah, setKodeSekolah] = useState('')

  const ubahJenjang = (i: number, k: keyof Jenjang, v: string) =>
    setJenjang(a => a.map((j, x) => (x === i ? { ...j, [k]: v } : j)))

  async function kirim(e: React.FormEvent) {
    e.preventDefault()
    setError(''); setLoading(true)
    try {
      const res = await fetch('/api/public/registrasi', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...f, jenjang }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Registrasi gagal')
      setKodeSekolah(json.data.kode_sekolah)
    } catch (err) {
      setError(err instanceof TypeError ? 'Tidak ada koneksi internet.' : (err as Error).message)
    } finally { setLoading(false) }
  }

  if (kodeSekolah) {
    return (
      <main className="min-h-screen flex items-center justify-center p-4 bg-slate-100">
        <div className="w-full max-w-md bg-white rounded-2xl shadow p-6 text-center space-y-4">
          <h1 className="text-xl font-bold text-slate-800">Registrasi berhasil 🎉</h1>
          <p className="text-sm text-slate-600">Simpan Kode Sekolah ini. Semua guru dan siswa memakainya saat login.</p>
          <div className="text-3xl font-mono font-bold tracking-widest text-sky-700 bg-sky-50 rounded-xl py-3">{kodeSekolah}</div>
          <Link href="/login" className="inline-block px-5 py-2.5 rounded-xl bg-sky-600 text-white font-semibold">Ke halaman login</Link>
        </div>
      </main>
    )
  }

  return (
    <main className="min-h-screen flex items-center justify-center p-4 bg-slate-100">
      <form onSubmit={kirim} className="w-full max-w-xl bg-white rounded-2xl shadow p-6 space-y-5">
        <div>
          <h1 className="text-xl font-bold text-slate-800">Registrasi Sekolah Baru</h1>
          <p className="text-sm text-slate-500 mt-1">Masukkan Kode Registrasi dari developer, lalu isi data admin dan jenjang sekolah Anda.</p>
        </div>
        {error && <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-red-600 text-sm">{error}</div>}

        <div>
          <label className="text-sm font-medium text-slate-600">Kode Registrasi</label>
          <input className={`${input} font-mono uppercase`} placeholder="XXXX-XXXX-XXXX" required
            value={f.kode_registrasi} onChange={e => setF({ ...f, kode_registrasi: e.target.value })} />
        </div>

        <fieldset className="space-y-3">
          <legend className="text-sm font-semibold text-slate-700">Akun Admin Sekolah</legend>
          <input className={input} placeholder="Nama lengkap admin" required value={f.nama} onChange={e => setF({ ...f, nama: e.target.value })} />
          <input className={input} placeholder="Username (4–30 karakter)" required autoComplete="username" value={f.username} onChange={e => setF({ ...f, username: e.target.value })} />
          <input className={input} type="password" placeholder="Password (minimal 8 karakter)" required minLength={8} autoComplete="new-password" value={f.password} onChange={e => setF({ ...f, password: e.target.value })} />
          <input className={input} placeholder="No. HP (opsional)" value={f.no_hp} onChange={e => setF({ ...f, no_hp: e.target.value })} />
        </fieldset>

        <fieldset className="space-y-3">
          <legend className="text-sm font-semibold text-slate-700">Jenjang / Sekolah</legend>
          <p className="text-xs text-slate-500">Satu yayasan bisa punya beberapa jenjang, mis. SMP dan SMA. Tambahkan satu baris per jenjang.</p>
          {jenjang.map((j, i) => (
            <div key={i} className="grid grid-cols-2 gap-2 p-3 rounded-xl border border-slate-200">
              <input className={input} placeholder="Label (mis. SMP)" required value={j.label} onChange={e => ubahJenjang(i, 'label', e.target.value)} />
              <input className={input} placeholder="NPSN (opsional)" value={j.npsn} onChange={e => ubahJenjang(i, 'npsn', e.target.value)} />
              <input className={`${input} col-span-2`} placeholder="Nama sekolah lengkap" required value={j.nama_sekolah} onChange={e => ubahJenjang(i, 'nama_sekolah', e.target.value)} />
              <input className={input} placeholder="Kota (opsional)" value={j.kota} onChange={e => ubahJenjang(i, 'kota', e.target.value)} />
              {jenjang.length > 1 && (
                <button type="button" className="text-sm text-red-600" onClick={() => setJenjang(a => a.filter((_, x) => x !== i))}>Hapus jenjang</button>
              )}
            </div>
          ))}
          {jenjang.length < 10 && (
            <button type="button" className="text-sm text-sky-700 font-medium" onClick={() => setJenjang(a => [...a, { ...KOSONG }])}>+ Tambah jenjang</button>
          )}
        </fieldset>

        <button disabled={loading} className="w-full py-3 rounded-xl bg-sky-600 text-white font-bold disabled:opacity-60">
          {loading ? 'Mendaftarkan...' : 'Daftar'}
        </button>
      </form>
    </main>
  )
}
