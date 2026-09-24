'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import dynamic from 'next/dynamic'
import {
  Eye, EyeOff, BookOpen, Lock, User, AlertCircle, X,
  Shield, BarChart2, BookMarked, CheckCircle, Monitor,
  Activity, Radio, HelpCircle,
  Maximize, Minimize,
} from 'lucide-react'
import WitaClock from '@/components/login/WitaClock'

// PERF: modal Panduan/QA/Aktivitas berisi cukup banyak JSX + data (FAQ,
// langkah panduan per role) yang hanya dibutuhkan KALAU tombolnya diklik.
// Dengan next/dynamic({ ssr: false }), kode ini dipisah ke chunk JS
// terpisah dan baru di-download saat modal pertama kali dibuka — tidak
// lagi ikut initial bundle halaman /login.
const GuideModal = dynamic(() => import('@/components/login/GuideModal'), { ssr: false })
const QAModal = dynamic(() => import('@/components/login/QAModal'), { ssr: false })
const AktivitasModal = dynamic(() => import('@/components/login/AktivitasModal'), { ssr: false })

interface SiteInfo {
  namaSekolah: string
  kota: string
  logoUrl: string
}

interface UjianBerlangsung {
  id: string
  mapel: string
  kelas: string
  sekolah: string
  pengawas: string
  waktu_mulai: string
}

interface JadwalItem {
  id: string
  tanggal: string
  tanggal_raw: string
  jam: string
  mapel: string
  kelas: string
  sekolah: string
  status: string
  isToday: boolean
}

interface JuaraItem {
  kelas: string
  sekolah: string
  nama_siswa: string
  nilai_rata: number
}

// PERF: ROLES & QA_ITEMS dipindah ke RolesData.tsx / QaData.tsx (dipakai
// oleh GuideModal / QAModal yang di-lazy-load), tidak lagi didefinisikan di sini.
function DevCredit() {
  return (
    <div className="flex justify-center mt-3">
      <div
        className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full"
        style={{
          background: 'rgba(14,165,233,0.08)',
          border: '1px solid rgba(14,165,233,0.25)',
        }}
      >
        <span className="text-[11px] font-medium text-slate-500">Developed By</span>
        <span className="text-[11px] font-bold" style={{ color: '#0369a1' }}>
          @Tasrif A. Abbas
        </span>
      </div>
    </div>
  )
}

function SchoolLogo({ size, siteInfo }: { size: 'sm' | 'lg' | 'xl'; siteInfo: SiteInfo }) {
  const dim = size === 'xl' ? 'w-16 h-16' : size === 'lg' ? 'w-14 h-14' : 'w-10 h-10'
  const iconDim = size === 'xl' ? 'w-8 h-8' : size === 'lg' ? 'w-7 h-7' : 'w-5 h-5'
  const displayName = siteInfo.namaSekolah || 'SmartExam'
  if (siteInfo.logoUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={siteInfo.logoUrl} alt={displayName}
        className={`${dim} object-contain rounded-xl bg-white/10 p-1 backdrop-blur flex-shrink-0`}
      />
    )
  }
  return (
    <div className={`${dim} bg-gradient-to-br from-sky-500 to-teal-500 rounded-xl flex items-center justify-center flex-shrink-0 shadow-md`}>
      <BookOpen className={`${iconDim} text-white`} />
    </div>
  )
}

export default function LoginPage() {
  const router = useRouter()
  const [form, setForm] = useState({ username: '', password: '' })
  const [showPw, setShowPw] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [siteInfo, setSiteInfo] = useState<SiteInfo>({ namaSekolah: '', kota: '', logoUrl: '' })
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const spotlightRef = useRef<HTMLDivElement>(null)

  // Modal state
  const [showGuide, setShowGuide] = useState(false)
  const [showQA, setShowQA] = useState(false)
  const [showAktivitas, setShowAktivitas] = useState(false)
  const [mobileLoginOpen, setMobileLoginOpen] = useState(false)
  // Foto khusus HP (potret) — jika file /images/siswa-sekolah-mobile.webp
  // belum ada di repo, otomatis fallback ke foto landscape yang sudah ada
  // (dengan komposisi crop+awan yang sudah berjalan sekarang), supaya tidak
  // muncul ikon gambar rusak sebelum aset barunya di-upload.
  const [mobileHeroReady, setMobileHeroReady] = useState(true)
  // ── Fullscreen ────────────────────────────────────────────────────────────
  const [isFs, setIsFs] = useState(false)
  useEffect(() => {
    function onFsChange() {
      const anyDoc = document as unknown as Record<string, Element | null>
      setIsFs(!!(document.fullscreenElement || anyDoc.webkitFullscreenElement || anyDoc.mozFullScreenElement || anyDoc.msFullscreenElement))
    }
    document.addEventListener('fullscreenchange', onFsChange)
    document.addEventListener('webkitfullscreenchange', onFsChange)
    document.addEventListener('mozfullscreenchange', onFsChange)
    document.addEventListener('MSFullscreenChange', onFsChange)
    return () => {
      document.removeEventListener('fullscreenchange', onFsChange)
      document.removeEventListener('webkitfullscreenchange', onFsChange)
      document.removeEventListener('mozfullscreenchange', onFsChange)
      document.removeEventListener('MSFullscreenChange', onFsChange)
    }
  }, [])
  function toggleFullscreen() {
    const anyDoc = document as unknown as Record<string, Element | null>
    const fsEl = document.fullscreenElement || anyDoc.webkitFullscreenElement || anyDoc.mozFullScreenElement || anyDoc.msFullscreenElement
    if (fsEl) {
      const d = document as unknown as Record<string, () => Promise<void>>
      ;(document.exitFullscreen || d.webkitExitFullscreen || d.mozCancelFullScreen || d.msExitFullscreen || (() => {})).call(document)
    } else {
      const el = document.documentElement as unknown as Record<string, () => Promise<void>>
      ;(el.requestFullscreen || el.webkitRequestFullscreen || el.mozRequestFullScreen || el.msRequestFullscreen || (() => {})).call(document.documentElement)
    }
  }

  // ── Drape animation state (desktop only) ──────────────────────────────────
  const [drapeState, setDrapeState] = useState<'closed' | 'opening' | 'open' | 'closing'>('closed')
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const formAreaRef = useRef<HTMLDivElement>(null)
  const drapeAnimRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ── Maskot ───────────────────────────────────────────────────────────────
  const [mascotMood, setMascotMood] = useState<'idle' | 'sad' | 'wave'>('idle')
  const mascotTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const mascotCycleRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const mascotHoveredRef = useRef(false)
  const MOOD_CYCLE: Array<'idle' | 'sad' | 'wave'> = ['idle', 'sad', 'wave']
  const mascotCycleIndexRef = useRef(0)

  const startMascotCycle = () => {
    if (mascotCycleRef.current) clearInterval(mascotCycleRef.current)
    mascotCycleIndexRef.current = 0
    setMascotMood('idle')
    mascotCycleRef.current = setInterval(() => {
      if (mascotHoveredRef.current) return
      mascotCycleIndexRef.current = (mascotCycleIndexRef.current + 1) % MOOD_CYCLE.length
      setMascotMood(MOOD_CYCLE[mascotCycleIndexRef.current])
    }, 10000)
  }
  const stopMascotCycle = () => {
    if (mascotCycleRef.current) { clearInterval(mascotCycleRef.current); mascotCycleRef.current = null }
  }
  const handleMascotEnter = () => {
    mascotHoveredRef.current = true
    if (mascotTimerRef.current) clearTimeout(mascotTimerRef.current)
    setMascotMood('sad')
    mascotTimerRef.current = setTimeout(() => setMascotMood('wave'), 550)
  }
  const handleMascotLeave = () => {
    mascotHoveredRef.current = false
    if (mascotTimerRef.current) clearTimeout(mascotTimerRef.current)
    setMascotMood('idle')
  }

  const isMobileCheck = () => typeof window !== 'undefined' && window.innerWidth < 1024

  const openDrape = () => {
    if (isMobileCheck()) return
    stopMascotCycle()
    setDrapeState(prev => {
      if (prev === 'open' || prev === 'opening') return prev
      if (drapeAnimRef.current) clearTimeout(drapeAnimRef.current)
      drapeAnimRef.current = setTimeout(() => setDrapeState('open'), 720)
      return 'opening'
    })
    resetIdleTimer()
  }
  const closeDrape = () => {
    if (isMobileCheck()) return
    setDrapeState(prev => {
      if (prev === 'closed' || prev === 'closing') return prev
      if (drapeAnimRef.current) clearTimeout(drapeAnimRef.current)
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current)
      drapeAnimRef.current = setTimeout(() => {
        setDrapeState('closed')
        startMascotCycle()
      }, 480)
      return 'closing'
    })
  }
  const resetIdleTimer = () => {
    if (isMobileCheck()) return
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current)
    idleTimerRef.current = setTimeout(() => { closeDrape() }, 10000)
  }
  const handleFormActivity = () => { resetIdleTimer() }
  const draped = drapeState === 'open' || drapeState === 'opening'

  // ── Mouse spotlight (ultra lightweight — tidak memicu re-render) ──────────
  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!spotlightRef.current) return
    const el = spotlightRef.current
    el.style.left = e.clientX + 'px'
    el.style.top = e.clientY + 'px'
  }

  useEffect(() => {
    startMascotCycle()
    return () => {
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current)
      if (drapeAnimRef.current) clearTimeout(drapeAnimRef.current)
      if (mascotTimerRef.current) clearTimeout(mascotTimerRef.current)
      stopMascotCycle()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Canvas bubbles ────────────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const resize = () => { canvas.width = canvas.offsetWidth; canvas.height = canvas.offsetHeight }
    resize()
    window.addEventListener('resize', resize)
    type Bubble = { x: number; y: number; r: number; vx: number; vy: number; alpha: number; phase: 'alive' | 'popping'; popFrame: number }
    const bubbles: Bubble[] = []
    const MAX = 18
    const spawn = (): Bubble => ({
      x: Math.random() * canvas.width, y: canvas.height + 40,
      r: 18 + Math.random() * 38, vx: (Math.random() - 0.5) * 0.6,
      vy: -(0.4 + Math.random() * 0.7), alpha: 0.12 + Math.random() * 0.18,
      phase: 'alive', popFrame: 0,
    })
    for (let i = 0; i < 10; i++) { const b = spawn(); b.y = Math.random() * canvas.height; bubbles.push(b) }
    let raf: number
    const draw = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      if (bubbles.length < MAX && Math.random() < 0.02) bubbles.push(spawn())
      for (let i = bubbles.length - 1; i >= 0; i--) {
        const b = bubbles[i]
        if (b.phase === 'popping') {
          b.popFrame++
          const prog = b.popFrame / 12
          ctx.beginPath(); ctx.arc(b.x, b.y, b.r * (1 + prog * 0.5), 0, Math.PI * 2)
          ctx.strokeStyle = `rgba(255,255,255,${b.alpha * (1 - prog)})`; ctx.lineWidth = 1.5; ctx.stroke()
          if (b.popFrame >= 12) bubbles.splice(i, 1)
          continue
        }
        b.x += b.vx; b.vy += 0.002; b.y += b.vy
        for (let j = i - 1; j >= 0; j--) {
          const o = bubbles[j]; if (o.phase === 'popping') continue
          const dx = b.x - o.x, dy = b.y - o.y, dist = Math.sqrt(dx * dx + dy * dy)
          if (dist < b.r + o.r) { b.phase = 'popping'; b.popFrame = 0; o.phase = 'popping'; o.popFrame = 0; break }
        }
        if (b.y + b.r < 0 || b.x + b.r < 0 || b.x - b.r > canvas.width) { bubbles.splice(i, 1); continue }
        const grad = ctx.createRadialGradient(b.x - b.r * 0.3, b.y - b.r * 0.3, b.r * 0.1, b.x, b.y, b.r)
        grad.addColorStop(0, `rgba(255,255,255,${b.alpha * 1.5})`); grad.addColorStop(0.5, `rgba(255,255,255,${b.alpha * 0.4})`); grad.addColorStop(1, `rgba(255,255,255,0)`)
        ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2); ctx.fillStyle = grad; ctx.fill()
        ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2); ctx.strokeStyle = `rgba(255,255,255,${b.alpha * 1.2})`; ctx.lineWidth = 1; ctx.stroke()
        ctx.beginPath(); ctx.arc(b.x - b.r * 0.28, b.y - b.r * 0.32, b.r * 0.18, 0, Math.PI * 2); ctx.fillStyle = `rgba(255,255,255,${b.alpha * 1.8})`; ctx.fill()
      }
      if (document.visibilityState === 'visible') { raf = requestAnimationFrame(draw) }
    }
    // PERF: hentikan animasi saat tab tidak aktif/di-minimize, dan lanjutkan
    // lagi begitu tab aktif kembali — sebelumnya requestAnimationFrame terus
    // berjalan tanpa henti walau halaman tidak terlihat.
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') { draw() }
      else { cancelAnimationFrame(raf) }
    }
    document.addEventListener('visibilitychange', handleVisibility)
    draw()
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', resize)
      document.removeEventListener('visibilitychange', handleVisibility)
    }
  }, [])

  useEffect(() => {
    fetch('/api/public/pengaturan?t=' + Date.now(), { cache: 'no-store' })
      .then(r => r.json())
      .then(json => {
        if (json?.data) setSiteInfo({ namaSekolah: json.data.namaSekolah ?? '', kota: json.data.kota ?? '', logoUrl: json.data.logoAplikasi || json.data.logoUrl || '' })
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (showGuide || showQA || showAktivitas) { document.body.style.overflow = 'hidden' }
    else { document.body.style.overflow = '' }
    return () => { document.body.style.overflow = '' }
  }, [showGuide, showQA, showAktivitas])

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    if (!form.username || !form.password) { setError('Username dan password wajib diisi'); return }
    setLoading(true); setError('')
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Login gagal')
      localStorage.removeItem('admin_token_backup')
      localStorage.removeItem('admin_user_backup')
      localStorage.setItem('token', data.token)
      localStorage.setItem('user', JSON.stringify({ username: data.username, nama: data.nama, role: data.role, nis: data.nis, kelas: data.kelas }))
      const roleRoutes: Record<string, string> = { ADMIN: '/admin', GURU: '/guru', KEPSEK: '/kepsek', SISWA: '/siswa' }
      router.push(roleRoutes[data.role] ?? '/login')
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Login gagal')
    } finally { setLoading(false) }
  }

  const displayName = siteInfo.namaSekolah || 'SmartExam'
  const year = new Date().getFullYear()

  // 4 fitur untuk grid card
  const FITUR = [
    { icon: <Shield className="w-5 h-5" />, label: 'Anti-Nyontek', color: '#a855f7', bg: 'rgba(168,85,247,0.15)' },
    { icon: <BarChart2 className="w-5 h-5" />, label: 'Penilaian Otomatis', color: '#f97316', bg: 'rgba(249,115,22,0.15)' },
    { icon: <Monitor className="w-5 h-5" />, label: 'Monitoring Real-time', color: '#3b82f6', bg: 'rgba(59,130,246,0.15)' },
    { icon: <CheckCircle className="w-5 h-5" />, label: 'Hasil Akurat', color: '#10b981', bg: 'rgba(16,185,129,0.15)' },
  ]

  return (
    <div
      className="min-h-screen flex relative overflow-hidden"
      onMouseMove={handleMouseMove}
    >
      {/* ── Background foto siswa full 1 layar — di belakang SEMUA elemen.
          `fixed inset-0` supaya tetap penuh & tidak ikut scroll, termasuk
          saat mode Layar Penuh (fullscreen browser).
          DESKTOP (lg+): object-cover — layar lebar sudah cukup proporsional
          dengan rasio asli foto (1672x941), jadi aman di-crop dikit.
          MOBILE: foto (1672x941, landscape) di-cover ke sebuah strip
          setinggi ~46vh nempel di bawah layar, condong ke KIRI (objectPosition
          left) — supaya rombongan siswa (yang posisinya di sisi kiri foto)
          tetap terlihat utuh kepala-sampai-kaki & ukurannya besar/jelas,
          alih-alih di-shrink w-full h-auto (yang menyisakan area kosong
          sangat luas di atas). Ruang di atas foto diisi gradasi biru
          langit senada + konten (tagline & brand) supaya tidak polos. ── */}
      <div className="fixed inset-0 -z-10 overflow-hidden" style={{ background: 'linear-gradient(180deg, #4fa8e8 0%, #7cc3f0 18%, #bfe3fb 38%, #d9eefc 55%, #e8f6fb 70%)' }}>
        {/* Versi desktop — cover penuh, sedikit crop wajar */}
        <img
          src="/images/siswa-sekolah.webp"
          alt="" aria-hidden="true"
          className="hidden lg:block absolute inset-0 w-full h-full object-cover"
          style={{ objectPosition: 'center 30%' }}
        />
        {/* Versi mobile — pakai foto POTRET khusus HP (jika sudah di-upload
            ke /public/images/siswa-sekolah-mobile.webp), full 1 layar tanpa
            perlu awan tambahan karena rasionya sudah pas untuk HP. */}
        {mobileHeroReady && (
          <img
            src="/images/siswa-sekolah-mobile.webp"
            alt="" aria-hidden="true"
            onError={() => setMobileHeroReady(false)}
            className="lg:hidden absolute inset-0 w-full h-full object-cover"
            style={{ objectPosition: 'center top' }}
          />
        )}
        {/* ── Fallback: dipakai HANYA jika siswa-sekolah-mobile.webp belum
            ada di repo — foto landscape yang sudah ada di-crop condong
            kiri + awan dekoratif mengisi celah, supaya tetap terlihat baik
            sebelum aset foto potret HP di-upload. ── */}
        {!mobileHeroReady && (
          <>
            <img
              src="/images/siswa-sekolah.webp"
              alt="" aria-hidden="true"
              className="lg:hidden absolute bottom-0 left-0 w-full h-[48vh] object-cover"
              style={{ minHeight: 340, maxHeight: 540, objectPosition: 'left top' }}
            />
            <div className="lg:hidden absolute inset-x-0 top-0 bottom-0 overflow-hidden" aria-hidden="true">
              <div className="absolute rounded-full" style={{ width: '78vw', height: '16vh', top: '10%', left: '-20vw', background: 'rgba(255,255,255,0.55)', filter: 'blur(7vw)' }} />
              <div className="absolute rounded-full" style={{ width: '60vw', height: '13vh', top: '19%', right: '-18vw', background: 'rgba(255,255,255,0.42)', filter: 'blur(6vw)' }} />
              <div className="absolute rounded-full" style={{ width: '95vw', height: '19vh', top: '29%', left: '-8vw', background: 'rgba(255,255,255,0.32)', filter: 'blur(8vw)' }} />
              <div className="absolute rounded-full" style={{ width: '70vw', height: '15vh', top: '40%', right: '-14vw', background: 'rgba(255,255,255,0.34)', filter: 'blur(7vw)' }} />
              <div className="absolute rounded-full" style={{ width: '90vw', height: '17vh', top: '50%', left: '2vw', background: 'rgba(255,255,255,0.26)', filter: 'blur(7.5vw)' }} />
            </div>
          </>
        )}
        {/* Tint biru lembut supaya teks & kartu login tetap kontras di atas foto */}
        <div className="absolute inset-0" style={{
          background: 'linear-gradient(180deg, rgba(4,32,74,0.30) 0%, rgba(4,32,74,0.05) 20%, rgba(4,32,74,0.05) 55%, rgba(4,32,74,0.55) 100%)',
        }} />
        {/* ── Tepi biru elegan di bagian bawah — meniru contoh desain:
            lengkungan biru bertumpuk (dua gelombang) sehingga sebagian
            foto di bawah tertutup "bis" warna biru yang menyatu rapi. ── */}
        <svg
          className="absolute bottom-0 left-0 w-full"
          style={{ height: '16vh', minHeight: 90, maxHeight: 190 }}
          viewBox="0 0 1440 220" preserveAspectRatio="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path d="M0,90 C240,170 480,20 720,60 C960,100 1200,180 1440,120 L1440,220 L0,220 Z" fill="#1d4ed8" fillOpacity="0.55" />
          <path d="M0,130 C260,205 520,95 780,120 C1020,145 1240,210 1440,160 L1440,220 L0,220 Z" fill="#0ea5e9" fillOpacity="0.85" />
        </svg>
      </div>

      {/* ── Mouse spotlight ── */}
      <div
        ref={spotlightRef}
        style={{
          position: 'fixed', pointerEvents: 'none', zIndex: 0,
          width: '600px', height: '600px',
          background: 'radial-gradient(circle, rgba(255,255,255,0.12) 0%, transparent 70%)',
          borderRadius: '50%',
          transform: 'translate(-50%, -50%)',
          transition: 'left 0.1s ease-out, top 0.1s ease-out',
          left: '-300px', top: '-300px',
        }}
      />

      <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" style={{ pointerEvents: 'none', zIndex: 0 }} />

      {/* ── Tombol Fullscreen — sudut kanan atas ── */}
      <button
        type="button"
        onClick={toggleFullscreen}
        title={isFs ? 'Keluar dari layar penuh' : 'Tampilkan layar penuh'}
        className="absolute z-20 hidden lg:flex items-center gap-2 select-none transition-all"
        style={{
          top: '1rem',
          right: '1.25rem',
          background: 'rgba(255,255,255,0.85)',
          backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)',
          border: '1.5px solid rgba(56,189,248,0.35)', borderRadius: '12px',
          padding: '8px 14px',
          boxShadow: '0 4px 24px rgba(56,189,248,0.18), 0 0 0 1px rgba(255,255,255,0.5), inset 0 1px 0 rgba(255,255,255,0.6)',
          color: '#0c4a6e',
          fontSize: '12px',
          fontWeight: 600,
          letterSpacing: '0.02em',
        }}
      >
        {isFs
          ? <><Minimize className="w-3.5 h-3.5" style={{ color: '#0284c7' }} /><span>Keluar Fullscreen</span></>
          : <><Maximize className="w-3.5 h-3.5" style={{ color: '#0284c7' }} /><span>Layar Penuh</span></>
        }
      </button>

      {/* ── Jam WITA — komponen terpisah agar tick 1 detik tidak me-render ulang seluruh halaman ── */}
      <WitaClock isFs={isFs} />

      {/* ── LEFT — branding ── */}
      {/* Foto siswa sekarang jadi background penuh 1 layar (lihat blok
          background di atas), jadi ilustrasi kecil yang dulu nempel di
          pojok kiri-bawah panel ini sudah tidak dipakai lagi — supaya
          tidak dobel dengan foto yang sama di belakang. */}
      <div className="hidden lg:flex flex-col w-1/2 p-12 text-white relative">
        <div className="relative z-10 space-y-5">
          <div className="flex items-center gap-4 cursor-default w-fit"
            style={{ transition: 'transform 0.35s cubic-bezier(0.34, 1.56, 0.64, 1)' }}
            onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.transform = 'scale(1.14)' }}
            onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.transform = 'scale(1)' }}
          >
            <SchoolLogo size="xl" siteInfo={siteInfo} />
            <div className="min-w-0">
              <p className="font-bold text-2xl leading-tight line-clamp-2 text-white" style={{ textShadow: '0 2px 12px rgba(0,0,0,0.35)' }}>{displayName}</p>
              <p className="text-white/85 text-base" style={{ textShadow: '0 1px 8px rgba(0,0,0,0.3)' }}>Sistem Ujian Digital Terpercaya</p>
            </div>
          </div>

          <div>
            <h1 className="text-4xl xl:text-5xl font-bold leading-tight mb-3 cursor-default w-fit text-white"
              style={{
                transition: 'transform 0.35s cubic-bezier(0.34, 1.56, 0.64, 1)', display: 'inline-block', transformOrigin: 'left center',
                textShadow: '0 2px 6px rgba(0,0,0,0.65), 0 4px 22px rgba(0,0,0,0.5)',
              }}
              onMouseEnter={e => { (e.currentTarget as HTMLHeadingElement).style.transform = 'scale(1.08)' }}
              onMouseLeave={e => { (e.currentTarget as HTMLHeadingElement).style.transform = 'scale(1)' }}
            >
              Ujian Digital<br />
              <span style={{
                background: 'linear-gradient(90deg, #fff9c4, #ffe066, #ffd23f)',
                WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
                backgroundClip: 'text',
                filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.75)) drop-shadow(0 5px 18px rgba(0,0,0,0.55))',
              }}>
                Lebih Mudah & Adil
              </span>
            </h1>
            <p className="text-white/95 text-sm leading-relaxed max-w-xs" style={{ textShadow: '0 1px 4px rgba(0,0,0,0.6), 0 2px 10px rgba(0,0,0,0.4)' }}>
              Sistem CBT modern{siteInfo.namaSekolah ? ` untuk ${siteInfo.namaSekolah}` : ''}{' '}
              dengan fitur anti-nyontek, penilaian otomatis, dan monitoring real-time.
            </p>
          </div>
        </div>
        <div className="relative z-10 mt-auto space-y-3">
          <div
            className="inline-flex items-center gap-2 px-3.5 py-2 rounded-full w-fit"
            style={{
              background: 'rgba(255,255,255,0.10)',
              border: '1px solid rgba(255,255,255,0.28)',
              backdropFilter: 'blur(10px)',
              WebkitBackdropFilter: 'blur(10px)',
              boxShadow: '0 4px 18px rgba(0,0,0,0.28), inset 0 1px 0 rgba(255,255,255,0.2)',
            }}
          >
            <Radio className="w-3.5 h-3.5 text-white/85 flex-shrink-0" />
            <span className="text-xs" style={{ textShadow: '0 1px 4px rgba(0,0,0,0.5)', color: 'rgba(255,255,255,0.9)' }}>
              Tetap lancar mode{' '}
              <span style={{
                fontWeight: 800, letterSpacing: '0.05em',
                background: 'linear-gradient(90deg, #7dd3fc, #5eead4)',
                WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text',
              }}>ONLINE</span>
              {' '}maupun{' '}
              <span style={{
                fontWeight: 800, letterSpacing: '0.05em',
                background: 'linear-gradient(90deg, #fbbf24, #fb923c)',
                WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text',
              }}>OFFLINE</span>
            </span>
          </div>
          <div className="text-white/70 text-xs" style={{ textShadow: '0 1px 6px rgba(0,0,0,0.3)' }}>
            {siteInfo.namaSekolah ? <>{siteInfo.namaSekolah} &copy; {year}</> : <>SmartExam &copy; {year}</>}
          </div>
        </div>
      </div>

      {/* ── RIGHT — login area ── */}
      <div className="flex-1 flex items-center justify-center p-6 relative z-10">
        <div className="w-full max-w-sm relative">

          {/* ── MOBILE ── */}
          <div className="lg:hidden">
            {!mobileLoginOpen ? (
              /* ── State tertutup — layout full-bleed ala "kampus modern":
                  tagline di kiri-atas, brand (logo+nama) di kanan-atas,
                  panel Login + 3 pil (Panduan/Q&A/Aktivitas) menempel di
                  kanan-bawah di atas foto siswa. `fixed inset-0` supaya
                  elemen menempel ke tepi layar HP, lepas dari centering
                  container di atasnya (foto siswa full-screen tetap
                  kelihatan jelas di belakang, tidak ketutup form). ── */
              <div className="fixed inset-0 z-10 flex flex-col justify-between p-5"
                style={{
                  paddingTop: 'calc(env(safe-area-inset-top, 0px) + 1.1rem)',
                  paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 1.5rem)',
                }}
              >
                {/* Baris atas: tagline (kiri) + brand (kanan) */}
                <div className="flex items-start justify-between gap-3">
                  <div className="max-w-[54%]">
                    <p className="text-white font-semibold text-lg leading-snug italic"
                      style={{ textShadow: '0 2px 10px rgba(0,0,0,0.45)' }}>
                      Ujian Hari Ini<br />untuk Masa Depan<br />yang Lebih Baik
                    </p>
                    <span className="block w-16 h-[3px] rounded-full mt-2" style={{ background: '#fbbf24' }} />
                  </div>
                  <div className="flex flex-col items-end text-right gap-1.5 flex-shrink-0">
                    <SchoolLogo size="lg" siteInfo={siteInfo} />
                    <div>
                      <p className="font-bold text-white text-lg leading-tight" style={{ textShadow: '0 2px 10px rgba(0,0,0,0.5)' }}>{displayName}</p>
                      <p className="text-white/85 text-[11px] mt-0.5" style={{ textShadow: '0 1px 6px rgba(0,0,0,0.45)' }}>Sistem Ujian Digital Terpercaya</p>
                    </div>
                  </div>
                </div>

                {/* Panel bawah-kanan: Login + 3 pil */}
                <div className="self-end w-full max-w-[230px] flex flex-col gap-2.5 rounded-3xl p-3.5"
                  style={{
                    background: 'rgba(255,255,255,0.22)',
                    backdropFilter: 'blur(14px)', WebkitBackdropFilter: 'blur(14px)',
                    border: '1px solid rgba(255,255,255,0.35)',
                    boxShadow: '0 12px 40px rgba(4,32,74,0.25)',
                  }}
                >
                  <button
                    type="button"
                    onClick={() => setMobileLoginOpen(true)}
                    className="btn-login-drape flex items-center justify-center gap-2 px-6 py-3.5 rounded-full text-white font-bold text-sm tracking-wide"
                    style={{ boxShadow: '0 8px 32px rgba(37,99,235,0.4), 0 0 50px rgba(20,184,166,0.25)' }}
                  >
                    <Lock className="w-4 h-4 opacity-90" />
                    Login
                  </button>

                  <div className="flex gap-2">
                    <button type="button" onClick={() => setShowGuide(true)}
                      className="flex-1 flex flex-col items-center justify-center gap-1 py-2.5 rounded-xl text-slate-600 hover:text-slate-900 bg-white/90 border border-white/60 text-[10px] font-medium transition-all">
                      <BookMarked className="w-4 h-4" /> Panduan
                    </button>
                    <button type="button" onClick={() => setShowQA(true)}
                      className="flex-1 flex flex-col items-center justify-center gap-1 py-2.5 rounded-xl text-slate-600 hover:text-slate-900 bg-white/90 border border-white/60 text-[10px] font-medium transition-all">
                      <HelpCircle className="w-4 h-4" /> Q&amp;A
                    </button>
                    <button type="button" onClick={() => { setShowAktivitas(true) }}
                      className="flex-1 flex flex-col items-center justify-center gap-1 py-2.5 rounded-xl text-sky-700 hover:text-sky-900 bg-sky-50/95 border border-sky-200 text-[10px] font-medium transition-all">
                      <Activity className="w-4 h-4" /> Aktivitas
                    </button>
                  </div>
                </div>
              </div>
            ) : (
            <>
            <div className="flex items-center gap-3 mb-6 justify-center relative">
              <SchoolLogo size="sm" siteInfo={siteInfo} />
              <div className="min-w-0 text-left">
                <p className="font-bold text-slate-900 text-base leading-tight line-clamp-2">{displayName}</p>
                {!siteInfo.namaSekolah && <p className="text-slate-500 text-xs">Sistem Ujian Digital Terpercaya</p>}
              </div>
              {/* Tombol kembali — sembunyikan form, tampilkan foto lagi */}
              <button type="button" onClick={() => setMobileLoginOpen(false)}
                className="absolute right-0 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full flex items-center justify-center bg-white/80 text-slate-500 hover:text-slate-800 hover:bg-white transition-all"
                aria-label="Tutup form login">
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Welcome card mobile — glass */}
            <div className="login-glass-card rounded-3xl p-8 text-slate-900">
              {/* Avatar + heading */}
              <div className="flex flex-col items-center mb-6">
                <div className="w-16 h-16 rounded-full bg-sky-50 flex items-center justify-center mb-3">
                  <User className="w-7 h-7 text-sky-500" />
                </div>
                <h2 className="text-2xl font-bold text-slate-900">Selamat Datang &#128075;</h2>
                <p className="text-slate-500 text-sm mt-1">Silakan login untuk melanjutkan</p>
              </div>

              <form onSubmit={handleLogin} className="space-y-4">
                {error && (
                  <div className="flex items-center gap-2 p-3 rounded-xl bg-red-50 border border-red-200 text-red-600 text-sm">
                    <AlertCircle className="w-4 h-4 flex-shrink-0" /><span>{error}</span>
                  </div>
                )}
                <div>
                  <label className="block text-sm font-medium text-slate-600 mb-1.5">Username / NIS</label>
                  <div className="relative">
                    <User className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                    <input type="text" placeholder="Masukkan username atau NIS"
                      className="w-full pl-10 pr-4 py-3 rounded-xl text-sm text-slate-900 placeholder-slate-400 bg-slate-50 border border-slate-200 focus:outline-none focus:ring-2 focus:ring-sky-400/60 focus:border-sky-400/60 transition-all"
                      value={form.username} onChange={e => setForm(f => ({ ...f, username: e.target.value }))}
                      autoComplete="username" autoFocus
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-600 mb-1.5">Password</label>
                  <div className="relative">
                    <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                    <input type={showPw ? 'text' : 'password'} placeholder="Masukkan password"
                      className="w-full pl-10 pr-10 py-3 rounded-xl text-sm text-slate-900 placeholder-slate-400 bg-slate-50 border border-slate-200 focus:outline-none focus:ring-2 focus:ring-sky-400/60 focus:border-sky-400/60 transition-all"
                      value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                      autoComplete="current-password"
                    />
                    <button type="button" onClick={() => setShowPw(v => !v)}
                      className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                      {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
                <button type="submit" disabled={loading}
                  className="btn-login-drape w-full flex items-center justify-center gap-2 py-3.5 rounded-2xl text-white font-bold text-base mt-2 disabled:opacity-60"
                >
                  {loading ? (
                    <><span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />Masuk...</>
                  ) : (<><Lock className="w-4 h-4 opacity-90" /><span>Login Disini</span><span style={{ fontSize: '16px' }}>▾</span></>)}
                </button>
              </form>

              {/* Divider */}
              <div className="flex items-center gap-3 my-4">
                <div className="flex-1 h-px bg-slate-200" />
                <span className="text-slate-400 text-xs">atau</span>
                <div className="flex-1 h-px bg-slate-200" />
              </div>

              {/* Grid 4 fitur */}
              <div className="grid grid-cols-4 gap-2 mb-4">
                {FITUR.map(f => (
                  <div key={f.label} className="flex flex-col items-center gap-1.5 p-2.5 rounded-xl"
                    style={{ background: f.bg, border: `1px solid ${f.color}30` }}>
                    <span style={{ color: f.color }}>{f.icon}</span>
                    <span className="text-[10px] text-center leading-tight font-medium" style={{ color: f.color }}>{f.label}</span>
                  </div>
                ))}
              </div>

              {/* Footer sekolah */}
              <div className="text-center border-t border-slate-100 pt-4">
                <p className="font-bold text-slate-700 text-sm">{displayName}</p>
                {siteInfo.kota && <p className="text-slate-400 text-xs mt-0.5">{siteInfo.kota}</p>}
              </div>
            </div>

            {/* Panduan / Q&A / Lihat Aktivitas — 3 pil senada, warna Aktivitas dibedakan */}
            <div className="flex gap-2 mt-4">
              <button type="button" onClick={() => setShowGuide(true)}
                className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-slate-500 hover:text-slate-800 bg-white/70 border border-slate-200 hover:border-slate-300 text-xs font-medium transition-all">
                <BookMarked className="w-3.5 h-3.5" /> Panduan
              </button>
              <button type="button" onClick={() => setShowQA(true)}
                className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-slate-500 hover:text-slate-800 bg-white/70 border border-slate-200 hover:border-slate-300 text-xs font-medium transition-all">
                <HelpCircle className="w-3.5 h-3.5" /> Q&amp;A
              </button>
              <button type="button" onClick={() => { setShowAktivitas(true) }}
                className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-sky-600 hover:text-sky-800 bg-sky-50/80 border border-sky-200 hover:border-sky-300 text-xs font-medium transition-all">
                <Activity className="w-3.5 h-3.5" /> Aktivitas
              </button>
            </div>
            <DevCredit />
            </>
            )}
          </div>

          {/* ── DESKTOP: efek kain + welcome card premium ── */}
          <div ref={formAreaRef} className="hidden lg:block relative" onMouseEnter={openDrape}>

            {/* Tombol "Login Disini" — closed state (selalu render untuk jaga tinggi container) */}
            <div
              className="relative flex flex-col items-center gap-4"
              style={{
                zIndex: 2,
                opacity: drapeState === 'closed' ? 1 : 0,
                pointerEvents: drapeState === 'closed' ? 'auto' : 'none',
                transition: 'opacity 0.3s ease',
                visibility: drapeState === 'closed' ? 'visible' : 'hidden',
              }}
              onMouseEnter={handleMascotEnter}
              onMouseLeave={handleMascotLeave}
            >
              {/* Welcome card preview (closed state) — glass */}
              <div className="login-glass-card rounded-3xl w-full p-7 text-center">
                {/* Maskot emoji */}
                <div className="absolute -top-14 left-1/2 -translate-x-1/2" style={{ zIndex: 3 }}>
                  <svg width="64" height="64" viewBox="0 0 64 64" className={mascotMood === 'idle' ? 'mascot-bounce' : ''}>
                    <circle cx="32" cy="32" r="26" fill="#fde68a" stroke="#f59e0b" strokeWidth="2" />
                    {mascotMood === 'sad' ? (
                      <>
                        <path d="M19 26 q4 -5 9 0" stroke="#7c2d12" strokeWidth="2.5" fill="none" strokeLinecap="round" />
                        <path d="M36 26 q4 -5 9 0" stroke="#7c2d12" strokeWidth="2.5" fill="none" strokeLinecap="round" />
                      </>
                    ) : (
                      <>
                        <circle cx="23" cy="28" r="2.6" fill="#7c2d12" />
                        <circle cx="41" cy="28" r="2.6" fill="#7c2d12" />
                      </>
                    )}
                    {mascotMood === 'sad'
                      ? <path d="M22 42 q10 -8 20 0" stroke="#7c2d12" strokeWidth="2.5" fill="none" strokeLinecap="round" />
                      : <path d="M22 36 q10 8 20 0" stroke="#7c2d12" strokeWidth="2.5" fill="none" strokeLinecap="round" />
                    }
                    <g className={mascotMood === 'wave' ? 'mascot-wave' : ''} style={{ transformOrigin: '50px 38px', opacity: mascotMood === 'wave' ? 1 : 0, transition: 'opacity 0.2s ease' }}>
                      <circle cx="50" cy="38" r="2" fill="#7c2d12" />
                      <path d="M50 38 L58 24" stroke="#f59e0b" strokeWidth="5" strokeLinecap="round" />
                      <circle cx="58" cy="24" r="4.5" fill="#fde68a" stroke="#f59e0b" strokeWidth="2" />
                    </g>
                  </svg>
                </div>

                <div className="mt-6 mb-5">
                  <h2 className="text-2xl font-bold text-slate-900">Selamat Datang &#128075;</h2>
                  <p className="text-slate-500 text-sm mt-1">Silakan login untuk melanjutkan</p>
                </div>

                <button
                  type="button"
                  onClick={openDrape}
                  className="btn-login-drape w-full flex items-center justify-center gap-3 px-8 py-4 rounded-2xl text-white font-bold text-base tracking-wide select-none cursor-pointer"
                  style={{ boxShadow: '0 4px 32px rgba(37,99,235,0.35), 0 0 60px rgba(20,184,166,0.2), 0 2px 8px rgba(15,23,42,0.12)', letterSpacing: '0.04em' }}
                >
                  <Lock className="w-5 h-5 opacity-90" />
                  <span>Login Disini</span>
                  <span style={{ display: 'inline-block', transform: draped ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.55s cubic-bezier(0.34, 1.56, 0.64, 1)', fontSize: '18px', lineHeight: 1, opacity: 0.85 }}>▾</span>
                </button>

                {/* Divider */}
                <div className="flex items-center gap-3 my-4">
                  <div className="flex-1 h-px bg-slate-200" />
                  <span className="text-slate-400 text-xs">atau</span>
                  <div className="flex-1 h-px bg-slate-200" />
                </div>

                {/* Grid 4 fitur */}
                <div className="grid grid-cols-4 gap-2 mb-5">
                  {FITUR.map(f => (
                    <div key={f.label} className="flex flex-col items-center gap-1.5 p-3 rounded-xl"
                      style={{ background: f.bg, border: `1px solid ${f.color}30` }}>
                      <span style={{ color: f.color }}>{f.icon}</span>
                      <span className="text-[10px] text-center leading-tight font-medium" style={{ color: f.color }}>{f.label}</span>
                    </div>
                  ))}
                </div>

                {/* Tombol Lihat Aktivitas — closed state desktop */}
                <button
                  type="button"
                  onClick={e => { e.stopPropagation(); setShowAktivitas(true) }}
                  className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl mb-4 text-xs font-semibold transition-all"
                  style={{
                    background: 'linear-gradient(135deg, rgba(14,165,233,0.12) 0%, rgba(20,184,166,0.12) 100%)',
                    border: '1px solid rgba(14,165,233,0.3)',
                    color: '#0284c7',
                  }}
                >
                  <Activity className="w-3.5 h-3.5" />
                  Lihat Aktivitas
                </button>

                {/* Footer sekolah dalam card */}
                <div className="border-t border-slate-100 pt-4">
                  <p className="font-bold text-slate-700 text-sm">{displayName}</p>
                  {siteInfo.kota && <p className="text-slate-400 text-xs mt-0.5">{siteInfo.kota}</p>}
                </div>
                <DevCredit />
              </div>
            </div>

            {/* ── Kain terurai — form login (absolute overlay, tidak geser layout) ── */}
            {drapeState !== 'closed' && (
              <div
                key={drapeState === 'opening' ? 'open' : drapeState}
                className={drapeState === 'closing' ? 'drape-close' : 'drape-open'}
                style={{ transformOrigin: 'top center', position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10, maxHeight: '92vh', overflowY: 'auto' }}
                onMouseEnter={resetIdleTimer}
                onMouseMove={handleFormActivity}
              >
                {/* Jahitan atas — gradient biru-teal */}
                <div style={{
                  height: '5px',
                  background: 'linear-gradient(90deg, #2563eb, #0ea5e9, #14b8a6, #0ea5e9, #2563eb)',
                  backgroundSize: '300% 100%',
                  animation: 'gradientShift 4s ease infinite',
                }} />

                <div
                  className="rounded-b-3xl p-6"
                  style={{
                    background: 'rgba(255, 255, 255, 0.26)',
                    backdropFilter: 'blur(14px) saturate(180%)', WebkitBackdropFilter: 'blur(14px) saturate(180%)',
                    border: '1px solid rgba(255,255,255,0.65)',
                    borderTop: 'none',
                    boxShadow: `
                      0 32px 80px rgba(15,23,42,0.24),
                      0 2px 4px rgba(15,23,42,0.08),
                      inset 0 -2px 0 rgba(15,23,42,0.10),
                      inset 2px 0 0 rgba(255,255,255,0.4),
                      inset -2px 0 0 rgba(15,23,42,0.07)
                    `,
                  }}
                >
                  {/* Bar tutup */}
                  <div className="mb-3 flex items-center gap-2 justify-end">
                    <span className="text-[10px] text-slate-400">Auto-tutup dalam 10 detik tanpa aktivitas</span>
                    <button type="button" onClick={closeDrape}
                      className="w-5 h-5 rounded-full flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors">
                      <X className="w-3 h-3" />
                    </button>
                  </div>

                  <div className="mb-4 text-center">
                    <h2 className="text-xl font-bold text-slate-900">Selamat Datang</h2>
                    <p className="text-slate-500 text-sm mt-1">Masuk ke akun Anda untuk melanjutkan</p>
                  </div>

                  <form onSubmit={handleLogin} className="space-y-4" onInput={handleFormActivity} onChange={handleFormActivity}>
                    {error && (
                      <div className="flex items-start gap-2 p-3 rounded-xl bg-red-50 border border-red-200 text-red-600 text-sm">
                        <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" /><span>{error}</span>
                      </div>
                    )}
                    <div>
                      <label className="block text-sm font-medium text-slate-600 mb-1.5">Username / NIS</label>
                      <div className="relative"
                        style={{ transition: 'transform 0.25s cubic-bezier(0.34, 1.56, 0.64, 1)' }}
                        onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.transform = 'scale(1.03)' }}
                        onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.transform = 'scale(1)' }}
                      >
                        <User className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                        <input type="text" placeholder="Masukkan username atau NIS"
                          className="w-full pl-10 pr-4 py-2.5 rounded-xl text-sm text-slate-900 placeholder-slate-400 bg-slate-50 border border-slate-200 focus:outline-none focus:ring-2 focus:ring-sky-400/60 focus:border-sky-400/60 transition-all"
                          value={form.username}
                          onChange={e => { setForm(f => ({ ...f, username: e.target.value })); resetIdleTimer() }}
                          autoComplete="username"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-600 mb-1.5">Password</label>
                      <div className="relative"
                        style={{ transition: 'transform 0.25s cubic-bezier(0.34, 1.56, 0.64, 1)' }}
                        onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.transform = 'scale(1.03)' }}
                        onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.transform = 'scale(1)' }}
                      >
                        <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                        <input type={showPw ? 'text' : 'password'} placeholder="Masukkan password"
                          className="w-full pl-10 pr-10 py-2.5 rounded-xl text-sm text-slate-900 placeholder-slate-400 bg-slate-50 border border-slate-200 focus:outline-none focus:ring-2 focus:ring-sky-400/60 focus:border-sky-400/60 transition-all"
                          value={form.password}
                          onChange={e => { setForm(f => ({ ...f, password: e.target.value })); resetIdleTimer() }}
                          autoComplete="current-password"
                        />
                        <button type="button" onClick={() => { setShowPw(v => !v); resetIdleTimer() }}
                          className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                          {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                      </div>
                    </div>

                    <button type="submit" disabled={loading}
                      className="btn-login-drape w-full flex items-center justify-center gap-2 py-3 rounded-2xl text-white font-bold text-base mt-2 disabled:opacity-60"
                      style={{ boxShadow: '0 4px 24px rgba(37,99,235,0.3), 0 0 40px rgba(20,184,166,0.18)' }}
                    >
                      {loading ? (
                        <><span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />Masuk...</>
                      ) : 'Masuk'}
                    </button>
                  </form>

                  <div className="mt-4 pt-4 border-t border-slate-100 space-y-2.5">
                    <p className="text-xs text-slate-400 text-center">Lupa password? Hubungi administrator sekolah.</p>
                    <div className="flex gap-2">
                      <button type="button" onClick={() => { setShowGuide(true); resetIdleTimer() }}
                        className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-xl border border-slate-200 text-slate-500 hover:text-slate-800 hover:border-slate-300 text-xs font-medium transition-all">
                        <BookMarked className="w-3.5 h-3.5" /> Panduan
                      </button>
                      <button type="button" onClick={() => { setShowQA(true); resetIdleTimer() }}
                        className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-xl border border-slate-200 text-slate-500 hover:text-slate-800 hover:border-slate-300 text-xs font-medium transition-all">
                        <HelpCircle className="w-3.5 h-3.5" /> Q&amp;A
                      </button>
                    </div>
                    {/* Tombol Lihat Aktivitas — desktop */}
                    <button
                      type="button"
                      onClick={() => { setShowAktivitas(true); resetIdleTimer() }}
                      className="w-full flex items-center justify-center gap-2 py-2 rounded-xl text-xs font-semibold transition-all"
                      style={{
                        background: 'linear-gradient(135deg, rgba(14,165,233,0.12) 0%, rgba(20,184,166,0.12) 100%)',
                        border: '1px solid rgba(14,165,233,0.3)',
                        color: '#0284c7',
                      }}
                    >
                      <Activity className="w-3.5 h-3.5" />
                      Lihat Aktivitas
                    </button>
                    <DevCredit />
                  </div>
                </div>
              </div>
            )}
          </div>

          {(siteInfo.namaSekolah || siteInfo.kota) && (
            <p className="text-center text-slate-400 text-xs mt-4 hidden lg:block">
              {[siteInfo.namaSekolah, siteInfo.kota].filter(Boolean).join(' · ')}
            </p>
          )}
        </div>
      </div>

      {showGuide && (
        <GuideModal year={year} onClose={() => setShowGuide(false)} onOpenQA={() => { setShowGuide(false); setShowQA(true) }} />
      )}

      {showQA && (
        <QAModal year={year} onClose={() => setShowQA(false)} onOpenGuide={() => { setShowQA(false); setShowGuide(true) }} />
      )}

      {showAktivitas && (
        <AktivitasModal onClose={() => setShowAktivitas(false)} />
      )}
    </div>
  )
}
