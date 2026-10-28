'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'

const input = 'w-full px-4 py-2.5 rounded-xl text-sm text-slate-900 bg-slate-50 border border-slate-200 focus:outline-none focus:ring-2 focus:ring-sky-400/60'

// Pengajuan aktivasi sekolah baru. Hanya masuk antrean; sekolah bisa dipakai
// setelah developer menyetujui (lihat /developer).
export default function AktivasiPage() {
  const [dibuka, setDibuka] = useState<boolean | null>(null)
  const [f, setF] = useState({ nama_sekolah: '', npsn: '', username: '', password: '', ulangi: '', no_hp: '', website: '' })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [terkirim, setTerkirim] = useState(false)

  useEffect(() => {
    fetch('/api/public/pengajuan').then(r => r.json()).then(j => setDibuka(!!j?.data?.dibuka)).catch(() => setDibuka(false))
  }, [])

  async function kirim(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (f.password !== f.ulangi) { setError('Konfirmasi password tidak sama'); return }
    setLoading(true)
    try {
      const { ulangi, ...isi } = f
      const res = await fetch('/api/public/pengajuan', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(isi),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error || 'Pengajuan gagal')
      setTerkirim(true)
    } catch (err) {
      setError(err instanceof TypeError ? 'Tidak ada koneksi internet.' : (err as Error).message)
    } finally { setLoading(false) }
  }

  const Kartu = ({ children }: { children: React.ReactNode }) => (
    <main className="min-h-screen flex items-center justify-center p-4 bg-slate-100">
      <div className="w-full max-w-md bg-white rounded-2xl shadow p-6 space-y-4">{children}</div>
    </main>
  )

  if (dibuka === null) return null

  if (!dibuka) {
    return (
      <Kartu>
        <h1 className="text-xl font-bold text-slate-800">Aktivasi Sekolah Baru</h1>
        <p className="text-sm text-slate-600">Pendaftaran sekolah baru belum dibuka.</p>
        <Link href="/login" className="text-sm text-sky-700 font-medium">← Kembali ke login</Link>
      </Kartu>
    )
  }

  if (terkirim) {
    return (
      <Kartu>
        <h1 className="text-xl font-bold text-slate-800">Pengajuan terkirim</h1>
        <p className="text-sm text-slate-600">
          Pengajuan aktivasi <b>{f.nama_sekolah}</b> sedang menunggu persetujuan. Setelah disetujui,
          login memakai username <b>{f.username}</b> dan password yang baru Anda isi; akun itu otomatis
          menjadi admin sekolah.
        </p>
        <p className="text-xs text-slate-500">Sebelum disetujui, mencoba login akan menampilkan status pengajuan.</p>
        <Link href="/login" className="inline-block text-sm text-sky-700 font-medium">← Kembali ke login</Link>
      </Kartu>
    )
  }

  return (
    <main className="min-h-screen flex items-center justify-center p-4 bg-slate-100">
      <form onSubmit={kirim} className="w-full max-w-md bg-white rounded-2xl shadow p-6 space-y-4">
        <div>
          <h1 className="text-xl font-bold text-slate-800">Aktivasi Sekolah Baru</h1>
          <p className="text-sm text-slate-500 mt-1">Isi data berikut. Pengajuan akan diperiksa dulu sebelum sekolah Anda bisa memakai aplikasi.</p>
        </div>
        {error && <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-red-600 text-sm">{error}</div>}

        <div>
          <label className="text-sm font-medium text-slate-600">Nama sekolah</label>
          <input className={input} required minLength={3} maxLength={120} value={f.nama_sekolah}
            onChange={e => setF({ ...f, nama_sekolah: e.target.value })} />
        </div>
        <div>
          <label className="text-sm font-medium text-slate-600">NPSN</label>
          <input className={input} required inputMode="numeric" pattern="\d{8}" maxLength={8} placeholder="8 digit" value={f.npsn}
            onChange={e => setF({ ...f, npsn: e.target.value.replace(/\D/g, '') })} />
        </div>
        <div>
          <label className="text-sm font-medium text-slate-600">Username admin</label>
          <input className={input} required minLength={4} maxLength={30} autoComplete="username" autoCapitalize="none" value={f.username}
            onChange={e => setF({ ...f, username: e.target.value })} />
          <p className="text-xs text-slate-400 mt-1">4–30 karakter: huruf, angka, titik, strip, garis bawah.</p>
        </div>
        <div>
          <label className="text-sm font-medium text-slate-600">Password</label>
          <input type="password" className={input} required minLength={8} maxLength={72} autoComplete="new-password" value={f.password}
            onChange={e => setF({ ...f, password: e.target.value })} />
        </div>
        <div>
          <label className="text-sm font-medium text-slate-600">Ulangi password</label>
          <input type="password" className={input} required autoComplete="new-password" value={f.ulangi}
            onChange={e => setF({ ...f, ulangi: e.target.value })} />
        </div>
        <div>
          <label className="text-sm font-medium text-slate-600">No. WhatsApp <span className="text-slate-400 font-normal">(opsional, untuk kabar persetujuan)</span></label>
          <input className={input} inputMode="tel" maxLength={20} value={f.no_hp}
            onChange={e => setF({ ...f, no_hp: e.target.value })} />
        </div>

        {/* Honeypot: disembunyikan dari manusia, bot biasanya mengisinya. */}
        <div aria-hidden="true" style={{ position: 'absolute', left: '-10000px', width: 1, height: 1, overflow: 'hidden' }}>
          <label>Website</label>
          <input tabIndex={-1} autoComplete="off" value={f.website} onChange={e => setF({ ...f, website: e.target.value })} />
        </div>

        <button disabled={loading} className="w-full py-3 rounded-xl bg-sky-600 text-white font-semibold disabled:opacity-60">
          {loading ? 'Mengirim...' : 'Registrasi'}
        </button>
        <Link href="/login" className="block text-center text-sm text-slate-500">← Kembali ke login</Link>
      </form>
    </main>
  )
}
