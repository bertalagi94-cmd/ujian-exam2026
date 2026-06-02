'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Eye, EyeOff, BookOpen, Lock, User, AlertCircle } from 'lucide-react'

export default function LoginPage() {
  const router = useRouter()
  const [form, setForm] = useState({ username: '', password: '' })
  const [showPw, setShowPw] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    if (!form.username || !form.password) {
      setError('Username dan password wajib diisi')
      return
    }
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Login gagal')

      localStorage.setItem('token', data.token)
      localStorage.setItem('user', JSON.stringify({
        username: data.username,
        nama: data.nama,
        role: data.role,
        nis: data.nis,
        kelas: data.kelas,
      }))

      const roleRoutes: Record<string, string> = {
        ADMIN: '/admin',
        GURU: '/guru',
        PENGAWAS: '/pengawas',
        KEPSEK: '/kepsek',
        GURU_KEPSEK: '/guru',
        SISWA: '/siswa',
      }
      router.push(roleRoutes[data.role] ?? '/login')
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Login gagal')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex bg-gradient-to-br from-brand-950 via-brand-900 to-brand-800">
      {/* Left — branding */}
      <div className="hidden lg:flex flex-col justify-between w-1/2 p-12 text-white relative overflow-hidden">
        {/* decorative circles */}
        <div className="absolute -top-20 -left-20 w-80 h-80 rounded-full bg-white/5" />
        <div className="absolute top-1/3 -right-20 w-64 h-64 rounded-full bg-white/5" />
        <div className="absolute -bottom-20 left-1/4 w-96 h-96 rounded-full bg-white/5" />

        <div className="relative z-10">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 bg-white/20 rounded-xl flex items-center justify-center backdrop-blur">
              <BookOpen className="w-5 h-5 text-white" />
            </div>
            <span className="font-bold text-xl">SmartExam</span>
          </div>
          <p className="text-brand-300 text-sm">Computer Based Test System</p>
        </div>

        <div className="relative z-10 space-y-6">
          <div>
            <h1 className="text-4xl font-bold leading-tight mb-3">
              Ujian Digital<br />Lebih Mudah & Adil
            </h1>
            <p className="text-brand-300 text-sm leading-relaxed max-w-xs">
              Sistem CBT modern untuk MTS Alkhairaat Tatakalai dengan fitur anti-nyontek,
              penilaian otomatis, dan monitoring real-time.
            </p>
          </div>
          <div className="grid grid-cols-3 gap-4">
            {[
              { n: '122+', l: 'Siswa' },
              { n: '1800+', l: 'Bank Soal' },
              { n: '41', l: 'Mata Pelajaran' },
            ].map(({ n, l }) => (
              <div key={l} className="bg-white/10 backdrop-blur rounded-xl p-4 text-center">
                <div className="text-2xl font-bold">{n}</div>
                <div className="text-brand-300 text-xs mt-1">{l}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="relative z-10 text-brand-400 text-xs">
          MTS Alkhairaat Tatakalai &copy; {new Date().getFullYear()}
        </div>
      </div>

      {/* Right — login form */}
      <div className="flex-1 flex items-center justify-center p-6">
        <div className="w-full max-w-sm">
          {/* mobile logo */}
          <div className="lg:hidden flex items-center gap-2 mb-8 justify-center">
            <div className="w-8 h-8 bg-white/20 rounded-xl flex items-center justify-center">
              <BookOpen className="w-4 h-4 text-white" />
            </div>
            <span className="font-bold text-white text-lg">SmartExam</span>
          </div>

          <div className="bg-white rounded-3xl shadow-card-lg p-8">
            <div className="mb-8">
              <h2 className="text-2xl font-bold text-slate-900">Selamat Datang</h2>
              <p className="text-slate-500 text-sm mt-1">Masuk ke akun Anda untuk melanjutkan</p>
            </div>

            <form onSubmit={handleLogin} className="space-y-5">
              {error && (
                <div className="alert-error">
                  <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                  <span>{error}</span>
                </div>
              )}

              <div>
                <label className="label">Username / NIS</label>
                <div className="relative">
                  <User className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <input
                    type="text"
                    className="input pl-10"
                    placeholder="Masukkan username atau NIS"
                    value={form.username}
                    onChange={e => setForm(f => ({ ...f, username: e.target.value }))}
                    autoComplete="username"
                    autoFocus
                  />
                </div>
              </div>

              <div>
                <label className="label">Password</label>
                <div className="relative">
                  <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <input
                    type={showPw ? 'text' : 'password'}
                    className="input pl-10 pr-10"
                    placeholder="Masukkan password"
                    value={form.password}
                    onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                    autoComplete="current-password"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPw(v => !v)}
                    className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                  >
                    {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="btn-primary w-full justify-center py-3 text-base mt-2"
              >
                {loading ? (
                  <span className="flex items-center gap-2">
                    <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Masuk...
                  </span>
                ) : 'Masuk'}
              </button>
            </form>

            <div className="mt-6 pt-6 border-t border-slate-100">
              <p className="text-xs text-slate-400 text-center">
                Lupa password? Hubungi administrator sekolah.
              </p>
            </div>
          </div>

          <p className="text-center text-brand-300/60 text-xs mt-6">
            MTS Alkhairaat Tatakalai · Banggai Kepulauan
          </p>
        </div>
      </div>
    </div>
  )
}
