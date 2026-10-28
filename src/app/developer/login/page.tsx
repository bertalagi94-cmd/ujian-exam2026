'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

// Login akun developer. Token disimpan di kunci 'dev_token' (BUKAN 'token'),
// sehingga tidak pernah tercampur dengan sesi admin/guru/siswa di perangkat yang sama.
export default function LoginDeveloperPage() {
  const router = useRouter()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    try { if (localStorage.getItem('dev_token')) router.replace('/developer') } catch { /* abaikan */ }
  }, [router])

  async function masuk(e: React.FormEvent) {
    e.preventDefault()
    setError(''); setLoading(true)
    try {
      const res = await fetch('/api/developer/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) { setError(json.error || 'Gagal masuk'); return }
      localStorage.setItem('dev_token', json.token)
      localStorage.setItem('dev_user', JSON.stringify({ username: json.username, nama: json.nama }))
      router.replace('/developer')
    } catch {
      setError('Tidak bisa terhubung ke server')
    } finally {
      setLoading(false)
    }
  }

  const input = 'w-full px-3 py-2.5 rounded-lg text-sm border border-slate-300 bg-white'

  return (
    <main className="min-h-screen bg-slate-100 flex items-center justify-center p-4">
      <form onSubmit={masuk} className="w-full max-w-sm bg-white rounded-2xl shadow p-6 space-y-4">
        <div>
          <h1 className="text-xl font-bold text-slate-800">Masuk Developer</h1>
          <p className="text-xs text-slate-500 mt-1">Khusus pengelola aplikasi. Akun ini terpisah dari akun sekolah.</p>
        </div>
        {error && <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-red-600 text-sm">{error}</div>}
        <div>
          <label className="block text-xs text-slate-500 mb-1">Username</label>
          <input className={input} autoComplete="username" required value={username} onChange={e => setUsername(e.target.value)} />
        </div>
        <div>
          <label className="block text-xs text-slate-500 mb-1">Password</label>
          <input className={input} type="password" autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)} />
        </div>
        <button disabled={loading} className="w-full py-2.5 rounded-lg bg-sky-600 text-white text-sm font-semibold disabled:opacity-60">
          {loading ? 'Masuk...' : 'Masuk'}
        </button>
        <button type="button" onClick={() => router.push('/login')} className="w-full text-center text-xs text-slate-500 hover:underline">
          ← Kembali ke halaman login sekolah
        </button>
      </form>
    </main>
  )
}
