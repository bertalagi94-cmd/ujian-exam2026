'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { Eye, EyeOff, BookOpen, Lock, User, AlertCircle } from 'lucide-react'

interface SiteInfo {
  namaSekolah: string
  kota: string
  logoUrl: string
}

export default function LoginPage() {
  const router = useRouter()
  const [form, setForm] = useState({ username: '', password: '' })
  const [showPw, setShowPw] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [siteInfo, setSiteInfo] = useState<SiteInfo>({ namaSekolah: '', kota: '', logoUrl: '' })
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const resize = () => {
      canvas.width = canvas.offsetWidth
      canvas.height = canvas.offsetHeight
    }
    resize()
    window.addEventListener('resize', resize)

    type Bubble = {
      x: number; y: number; r: number
      vx: number; vy: number
      alpha: number; phase: 'alive' | 'popping'
      popFrame: number
    }

    const bubbles: Bubble[] = []
    const MAX = 18

    const spawn = (): Bubble => ({
      x: Math.random() * canvas.width,
      y: canvas.height + 40,
      r: 18 + Math.random() * 38,
      vx: (Math.random() - 0.5) * 0.6,
      vy: -(0.4 + Math.random() * 0.7),
      alpha: 0.12 + Math.random() * 0.18,
      phase: 'alive',
      popFrame: 0,
    })

    for (let i = 0; i < 10; i++) {
      const b = spawn()
      b.y = Math.random() * canvas.height
      bubbles.push(b)
    }

    let raf: number
    const draw = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height)

      if (bubbles.length < MAX && Math.random() < 0.02) bubbles.push(spawn())

      for (let i = bubbles.length - 1; i >= 0; i--) {
        const b = bubbles[i]

        if (b.phase === 'popping') {
          b.popFrame++
          const prog = b.popFrame / 12
          ctx.beginPath()
          ctx.arc(b.x, b.y, b.r * (1 + prog * 0.5), 0, Math.PI * 2)
          ctx.strokeStyle = `rgba(255,255,255,${b.alpha * (1 - prog)})`
          ctx.lineWidth = 1.5
          ctx.stroke()
          if (b.popFrame >= 12) bubbles.splice(i, 1)
          continue
        }

        b.x += b.vx
        b.vy += 0.002
        b.y += b.vy

        for (let j = i - 1; j >= 0; j--) {
          const o = bubbles[j]
          if (o.phase === 'popping') continue
          const dx = b.x - o.x, dy = b.y - o.y
          const dist = Math.sqrt(dx * dx + dy * dy)
          if (dist < b.r + o.r) {
            b.phase = 'popping'; b.popFrame = 0
            o.phase = 'popping'; o.popFrame = 0
            break
          }
        }

        if (b.y + b.r < 0 || b.x + b.r < 0 || b.x - b.r > canvas.width) {
          bubbles.splice(i, 1); continue
        }

        const grad = ctx.createRadialGradient(b.x - b.r * 0.3, b.y - b.r * 0.3, b.r * 0.1, b.x, b.y, b.r)
        grad.addColorStop(0, `rgba(255,255,255,${b.alpha * 1.5})`)
        grad.addColorStop(0.5, `rgba(255,255,255,${b.alpha * 0.4})`)
        grad.addColorStop(1, `rgba(255,255,255,0)`)
        ctx.beginPath()
        ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2)
        ctx.fillStyle = grad
        ctx.fill()

        ctx.beginPath()
        ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2)
        ctx.strokeStyle = `rgba(255,255,255,${b.alpha * 1.2})`
        ctx.lineWidth = 1
        ctx.stroke()

        ctx.beginPath()
        ctx.arc(b.x - b.r * 0.28, b.y - b.r * 0.32, b.r * 0.18, 0, Math.PI * 2)
        ctx.fillStyle = `rgba(255,255,255,${b.alpha * 1.8})`
        ctx.fill()
      }

      raf = requestAnimationFrame(draw)
    }
    draw()

    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', resize)
    }
  }, [])

  useEffect(() => {
    fetch('/api/public/pengaturan', { cache: 'no-store' })
      .then(r => r.json())
      .then(json => {
        if (json?.data) setSiteInfo({
          namaSekolah: json.data.namaSekolah ?? '',
          kota: json.data.kota ?? '',
          logoUrl: json.data.logoUrl ?? '',
        })
      })
      .catch(() => {})
  }, [])

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
        SISWA: '/siswa',
      }
      router.push(roleRoutes[data.role] ?? '/login')
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Login gagal')
    } finally {
      setLoading(false)
    }
  }

  const displayName = siteInfo.namaSekolah || 'SmartExam'
  const displayKota = siteInfo.kota || ''
  const year = new Date().getFullYear()

  // Logo component — reused on both desktop & mobile
  function SchoolLogo({ size }: { size: 'sm' | 'lg' }) {
    const dim = size === 'lg' ? 'w-14 h-14' : 'w-10 h-10'
    const iconDim = size === 'lg' ? 'w-7 h-7' : 'w-5 h-5'
    if (siteInfo.logoUrl) {
      return (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={siteInfo.logoUrl}
          alt={displayName}
          className={`${dim} object-contain rounded-xl bg-white/10 p-1 backdrop-blur flex-shrink-0`}
        />
      )
    }
    return (
      <div className={`${dim} bg-white/20 rounded-xl flex items-center justify-center backdrop-blur flex-shrink-0`}>
        <BookOpen className={`${iconDim} text-white`} />
      </div>
    )
  }

  return (
    <div className="min-h-screen flex bg-gradient-to-br from-brand-950 via-brand-900 to-brand-800 relative overflow-hidden">
      {/* bubble animation canvas — full screen background */}
      <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" style={{ pointerEvents: 'none', zIndex: 0 }} />
      {/* Left — branding */}
      <div className="hidden lg:flex flex-col justify-between w-1/2 p-12 text-white relative">

        {/* Logo + Nama Sekolah */}
        <div className="relative z-10">
          <div className="flex items-center gap-3 mb-2">
            <SchoolLogo size="lg" />
            <div className="min-w-0">
              <p className="font-bold text-xl leading-tight line-clamp-2">
                {siteInfo.namaSekolah || 'SmartExam'}
              </p>
              {!siteInfo.namaSekolah && (
                <p className="text-brand-300 text-sm">Computer Based Test System</p>
              )}
              {siteInfo.namaSekolah && (
                <p className="text-brand-300 text-sm">Computer Based Test System</p>
              )}
            </div>
          </div>
        </div>

        <div className="relative z-10 space-y-6">
          <div>
            <h1 className="text-4xl font-bold leading-tight mb-3">
              Ujian Digital<br />Lebih Mudah & Adil
            </h1>
            <p className="text-brand-300 text-sm leading-relaxed max-w-xs">
              Sistem CBT modern
              {siteInfo.namaSekolah ? ` untuk ${siteInfo.namaSekolah}` : ''}
              {' '}dengan fitur anti-nyontek, penilaian otomatis, dan monitoring real-time.
            </p>
          </div>
          <div className="grid grid-cols-3 gap-4">
            {[
              { n: '🔒', l: 'Aman' },
              { n: '⚡', l: 'Cepat' },
              { n: '📊', l: 'Akurat' },
            ].map(({ n, l }) => (
              <div
                key={l}
                className="bg-white/10 backdrop-blur rounded-xl p-4 text-center cursor-default"
                style={{
                  transition: 'transform 0.35s cubic-bezier(0.34, 1.56, 0.64, 1), box-shadow 0.35s ease',
                }}
                onMouseEnter={e => {
                  (e.currentTarget as HTMLDivElement).style.transform = 'translateY(-18px) scale(1.08)'
                  ;(e.currentTarget as HTMLDivElement).style.boxShadow = '0 16px 32px rgba(0,0,0,0.25)'
                }}
                onMouseLeave={e => {
                  (e.currentTarget as HTMLDivElement).style.transform = 'translateY(0) scale(1)'
                  ;(e.currentTarget as HTMLDivElement).style.boxShadow = 'none'
                }}
              >
                <div className="text-2xl">{n}</div>
                <div className="text-brand-300 text-xs mt-1">{l}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="relative z-10 text-brand-400 text-xs">
          {siteInfo.namaSekolah
            ? <>{siteInfo.namaSekolah} &copy; {year}</>
            : <>SmartExam &copy; {year}</>
          }
        </div>
      </div>

      {/* Right — login form */}
      <div className="flex-1 flex items-center justify-center p-6 relative z-10">
        <div className="w-full max-w-sm">
          {/* Mobile: logo + nama sekolah */}
          <div className="lg:hidden flex items-center gap-3 mb-8 justify-center">
            <SchoolLogo size="sm" />
            <div className="min-w-0 text-left">
              <p className="font-bold text-white text-base leading-tight line-clamp-2">
                {siteInfo.namaSekolah || 'SmartExam'}
              </p>
              {!siteInfo.namaSekolah && (
                <p className="text-brand-300 text-xs">Computer Based Test System</p>
              )}
            </div>
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

          {(siteInfo.namaSekolah || siteInfo.kota) && (
            <p className="text-center text-brand-300/60 text-xs mt-6">
              {[siteInfo.namaSekolah, siteInfo.kota].filter(Boolean).join(' · ')}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
