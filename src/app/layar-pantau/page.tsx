'use client'

// ── /layar-pantau — "Layar Pantau" (mode kios/TV) ───────────────────────────
//
// Halaman TERPISAH dari dashboard biasa (tidak ada Sidebar/menu), dirancang
// untuk dipajang di TV/proyektor sekolah. Tetap butuh login (username +
// password akun Guru/Kepsek/Admin yang SAMA dengan login dashboard biasa —
// lihat komentar di /api/layar-pantau/data/route.ts untuk alasannya), lalu
// menampilkan leaderboard live layar penuh, lengkap dengan nama siapa yang
// sedang memantau.
//
// SISWA ditolak di sini (baik oleh pengecekan role di bawah maupun oleh
// requireRole di endpoint data) — halaman ini menampilkan nama + skor siswa
// LAIN, jadi tidak boleh diakses pakai akun siswa.

import { useCallback, useEffect, useRef, useState } from 'react'
import { Lock, LogOut, Radio, User } from 'lucide-react'
import { FullscreenButton } from '@/components/shared/FullscreenButton'
import { LiveLeaderboardBoard } from '@/components/leaderboard/LiveLeaderboardBoard'
import type { LiveLeaderboardSesi } from '@/lib/leaderboard-live'

const SESSION_KEY = 'layarPantauSession'
const POLL_MS = 1200
const ROTASI_MS = 12000
const ROLE_LABEL: Record<string, string> = { GURU: 'Guru', KEPSEK: 'Kepala Sekolah', ADMIN: 'Admin' }

interface Session {
  token: string
  nama: string
  role: string
}

interface DataResponse {
  serverTime: string
  viewer: { nama: string; role: string }
  boards: LiveLeaderboardSesi[]
  scopeWarning?: string
  error?: string
}

export default function LayarPantauPage() {
  const [session, setSession] = useState<Session | null>(null)
  const [hydrated, setHydrated] = useState(false)

  // Baca sesi tersimpan (kalau TV/browser sempat reload sendiri) — kios
  // biasanya menyala berjam-jam, jadi tidak ideal minta login ulang tiap
  // kali tab ter-refresh tanpa sengaja.
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(SESSION_KEY)
      if (raw) setSession(JSON.parse(raw))
    } catch {
      // Abaikan sessionStorage yang rusak — anggap belum login.
    }
    setHydrated(true)
  }, [])

  const handleLogin = useCallback((s: Session) => {
    setSession(s)
    try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(s)) } catch {}
  }, [])

  const handleLogout = useCallback(() => {
    setSession(null)
    try { sessionStorage.removeItem(SESSION_KEY) } catch {}
  }, [])

  if (!hydrated) return <div className="min-h-screen bg-slate-950" />
  if (!session) return <LoginGate onLogin={handleLogin} />
  return <PapanLive session={session} onLogout={handleLogout} />
}

// ─────────────────────────────────────────────────────────────────────────
// Layar login khusus mode kios
// ─────────────────────────────────────────────────────────────────────────
function LoginGate({ onLogin }: { onLogin: (s: Session) => void }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username.trim(), password }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Username atau password salah')
        return
      }
      if (data.role === 'SISWA') {
        setError('Layar Pantau khusus untuk akun Guru, Kepala Sekolah, atau Admin.')
        return
      }
      onLogin({ token: data.token, nama: data.nama, role: data.role })
    } catch {
      setError('Tidak bisa terhubung ke server. Periksa koneksi internet.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-brand-950 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="w-16 h-16 rounded-2xl bg-brand-500/20 border border-brand-400/30 flex items-center justify-center mx-auto mb-4">
            <Radio className="w-8 h-8 text-brand-300" />
          </div>
          <h1 className="text-2xl font-bold text-white">Layar Pantau Ujian</h1>
          <p className="text-slate-400 text-sm mt-1">Masuk dengan akun Guru, Kepsek, atau Admin</p>
        </div>

        <form onSubmit={submit} className="bg-white/5 border border-white/10 rounded-2xl p-6 space-y-4 backdrop-blur">
          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1.5">Username</label>
            <input
              className="input bg-white/95"
              value={username}
              onChange={e => setUsername(e.target.value)}
              autoFocus
              required
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1.5">Password</label>
            <input
              type="password"
              className="input bg-white/95"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
            />
          </div>
          {error && (
            <p className="text-sm text-danger-400 bg-danger-950/40 border border-danger-800/50 rounded-lg px-3 py-2">
              {error}
            </p>
          )}
          <button type="submit" disabled={loading} className="btn-primary w-full justify-center">
            <Lock className="w-4 h-4" />
            {loading ? 'Memeriksa…' : 'Buka Layar Pantau'}
          </button>
        </form>

        <p className="text-center text-slate-500 text-xs mt-5">
          Halaman ini akan menampilkan nama &amp; skor siswa secara langsung.
          Hanya buka di layar yang memang untuk dipajang (TV/proyektor kelas atau ruang guru).
        </p>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// Papan live utama, dengan rotasi antar kelas
// ─────────────────────────────────────────────────────────────────────────
function PapanLive({ session, onLogout }: { session: Session; onLogout: () => void }) {
  const [data, setData] = useState<DataResponse | null>(null)
  const [fetchError, setFetchError] = useState('')
  const [pinnedSesiId, setPinnedSesiId] = useState<string | null>(null) // null = rotasi otomatis
  const [activeIndex, setActiveIndex] = useState(0)
  const [clock, setClock] = useState('')

  // ── Ambil data tiap POLL_MS ────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false
    async function ambil() {
      try {
        const res = await fetch('/api/layar-pantau/data', {
          headers: { Authorization: `Bearer ${session.token}` },
        })
        if (res.status === 401 || res.status === 403) {
          onLogout()
          return
        }
        const json: DataResponse = await res.json()
        if (!cancelled) {
          setData(json)
          setFetchError(json.error ?? '')
        }
      } catch {
        if (!cancelled) setFetchError('Koneksi terputus, mencoba lagi…')
      }
    }
    ambil()
    const id = setInterval(ambil, POLL_MS)
    return () => { cancelled = true; clearInterval(id) }
  }, [session.token, onLogout])

  // ── Jam dinding (WITA) ──────────────────────────────────────────────────
  useEffect(() => {
    const tick = () => {
      const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Makassar' }))
      setClock(now.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' }))
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [])

  const boards = data?.boards ?? []

  // ── Rotasi otomatis antar kelas ───────────────────────────────────────
  const rotasiRef = useRef<ReturnType<typeof setInterval> | null>(null)
  useEffect(() => {
    if (rotasiRef.current) clearInterval(rotasiRef.current)
    if (pinnedSesiId !== null || boards.length <= 1) return
    rotasiRef.current = setInterval(() => {
      setActiveIndex(i => (i + 1) % boards.length)
    }, ROTASI_MS)
    return () => { if (rotasiRef.current) clearInterval(rotasiRef.current) }
  }, [pinnedSesiId, boards.length])

  // Kalau daftar kelas berubah (mis. ujian baru selesai/mulai), pastikan
  // index/pin tidak menunjuk ke kelas yang sudah tidak ada.
  useEffect(() => {
    if (pinnedSesiId && !boards.some(b => b.sesiId === pinnedSesiId)) setPinnedSesiId(null)
    if (activeIndex >= boards.length) setActiveIndex(0)
  }, [boards, pinnedSesiId, activeIndex])

  const displayedBoard = pinnedSesiId
    ? boards.find(b => b.sesiId === pinnedSesiId) ?? boards[0]
    : boards[activeIndex]

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 flex flex-col">
      {/* Header */}
      <header className="flex items-center justify-between gap-3 px-6 py-4 border-b border-white/10 flex-wrap">
        <div className="flex items-center gap-2.5">
          <Radio className="w-5 h-5 text-brand-400" />
          <span className="text-white font-bold text-lg">Layar Pantau Ujian</span>
          <span className="text-slate-500 text-sm hidden sm:inline">{clock} WITA</span>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {boards.length > 1 && (
            <div className="flex items-center gap-1.5 bg-white/5 rounded-xl p-1">
              <button
                onClick={() => setPinnedSesiId(null)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition
                  ${pinnedSesiId === null ? 'bg-brand-600 text-white' : 'text-slate-300 hover:bg-white/10'}`}
              >
                Rotasi Semua
              </button>
              {boards.map(b => (
                <button
                  key={b.sesiId}
                  onClick={() => setPinnedSesiId(b.sesiId)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition
                    ${pinnedSesiId === b.sesiId ? 'bg-brand-600 text-white' : 'text-slate-300 hover:bg-white/10'}`}
                >
                  {b.kelas}
                </button>
              ))}
            </div>
          )}

          <div className="flex items-center gap-1.5 text-slate-300 text-sm bg-white/5 rounded-xl px-3 py-1.5">
            <User className="w-3.5 h-3.5" />
            <span className="font-medium text-white">{session.nama}</span>
            <span className="text-slate-500">· {ROLE_LABEL[session.role] ?? session.role}</span>
          </div>

          <FullscreenButton />

          <button onClick={onLogout} className="btn-ghost btn-sm text-slate-300 hover:text-white" title="Keluar">
            <LogOut className="w-3.5 h-3.5" />
          </button>
        </div>
      </header>

      {/* Konten */}
      <main className="flex-1 p-6 overflow-hidden">
        {fetchError && (
          <p className="text-center text-amber-400 text-sm mb-4">{fetchError}</p>
        )}
        {data?.scopeWarning && (
          <p className="text-center text-amber-400 text-sm mb-4">{data.scopeWarning}</p>
        )}

        {!data ? (
          <div className="h-full flex items-center justify-center text-slate-400 text-lg">Memuat…</div>
        ) : boards.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center gap-2">
            <p className="text-2xl font-semibold text-slate-300">Belum ada ujian yang sedang berlangsung</p>
            <p className="text-slate-500 text-sm">Papan akan otomatis tampil begitu ada sesi ujian yang berjalan.</p>
          </div>
        ) : displayedBoard ? (
          <div key={displayedBoard.sesiId} className="h-full animate-[fadeIn_0.4s_ease]">
            <LiveLeaderboardBoard board={displayedBoard} />
          </div>
        ) : null}
      </main>

      <style jsx global>{`
        @keyframes fadeIn { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
      `}</style>
    </div>
  )
}
