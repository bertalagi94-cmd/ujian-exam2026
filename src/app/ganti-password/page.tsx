'use client'

import { useEffect, useState } from 'react'
import { apiRequest } from '@/lib/utils'

const ROUTES: Record<string, string> = { ADMIN: '/admin', GURU: '/guru', KEPSEK: '/kepsek', SISWA: '/siswa' }

export default function GantiPasswordPage() {
  const [role, setRole] = useState<string>('')
  const [lama, setLama] = useState('')
  const [baru, setBaru] = useState('')
  const [konfirmasi, setKonfirmasi] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    try {
      const token = localStorage.getItem('token')
      const user = JSON.parse(localStorage.getItem('user') ?? 'null') as { role?: string } | null
      if (!token || !user?.role) { window.location.href = '/login'; return }
      setRole(user.role)
    } catch {
      window.location.href = '/login'
    }
  }, [])

  const minPanjang = role === 'SISWA' ? 6 : 8

  async function simpan(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (baru.length < minPanjang) { setError(`Password baru minimal ${minPanjang} karakter`); return }
    if (baru !== konfirmasi) { setError('Konfirmasi password tidak sama'); return }
    setLoading(true)
    try {
      const url = role === 'SISWA' ? '/api/siswa/ganti-password' : '/api/akun/ganti-password'
      const data = await apiRequest<{ token?: string }>(url, {
        method: 'PUT',
        body: JSON.stringify({ passwordLama: lama, passwordBaru: baru }),
      })
      if (data.token) localStorage.setItem('token', data.token)
      window.location.href = ROUTES[role] ?? '/login'
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal mengganti password')
    } finally {
      setLoading(false)
    }
  }

  const input = 'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500'

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-100 p-4">
      <form onSubmit={simpan} className="w-full max-w-md rounded-2xl bg-white p-6 shadow space-y-4">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Ganti Password</h1>
          <p className="mt-1 text-sm text-gray-600">
            Anda masih memakai password bawaan. Buat password baru sebelum melanjutkan.
          </p>
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">Password lama</label>
          <input type="password" className={input} value={lama} onChange={e => setLama(e.target.value)} autoComplete="current-password" required />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">Password baru (minimal {minPanjang} karakter)</label>
          <input type="password" className={input} value={baru} onChange={e => setBaru(e.target.value)} autoComplete="new-password" required />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">Ulangi password baru</label>
          <input type="password" className={input} value={konfirmasi} onChange={e => setKonfirmasi(e.target.value)} autoComplete="new-password" required />
        </div>
        {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        <button type="submit" disabled={loading || !role}
          className="w-full rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60">
          {loading ? 'Menyimpan...' : 'Simpan Password'}
        </button>
        <button type="button" className="w-full text-sm text-gray-500 hover:text-gray-700"
          onClick={() => { localStorage.removeItem('token'); localStorage.removeItem('user'); window.location.href = '/login' }}>
          Keluar
        </button>
      </form>
    </div>
  )
}
