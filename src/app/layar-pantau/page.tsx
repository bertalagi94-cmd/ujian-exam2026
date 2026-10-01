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
// requireRole di endpoint data/stream) — halaman ini menampilkan nama +
// skor siswa LAIN, jadi tidak boleh diakses pakai akun siswa.
//
// ── REALTIME ─────────────────────────────────────────────────────────────
// Papan di-update lewat koneksi Server-Sent Events ke /api/layar-pantau/stream
// (lihat file itu untuk arsitektur lengkapnya) — server mendorong papan
// terbaru begitu ada perubahan di database, BUKAN halaman ini yang menarik
// data berkala. Kalau koneksi putus (jaringan TV goyang, fungsi serverless
// di-recycle, dsb), EventSource browser otomatis menyambung ulang sendiri;
// kita cuma menampilkan status koneksinya di header. Fallback fetch-sekali
// + polling pelan tetap disediakan untuk browser TV lawas yang tidak
// mendukung EventSource sama sekali (jarang, tapi mungkin).

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, Lock, LogOut, Radio, Trophy, User } from 'lucide-react'
import { FullscreenButton } from '@/components/shared/FullscreenButton'
import { LiveLeaderboardBoard } from '@/components/leaderboard/LiveLeaderboardBoard'
import type { LiveLeaderboardSesi } from '@/lib/leaderboard-live'

const SESSION_KEY = 'layarPantauSession'
const FALLBACK_POLL_MS = 3000  // hanya dipakai kalau EventSource tidak didukung sama sekali
const ROTASI_MS = 12000
const ROLE_LABEL: Record<string, string> = { GURU: 'Guru', KEPSEK: 'Kepala Sekolah', ADMIN: 'Admin' }

type ConnStatus = 'connecting' | 'live' | 'reconnecting'

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
    <div className="relative min-h-screen bg-slate-950 flex items-center justify-center p-4 overflow-hidden">
      <BackgroundGlow />
      <div className="relative z-10 w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-brand-400/30 to-accent-400/20 border border-brand-400/30 flex items-center justify-center mx-auto mb-4 shadow-[0_0_40px_rgba(34,211,238,0.15)]">
            <Radio className="w-8 h-8 text-brand-300" />
          </div>
          <h1 className="text-2xl font-bold text-white">Layar Pantau Ujian</h1>
          <p className="text-slate-400 text-sm mt-1">Masuk dengan akun Guru, Kepsek, atau Admin</p>
        </div>

        <form onSubmit={submit} className="bg-white/[0.06] border border-white/10 rounded-2xl p-6 space-y-4 backdrop-blur-xl shadow-2xl shadow-black/40">
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
          <button type="submit" disabled={loading} className="btn-primary w-full justify-center bg-gradient-to-r from-brand-500 to-accent-500 hover:from-brand-400 hover:to-accent-400">
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
// Latar bertema "siaran sinyal langsung" — senada dengan ikon Radio & badge
// LIVE di header: cincin denyut sinyal, berkas cahaya yang menyapu pelan,
// partikel melayang, dan orb gradasi lembut. Semua transparan/blur supaya
// kartu leaderboard di atasnya tetap kontras & mudah dibaca dari jarak TV.
// Menghormati prefers-reduced-motion untuk penonton yang sensitif gerakan.
// ─────────────────────────────────────────────────────────────────────────
const SIGNAL_PARTICLES = [
  { left: '6%',  top: '16%', size: 3, duration: 9,   delay: 0 },
  { left: '14%', top: '74%', size: 2, duration: 12,  delay: 1.5 },
  { left: '22%', top: '42%', size: 2, duration: 10,  delay: 3 },
  { left: '33%', top: '86%', size: 3, duration: 14,  delay: 0.8 },
  { left: '40%', top: '10%', size: 2, duration: 11,  delay: 4.2 },
  { left: '52%', top: '62%', size: 3, duration: 13,  delay: 2.1 },
  { left: '61%', top: '26%', size: 2, duration: 9.5, delay: 5 },
  { left: '69%', top: '80%', size: 2, duration: 12.5, delay: 1 },
  { left: '77%', top: '14%', size: 3, duration: 10.5, delay: 3.6 },
  { left: '85%', top: '56%', size: 2, duration: 15,  delay: 0.3 },
  { left: '91%', top: '32%', size: 3, duration: 11.5, delay: 2.8 },
  { left: '4%',  top: '52%', size: 2, duration: 13.5, delay: 4.8 },
  { left: '48%', top: '36%', size: 2, duration: 9.2,  delay: 6 },
  { left: '95%', top: '84%', size: 3, duration: 12.8, delay: 1.9 },
]

function BackgroundGlow() {
  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden">
      {/* Orb gradasi — kedalaman warna latar */}
      <div className="absolute -top-40 -left-32 w-[36rem] h-[36rem] rounded-full bg-brand-500/20 blur-[120px] animate-[floatSlow_14s_ease-in-out_infinite]" />
      <div className="absolute -bottom-48 -right-24 w-[40rem] h-[40rem] rounded-full bg-accent-500/15 blur-[130px] animate-[floatSlow_18s_ease-in-out_infinite_reverse]" />
      <div className="absolute top-1/3 right-1/4 w-72 h-72 rounded-full bg-yellow-400/10 blur-[100px] animate-[floatSlow_20s_ease-in-out_infinite]" />

      {/* Cincin denyut sinyal — dua titik pemancar, senada ikon Radio */}
      <div className="absolute left-[12%] top-[22%]">
        {[0, 1, 2].map(i => (
          <span
            key={i}
            className="absolute -translate-x-1/2 -translate-y-1/2 rounded-full border border-brand-300/40"
            style={{ width: 40, height: 40, animation: `radarPulse 4.2s ease-out ${i * 1.4}s infinite` }}
          />
        ))}
      </div>
      <div className="absolute right-[16%] bottom-[20%]">
        {[0, 1, 2].map(i => (
          <span
            key={i}
            className="absolute -translate-x-1/2 -translate-y-1/2 rounded-full border border-accent-400/30"
            style={{ width: 40, height: 40, animation: `radarPulse 5s ease-out ${i * 1.6 + 0.6}s infinite` }}
          />
        ))}
      </div>

      {/* Berkas cahaya yang menyapu pelan — kesan "menangkap sinyal" */}
      <div className="absolute inset-0 opacity-[0.05] bg-no-repeat bg-[length:60%_100%] bg-[linear-gradient(100deg,transparent_35%,rgba(103,232,249,0.9)_50%,transparent_65%)] animate-[sweepBeam_16s_linear_infinite]" />

      {/* Partikel sinyal melayang pelan */}
      {SIGNAL_PARTICLES.map((p, i) => (
        <span
          key={i}
          className="absolute rounded-full bg-brand-200"
          style={{
            left: p.left, top: p.top, width: p.size, height: p.size, opacity: 0,
            animation: `driftGlow ${p.duration}s ease-in-out ${p.delay}s infinite`,
          }}
        />
      ))}

      <style jsx global>{`
        @keyframes floatSlow {
          0%, 100% { transform: translate(0, 0) scale(1); }
          50% { transform: translate(30px, -20px) scale(1.08); }
        }
        @keyframes radarPulse {
          0%   { transform: translate(-50%, -50%) scale(0.3); opacity: 0.55; }
          100% { transform: translate(-50%, -50%) scale(7); opacity: 0; }
        }
        @keyframes sweepBeam {
          0%   { transform: translateX(-60%); }
          100% { transform: translateX(160%); }
        }
        @keyframes driftGlow {
          0%   { opacity: 0; transform: translateY(0); }
          15%  { opacity: 0.7; }
          85%  { opacity: 0.5; }
          100% { opacity: 0; transform: translateY(-40px); }
        }
        @media (prefers-reduced-motion: reduce) {
          *, *::before, *::after {
            animation-duration: 0.001ms !important;
            animation-iteration-count: 1 !important;
            transition-duration: 0.001ms !important;
          }
        }
      `}</style>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// Indikator status koneksi realtime — dot berdenyut + label singkat.
// ─────────────────────────────────────────────────────────────────────────
function ConnBadge({ status }: { status: ConnStatus }) {
  // Latar SOLID & terang + teks putih supaya terbaca dari jauh (layar proyektor).
  // glow = warna denyut lingkaran cahaya di sekeliling badge (lihat keyframes di bawah).
  const map: Record<ConnStatus, { bg: string; glow: string; label: string }> = {
    live:         { bg: 'bg-emerald-500', glow: '16,185,129', label: 'LIVE' },
    connecting:   { bg: 'bg-amber-500',   glow: '245,158,11', label: 'Menyambungkan…' },
    reconnecting: { bg: 'bg-red-500',     glow: '239,68,68',  label: 'Menyambung ulang…' },
  }
  const s = map[status]
  return (
    <div
      className={`conn-badge flex items-center gap-2 text-sm font-extrabold uppercase tracking-wider text-white rounded-full px-3.5 py-1.5 ring-2 ring-white/40 ${s.bg}`}
      style={{ ['--glow' as string]: s.glow }}
    >
      <span className="relative flex h-2.5 w-2.5">
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-90" />
        <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-white" />
      </span>
      <span className="conn-badge-text">{s.label}</span>
      <style>{`
        @keyframes connGlow {
          0%, 100% { box-shadow: 0 0 0 0 rgba(var(--glow), 0.75), 0 0 10px 1px rgba(var(--glow), 0.55); }
          50%      { box-shadow: 0 0 0 9px rgba(var(--glow), 0), 0 0 22px 5px rgba(var(--glow), 0.9); }
        }
        @keyframes connText {
          0%, 100% { opacity: 1;   transform: scale(1); }
          50%      { opacity: 0.55; transform: scale(1.07); }
        }
        .conn-badge      { animation: connGlow 1.4s ease-in-out infinite; }
        .conn-badge-text { display: inline-block; animation: connText 1.4s ease-in-out infinite; }
        @media (prefers-reduced-motion: reduce) {
          .conn-badge, .conn-badge-text { animation: none; }
        }
      `}</style>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// Banner "Nilai tertinggi saat ini" di tengah header.
// Dihitung dari SEMUA kelas yang sedang berjalan (bukan hanya kelas yang
// sedang tampil), jadi tetap satu baris ringkas walau ada 30 kelas ujian
// bersamaan: yang ditampilkan hanya 1 siswa teratas + kelasnya, dan kalau
// ada yang nilainya sama persis cukup ditulis "+N siswa lain".
// ─────────────────────────────────────────────────────────────────────────
function NilaiTertinggi({ boards }: { boards: LiveLeaderboardSesi[] }) {
  const top = useMemo(() => {
    const aktif = boards.filter(b => b.statusSesi !== 'SELESAI')
    const sumber = aktif.length > 0 ? aktif : boards
    let best: { nilai: number; terjawab: number; nama: string; kelas: string } | null = null
    for (const b of sumber) {
      for (const p of b.peserta) {
        if (!best || p.nilaiSementara > best.nilai || (p.nilaiSementara === best.nilai && p.terjawab > best.terjawab)) {
          best = { nilai: p.nilaiSementara, terjawab: p.terjawab, nama: p.nama, kelas: b.kelas }
        }
      }
    }
    if (!best || best.nilai <= 0) return null
    let sama = -1 // dikurangi diri sendiri
    for (const b of sumber) for (const p of b.peserta) if (p.nilaiSementara === best.nilai) sama++
    return { ...best, sama }
  }, [boards])

  if (!top) {
    return (
      <div className="flex items-center justify-center gap-2 text-slate-300 text-lg px-4 py-2 min-w-0">
        <Trophy className="w-5 h-5 shrink-0 text-slate-400" />
        <span className="truncate">Tertinggi : belum ada</span>
      </div>
    )
  }

  return (
    <div
      key={`${top.nilai}|${top.nama}`}
      className="flex items-center justify-center gap-2.5 min-w-0 max-w-full rounded-2xl border border-yellow-300/60 bg-gradient-to-r from-amber-950 via-amber-900/80 to-amber-950 px-4 py-1 shadow-[0_0_24px_rgba(250,204,21,0.18)] animate-[fadeIn_0.4s_ease]"
      title={`Nilai tertinggi saat ini: ${top.nilai} (${top.nama}, Kelas ${top.kelas})`}
    >
      <Trophy className="w-5 h-5 shrink-0 text-yellow-300" />
      <span className="text-base font-semibold text-amber-100 whitespace-nowrap shrink-0">Tertinggi :</span>
      <span className="text-3xl font-black text-yellow-300 tabular-nums leading-none shrink-0 [text-shadow:0_1px_3px_rgba(0,0,0,0.9)]">{top.nilai}</span>
      <span className="text-lg font-bold text-white truncate min-w-0 [text-shadow:0_1px_3px_rgba(0,0,0,0.9)]">({top.nama})</span>
      {top.sama > 0 && (
        <span className="text-sm text-amber-100/90 whitespace-nowrap shrink-0">+{top.sama} lainnya</span>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// Baris pemilih kelas — terpisah dari header supaya header tidak meluap
// kalau kelasnya banyak. ≤6 kelas: tombol langsung. >6 kelas: tombol
// "Pilih kelas" yang membuka kisi rapi. Selalu ada penanda posisi rotasi
// ("Kelas 3 dari 30") dan strip segmen kecil per kelas.
// ─────────────────────────────────────────────────────────────────────────
const CHIP_LANGSUNG_MAKS = 6

function PemilihKelas({
  boards, pinnedSesiId, activeIndex, onPin,
}: {
  boards: LiveLeaderboardSesi[]
  pinnedSesiId: string | null
  activeIndex: number
  onPin: (id: string | null) => void
}) {
  const [open, setOpen] = useState(false)
  const rotasi = pinnedSesiId === null
  const aktifId = rotasi ? boards[activeIndex]?.sesiId : pinnedSesiId
  const banyak = boards.length > CHIP_LANGSUNG_MAKS
  const chipCls = (aktif: boolean) =>
    `px-3 py-1.5 rounded-lg text-sm font-semibold transition ${aktif ? 'bg-gradient-to-r from-brand-500 to-accent-500 text-white' : 'bg-slate-800 text-slate-100 hover:bg-slate-700'}`

  return (
    <div className="relative z-20 flex items-center gap-3 px-6 py-2 border-b border-white/10 bg-slate-950/70">
      <button onClick={() => onPin(null)} className={chipCls(rotasi) + ' whitespace-nowrap'}>
        Rotasi otomatis{rotasi ? ` · Kelas ${Math.min(activeIndex + 1, boards.length)} dari ${boards.length}` : ''}
      </button>

      {!banyak && boards.map(b => (
        <button key={b.sesiId} onClick={() => onPin(b.sesiId)} className={chipCls(pinnedSesiId === b.sesiId)} title={b.namaMapel}>
          {b.kelas}
        </button>
      ))}

      {banyak && (
        <div className="relative">
          <button onClick={() => setOpen(o => !o)} className={chipCls(!rotasi) + ' flex items-center gap-1.5 whitespace-nowrap'}>
            {rotasi ? 'Pilih kelas' : `Kelas ${boards.find(b => b.sesiId === pinnedSesiId)?.kelas ?? ''}`}
            <ChevronDown className={`w-4 h-4 transition-transform ${open ? 'rotate-180' : ''}`} />
          </button>
          {open && (
            <>
              <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
              <div className="absolute left-0 top-full mt-2 z-40 w-[min(46rem,90vw)] max-h-[60vh] overflow-y-auto rounded-2xl border border-white/15 bg-slate-900 p-3 shadow-2xl shadow-black/60">
                <div className="grid gap-2 [grid-template-columns:repeat(auto-fill,minmax(6.5rem,1fr))]">
                  {boards.map(b => (
                    <button
                      key={b.sesiId}
                      onClick={() => { onPin(b.sesiId); setOpen(false) }}
                      className={chipCls(pinnedSesiId === b.sesiId) + ' truncate text-center'}
                      title={`${b.namaMapel} · ${b.totalPeserta} siswa`}
                    >
                      {b.kelas}
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* Strip posisi: satu segmen kecil per kelas, yang tampil menyala */}
      <div className="flex-1 flex items-center gap-[3px] min-w-0" aria-hidden>
        {boards.map(b => (
          <span key={b.sesiId} className={`h-1.5 flex-1 max-w-6 rounded-full transition-colors ${b.sesiId === aktifId ? 'bg-brand-300' : 'bg-slate-700'}`} />
        ))}
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
  const [connStatus, setConnStatus] = useState<ConnStatus>('connecting')
  const [pinnedSesiId, setPinnedSesiId] = useState<string | null>(null) // null = rotasi otomatis
  const [activeIndex, setActiveIndex] = useState(0)
  const [clock, setClock] = useState('')

  // ── Anti-kedip ───────────────────────────────────────────────────────────
  // Ada dua sumber data yang bisa saling susul-menyusul: fetch awal
  // (ambilSekali, "double-safety" kalau EventSource lambat tersambung) dan
  // event 'boards' dari stream. Kalau salah satu dari keduanya kebetulan
  // datang BELAKANGAN dengan hasil kosong (mis. race, cold-start fungsi
  // serverless, atau satu hasil recompute yang transien), papan yang tadinya
  // sudah tampil bisa "berkedip" hilang sesaat. Untuk mencegah itu: hasil
  // KOSONG hanya benar-benar dipakai untuk mengosongkan papan kalau muncul
  // DUA KALI BERTURUT-TURUT (dua pembaruan terpisah sama-sama kosong) —
  // hasil kosong yang cuma sekali (lalu disusul hasil isi lagi) dianggap
  // glitch sesaat dan diabaikan. Sebaliknya, hasil yang BERISI selalu
  // langsung dipakai (tidak perlu konfirmasi) karena tidak ada risiko
  // "kedip" pada arah itu.
  const emptyStreakRef = useRef(0)
  const pernahAdaIsiRef = useRef(false)

  // ── "UJIAN SELESAI" + hitung mundur ─────────────────────────────────────
  // Dipakai untuk menghitung sisa detik tampil suatu board yang baru ditutup
  // pengawas (board.statusSesi === 'SELESAI'), berdasarkan serverTime dari
  // payload terakhir — BUKAN jam device TV, supaya hitung mundur tetap benar
  // walau jam TV sedikit meleset. receivedAtMsRef menandai kapan (jam device)
  // payload terakhir itu tiba, dipakai untuk mengoreksi selisih waktu sejak
  // saat itu tanpa perlu menunggu payload baru tiap detik.
  const receivedAtMsRef = useRef(Date.now())
  const [tick, setTick] = useState(0) // dipaksa berubah tiap detik supaya hitung mundur ikut ter-render

  const terapkanDataBaru = useCallback((json: DataResponse) => {
    const kosong = (json.boards ?? []).length === 0
    if (kosong && pernahAdaIsiRef.current) {
      emptyStreakRef.current += 1
      if (emptyStreakRef.current < 2) return // abaikan dulu, tunggu konfirmasi berikutnya
    } else {
      emptyStreakRef.current = 0
      if (!kosong) pernahAdaIsiRef.current = true
    }
    receivedAtMsRef.current = Date.now()
    setData(json)
    setFetchError(json.error ?? '')
  }, [])

  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 1000)
    return () => clearInterval(id)
  }, [])

  const DURASI_TAMPIL_SELESAI_DETIK = 30

  // Sisa detik papan `board` masih boleh tampil (30 → 0). Mengembalikan null
  // untuk sesi yang masih BERJALAN (tidak relevan).
  const hitungSisaDetik = useCallback((board: LiveLeaderboardSesi): number | null => {
    if (board.statusSesi !== 'SELESAI' || !board.waktuSelesai || !data) return null
    void tick // sengaja dibaca supaya fungsi ini "ikut" re-render tiap detik
    const elapsedSejakServerTime = Date.now() - receivedAtMsRef.current
    const estimasiServerNow = new Date(data.serverTime).getTime() + elapsedSejakServerTime
    const sisa = DURASI_TAMPIL_SELESAI_DETIK - Math.floor((estimasiServerNow - new Date(board.waktuSelesai).getTime()) / 1000)
    return Math.max(0, Math.min(DURASI_TAMPIL_SELESAI_DETIK, sisa))
  }, [data, tick])

  // ── Realtime: dengarkan /api/layar-pantau/stream ────────────────────────
  useEffect(() => {
    let cancelled = false
    let es: EventSource | null = null
    let fallbackId: ReturnType<typeof setInterval> | null = null
    emptyStreakRef.current = 0
    pernahAdaIsiRef.current = false

    const ambilSekali = async () => {
      try {
        const res = await fetch('/api/layar-pantau/data', {
          headers: { Authorization: `Bearer ${session.token}` },
        })
        if (res.status === 401 || res.status === 403) { onLogout(); return }
        const json: DataResponse = await res.json()
        if (!cancelled) terapkanDataBaru(json)
      } catch {
        if (!cancelled) setFetchError('Koneksi terputus, mencoba lagi…')
      }
    }

    if (typeof EventSource === 'undefined') {
      // Fallback untuk browser TV lawas yang tidak punya EventSource sama
      // sekali — jarang terjadi, tapi lebih baik tetap jalan (walau tidak
      // realtime) daripada layar kosong.
      setConnStatus('live')
      ambilSekali()
      fallbackId = setInterval(ambilSekali, FALLBACK_POLL_MS)
      return () => { cancelled = true; if (fallbackId) clearInterval(fallbackId) }
    }

    setConnStatus('connecting')
    es = new EventSource(`/api/layar-pantau/stream?token=${encodeURIComponent(session.token)}`)

    es.addEventListener('boards', (ev) => {
      if (cancelled) return
      try {
        const json: DataResponse = JSON.parse((ev as MessageEvent).data)
        terapkanDataBaru(json)
        setConnStatus('live')
      } catch {
        // Payload tidak valid — abaikan event ini, tunggu event berikutnya.
      }
    })

    es.addEventListener('status', (ev) => {
      if (cancelled) return
      try {
        const payload = JSON.parse((ev as MessageEvent).data) as { realtime: string }
        if (payload.realtime === 'tersambung') setConnStatus('live')
        else setConnStatus('reconnecting')
      } catch {}
    })

    es.addEventListener('error', () => {
      // Native EventSource 'error' — bisa berarti koneksi putus SAMA SEKALI
      // (token expired/401 → tidak akan reconnect sendiri) atau cuma
      // hambatan sementara (browser akan otomatis mencoba lagi). Kita
      // tidak bisa membedakan status HTTP dari sini, jadi tampilkan sebagai
      // "menyambung ulang" — kalau memang 401/403, endpoint /data biasa
      // (dipanggil saat boards event berikutnya gagal) akan men-trigger logout.
      if (!cancelled) setConnStatus('reconnecting')
    })

    // Muatan awal instan lewat endpoint biasa juga (double-safety) — kalau
    // browser lambat membuka EventSource, layar tidak kosong menunggu.
    ambilSekali()

    return () => {
      cancelled = true
      es?.close()
      if (fallbackId) clearInterval(fallbackId)
    }
  }, [session.token, onLogout, terapkanDataBaru])

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

  // Board yang hitung mundurnya sudah mencapai 0 disaring keluar di sini —
  // itulah cara papan "UJIAN SELESAI" benar-benar hilang dari layar setelah
  // 30 detik (client-side; backend punya jendela buffer lebih longgar, lihat
  // komentar JENDELA_TAMPIL_SETELAH_TUTUP_MS di route.ts).
  const boards = (data?.boards ?? []).filter(b => hitungSisaDetik(b) !== 0)

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

  // Kunci ringan (bukan array `boards` utuh, yang selalu jadi objek BARU
  // tiap detik gara-gara hitung mundur) — supaya efek di bawah cuma jalan
  // kalau daftar kelas SUNGGUH berubah (ada yang ditambah/dihapus), bukan
  // tiap kali komponen re-render karena tick detik.
  const boardIdsKey = boards.map(b => b.sesiId).join('|')

  // Kalau daftar kelas berubah (mis. ujian baru selesai/mulai, atau papan
  // "UJIAN SELESAI" barusan habis hitung mundurnya), pastikan index/pin
  // tidak menunjuk ke kelas yang sudah tidak ada.
  useEffect(() => {
    if (pinnedSesiId && !boards.some(b => b.sesiId === pinnedSesiId)) setPinnedSesiId(null)
    if (activeIndex >= boards.length) setActiveIndex(0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boardIdsKey, pinnedSesiId, activeIndex])

  const displayedBoard = pinnedSesiId
    ? boards.find(b => b.sesiId === pinnedSesiId) ?? boards[0]
    : boards[activeIndex]
  const sisaDetikDisplayed = displayedBoard ? hitungSisaDetik(displayedBoard) : null

  return (
    <div className="relative h-screen bg-slate-950 flex flex-col overflow-hidden">
      <BackgroundGlow />

      {/* Header: kiri = judul/jam/status, tengah = nilai tertinggi, kanan = akun */}
      <header className="relative z-10 flex items-center gap-x-4 gap-y-2 px-6 py-3 border-b border-white/10 bg-white/[0.03] backdrop-blur-md flex-wrap">
        <div className="flex items-center gap-2.5 shrink-0">
          <Radio className="w-5 h-5 text-brand-400" />
          <span className="text-white font-bold text-lg">Layar Pantau Ujian</span>
          <span className="text-slate-200 text-base hidden sm:inline">{clock} WITA</span>
          <ConnBadge status={connStatus} />
        </div>

        {/* Di layar sempit pindah ke baris sendiri (order-last + w-full) */}
        <div className="order-last w-full lg:order-none lg:w-auto lg:flex-1 min-w-0 flex justify-center">
          {data && <NilaiTertinggi boards={boards} />}
        </div>

        <div className="flex items-center gap-2 shrink-0 ml-auto lg:ml-0">
          <div className="flex items-center gap-1.5 text-slate-300 text-sm bg-white/5 rounded-xl px-3 py-1.5">
            <User className="w-3.5 h-3.5" />
            <span className="font-medium text-white">{session.nama}</span>
            <span className="text-slate-400">· {ROLE_LABEL[session.role] ?? session.role}</span>
          </div>

          <FullscreenButton iconOnly />

          <button onClick={onLogout} className="btn-ghost btn-sm text-slate-300 hover:text-white" title="Keluar">
            <LogOut className="w-3.5 h-3.5" />
          </button>
        </div>
      </header>

      {boards.length > 1 && (
        <PemilihKelas boards={boards} pinnedSesiId={pinnedSesiId} activeIndex={activeIndex} onPin={setPinnedSesiId} />
      )}

      {/* Konten */}
      <main className="relative z-10 flex-1 min-h-0 flex flex-col p-6 overflow-hidden">
        {fetchError && (
          <p className="text-center text-amber-400 text-sm mb-4">{fetchError}</p>
        )}
        {data?.scopeWarning && (
          <p className="text-center text-amber-400 text-sm mb-4">{data.scopeWarning}</p>
        )}

        {!data ? (
          <div className="flex-1 flex items-center justify-center text-slate-400 text-lg">Memuat…</div>
        ) : boards.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center text-center gap-2">
            <p className="text-2xl font-semibold text-slate-300">Belum ada ujian yang sedang berlangsung</p>
            <p className="text-slate-500 text-sm">Papan akan otomatis tampil begitu ada sesi ujian yang berjalan.</p>
          </div>
        ) : displayedBoard ? (
          <div
            key={displayedBoard.sesiId}
            className="flex-1 min-h-0 flex flex-col rounded-3xl bg-gradient-to-br from-white/[0.07] to-white/[0.02] border border-white/10 backdrop-blur-xl shadow-2xl shadow-black/40 p-6 md:p-8 animate-[fadeIn_0.4s_ease]"
          >
            <LiveLeaderboardBoard board={displayedBoard} sisaDetikTutup={sisaDetikDisplayed ?? undefined} />
          </div>
        ) : null}
      </main>

      <style jsx global>{`
        @keyframes fadeIn { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
      `}</style>
    </div>
  )
}
