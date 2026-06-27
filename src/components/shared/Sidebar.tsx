'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import {
  LayoutDashboard, Users, BookOpen, Calendar, ClipboardList,
  BarChart3, Settings, LogOut, Menu, X, ChevronRight,
  GraduationCap, School, Bell, User, FileText, Eye, ShieldAlert
} from 'lucide-react'
import { cn, apiRequest } from '@/lib/utils'
import { AuthUser } from '@/types'

interface NavItem {
  label: string
  href: string
  icon: React.ElementType
  badge?: number
}

interface SidebarProps {
  navItems: NavItem[]
  role: string
  roleColor: string
  roleLabel: string
  /** Hex color used for the glass/frosted accents (nav active state, sidebar tint, mobile toggle). */
  accent?: string
}

// ─────────────────────────────────────────────────────────────────────────────
// BUG FIX #1: SidebarContent WAS defined as an inline function component inside
// Sidebar(). React identifies component types by reference — every Sidebar
// render created a brand-new SidebarContent function, so React treated it as a
// completely different component and fully unmounted+remounted it. This caused:
//   • Link clicks appearing to do nothing (the node was being torn down mid-navigation)
//   • Focus lost immediately after clicking a nav item
//   • Occasional white flash between route transitions
// FIX: Move SidebarContent out to module scope and pass everything it needs as
// explicit props, so the reference is stable across renders.
// ─────────────────────────────────────────────────────────────────────────────

interface SidebarContentProps {
  navItems: NavItem[]
  roleColor: string
  roleLabel: string
  accent: string
  user: AuthUser | null
  onClose: () => void
  onLogout: () => void
}

function SidebarContent({ navItems, roleColor, roleLabel, accent, user, onClose, onLogout }: SidebarContentProps) {
  const pathname = usePathname()

  return (
    <div className="flex flex-col h-full relative">
      {/* Subtle decorative accent — sits behind content, pure SVG, zero JS cost */}
      <svg aria-hidden="true" className="pointer-events-none absolute inset-0 w-full h-full" style={{ zIndex: 0, opacity: 0.5 }}
        viewBox="0 0 240 800" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg">
        <circle cx="210" cy="60" r="90" fill="none" stroke={accent} strokeWidth="1" strokeOpacity="0.18"/>
        <circle cx="20" cy="740" r="110" fill="none" stroke={accent} strokeWidth="1" strokeOpacity="0.16"/>
        <polygon points="180,420 230,395 240,440 220,480 175,470" fill={accent} fillOpacity="0.05" stroke={accent} strokeWidth="0.8" strokeOpacity="0.16"/>
        <line x1="0" y1="220" x2="160" y2="120" stroke={accent} strokeWidth="0.7" strokeOpacity="0.14"/>
        <line x1="60" y1="800" x2="220" y2="640" stroke={accent} strokeWidth="0.7" strokeOpacity="0.12"/>
      </svg>
      <div className="relative z-10 flex flex-col h-full">
      {/* Logo */}
      <div className="px-4 py-5" style={{ borderBottom: '1px solid rgba(0,0,0,0.07)' }}>
        <div className="flex items-center gap-3">
          <div className={cn('w-9 h-9 rounded-xl flex items-center justify-center', roleColor)}>
            <GraduationCap className="w-5 h-5 text-white" />
          </div>
          <div>
            <div className="font-bold text-slate-800 text-sm leading-tight">SmartExam</div>
            <div className="text-xs text-slate-400">{roleLabel}</div>
          </div>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 p-3 space-y-0.5 overflow-y-auto">
        {navItems.map((item) => {
          const isActive = pathname === item.href || pathname.startsWith(item.href + '/')
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onClose}
              className={cn('nav-link group', !isActive && 'nav-link-inactive')}
              style={isActive ? {
                background: `linear-gradient(135deg, ${accent}E6, ${accent}CC)`,
                color: '#ffffff',
                boxShadow: `0 4px 14px ${accent}40, inset 0 1px 0 rgba(255,255,255,0.25)`,
                backdropFilter: 'blur(8px)',
              } : undefined}
            >
              <item.icon className="w-4 h-4 flex-shrink-0" />
              <span className="flex-1">{item.label}</span>
              {item.badge != null && item.badge > 0 && (
                <span className="text-xs px-1.5 py-0.5 rounded-full bg-red-500 text-white font-medium min-w-[18px] text-center leading-none">
                  {item.badge > 99 ? '99+' : item.badge}
                </span>
              )}
              {!isActive && <ChevronRight className="w-3 h-3 opacity-0 group-hover:opacity-40 transition-opacity" />}
            </Link>
          )
        })}
      </nav>

      {/* User info + logout */}
      <div className="p-3" style={{ borderTop: '1px solid rgba(0,0,0,0.07)' }}>
        <div className="flex items-center gap-3 px-3 py-2.5 rounded-xl mb-1"
          style={{
            background: `${accent}14`,
            border: `1px solid ${accent}22`,
            backdropFilter: 'blur(8px)',
          }}>
          <div className={cn('w-8 h-8 rounded-lg flex items-center justify-center text-white text-xs font-bold', roleColor)}>
            {user?.nama?.charAt(0) ?? 'U'}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium text-slate-800 truncate">{user?.nama ?? '...'}</div>
            <div className="text-xs text-slate-400">{user?.username}</div>
          </div>
        </div>
        <button
          onClick={onLogout}
          className="nav-link w-full text-danger-600"
          style={{
            background: 'rgba(254,242,242,0.65)',
            border: '1px solid rgba(252,165,165,0.5)',
            backdropFilter: 'blur(8px)',
          }}
        >
          <LogOut className="w-4 h-4" />
          <span>Keluar</span>
        </button>
      </div>
      </div>
    </div>
  )
}

export function Sidebar({ navItems, role, roleColor, roleLabel, accent = '#0891b2' }: SidebarProps) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [user, setUser] = useState<AuthUser | null>(null)

  useEffect(() => {
    const stored = localStorage.getItem('user')
    if (stored) setUser(JSON.parse(stored))
  }, [])

  // BUG FIX #2: logout() was recreated every render, which caused subtle
  // reference instability. Wrap with useCallback so it's stable.
  const logout = useCallback(() => {
    localStorage.removeItem('token')
    localStorage.removeItem('user')
    router.push('/login')
  }, [router])

  const handleClose = useCallback(() => setOpen(false), [])

  return (
    <>
      {/* Mobile toggle — glass/frosted, role-tinted */}
      <button
        onClick={() => setOpen(true)}
        className="fixed top-4 left-4 z-40 lg:hidden btn-icon"
        style={{
          background: 'rgba(255,255,255,0.6)',
          border: `1px solid ${accent}33`,
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
          boxShadow: `0 4px 16px ${accent}26, inset 0 1px 0 rgba(255,255,255,0.5)`,
          color: accent,
        }}
      >
        <Menu className="w-5 h-5" />
      </button>

      {/* Mobile drawer */}
      {open && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={handleClose} />
          <div className="absolute left-0 top-0 bottom-0 w-64 shadow-card-lg animate-slide-up"
            style={{
              background: `linear-gradient(165deg, ${accent}1F 0%, rgba(255,255,255,0.92) 45%)`,
              backdropFilter: 'blur(20px)',
              WebkitBackdropFilter: 'blur(20px)',
            }}
          >
            <button
              onClick={handleClose}
              className="absolute top-3 right-3 btn-icon z-10"
              style={{
                background: 'rgba(255,255,255,0.6)',
                border: `1px solid ${accent}33`,
                backdropFilter: 'blur(8px)',
                color: accent,
              }}
            >
              <X className="w-4 h-4" />
            </button>
            <SidebarContent
              navItems={navItems}
              roleColor={roleColor}
              roleLabel={roleLabel}
              accent={accent}
              user={user}
              onClose={handleClose}
              onLogout={logout}
            />
          </div>
        </div>
      )}

      {/* Desktop sidebar — frosted glass with role-tinted gradient wash */}
      <aside className="hidden lg:flex flex-col w-60 h-screen sticky top-0 flex-shrink-0"
        style={{
          background: `linear-gradient(165deg, ${accent}1A 0%, rgba(255,255,255,0.78) 50%, ${accent}0D 100%)`,
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
          borderRight: `1px solid ${accent}26`,
          boxShadow: `4px 0 24px ${accent}14`,
        }}
      >
        <SidebarContent
          navItems={navItems}
          roleColor={roleColor}
          roleLabel={roleLabel}
          accent={accent}
          user={user}
          onClose={handleClose}
          onLogout={logout}
        />
      </aside>
    </>
  )
}

// ── Helper: fetch badge count ─────────────────────────────────────────────────
function useBadgeCounts(role: 'ADMIN' | 'GURU') {
  const [counts, setCounts] = useState<Record<string, number>>({})

  // BUG FIX #3a: The dependency array had `role` in it, which meant every time
  // the parent re-rendered and passed a new string literal, fetch_ was recreated
  // and the interval was reset — causing "polling storm" during navigation.
  // Use a ref for role so the callback is stable.
  const roleRef = useRef(role)

  const fetch_ = useCallback(() => {
    const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null
    if (!token) return
    apiRequest<Record<string, number>>('/api/notif', { timeoutMs: 8_000 })
      .then(d => setCounts(d))
      .catch(() => {})
  }, []) // stable — no deps needed since we use ref

  useEffect(() => {
    roleRef.current = role
  }, [role])

  // FIX: Berhenti polling saat tab tidak aktif (document.hidden).
  // Sebelumnya setInterval terus berjalan di background. Browser mobile
  // men-throttle interval saat tab tidak aktif, lalu melepas semua
  // "hutang" interval sekaligus saat tab aktif kembali — menyebabkan
  // beberapa request menumpuk bersamaan dan membuat UI terasa beku.
  // Solusi: pause interval saat hidden, resume + langsung fetch sekali
  // saat tab aktif kembali supaya badge langsung terupdate.
  useEffect(() => {
    fetch_()

    let id: ReturnType<typeof setInterval> | null = setInterval(fetch_, 30_000)

    function onVisibility() {
      if (document.hidden) {
        // Tab tidak aktif — hentikan polling
        if (id !== null) {
          clearInterval(id)
          id = null
        }
      } else {
        // Tab aktif kembali — fetch langsung sekali, lalu mulai polling lagi
        fetch_()
        if (id === null) {
          id = setInterval(fetch_, 30_000)
        }
      }
    }

    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      if (id !== null) clearInterval(id)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [fetch_])

  return counts
}

// ── Admin Sidebar ─────────────────────────────────────────────────────────────
export function AdminSidebar() {
  const counts = useBadgeCounts('ADMIN')

  const navItems: NavItem[] = [
    { label: 'Dashboard', href: '/admin', icon: LayoutDashboard },
    { label: 'Data Siswa', href: '/admin/siswa', icon: Users },
    { label: 'Data Guru', href: '/admin/users', icon: User },
    { label: 'Kelas', href: '/admin/kelas', icon: School },
    { label: 'Mata Pelajaran', href: '/admin/mapel', icon: BookOpen },
    { label: 'Jadwal Ujian', href: '/admin/jadwal', icon: Calendar },
    {
      label: 'Validasi Soal',
      href: '/admin/soal',
      icon: ClipboardList,
      badge: counts.validasiSoal || undefined,
    },
    { label: 'Rekap Nilai', href: '/admin/nilai', icon: BarChart3 },
    { label: 'Analisis Ujian', href: '/admin/analisis-ujian', icon: BarChart3 },
    { label: 'Pelanggaran', href: '/admin/pelanggaran', icon: ShieldAlert },
    { label: 'Pengaturan', href: '/admin/pengaturan', icon: Settings },
  ]

  return (
    <Sidebar
      role="ADMIN"
      roleColor="bg-brand-600"
      roleLabel="Administrator"
      accent="#0891b2"
      navItems={navItems}
    />
  )
}

// ── Guru Sidebar ──────────────────────────────────────────────────────────────
export function GuruSidebar() {
  const counts = useBadgeCounts('GURU')
  const [isWaliKelas, setIsWaliKelas] = useState(false)
  const [hasPengawasan, setHasPengawasan] = useState(false)
  const pathname = usePathname()

  useEffect(() => {
    const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null
    if (!token) return

    apiRequest<{ isWaliKelas?: boolean }>('/api/guru/wali-kelas', { timeoutMs: 8_000 })
      .then(d => { if (d.isWaliKelas) setIsWaliKelas(true) })
      .catch(() => {})

    apiRequest<{ hasJadwal?: boolean; data?: unknown[] }>('/api/guru/jadwal-pengawasan', { timeoutMs: 8_000 })
      .then(d => { if (d.hasJadwal || (d.data && d.data.length > 0)) setHasPengawasan(true) })
      .catch(() => {})
  }, [])

  // BUG FIX #3b: This effect ran every time `pathname` changed AND every time
  // the component re-rendered, causing repeated POST /api/notif calls (once per
  // keystroke in a form, once per scroll, etc.). Added a ref to guard so the
  // POST only fires once per distinct "soal page" entry, not on every render.
  const notifSentRef = useRef(false)
  useEffect(() => {
    const onSoalPage = pathname?.startsWith('/guru/soal') || pathname?.startsWith('/guru/paket')
    if (!onSoalPage) {
      notifSentRef.current = false // reset when leaving the page
      return
    }
    if (notifSentRef.current) return // already sent this session
    const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null
    if (!token) return
    notifSentRef.current = true
    apiRequest('/api/notif', { method: 'POST', timeoutMs: 8_000 }).catch(() => {})
  }, [pathname])

  const navItems: NavItem[] = [
    { label: 'Dashboard', href: '/guru', icon: LayoutDashboard },
    { label: 'Kisi-kisi', href: '/guru/kisi-kisi', icon: FileText },
    {
      label: 'Bank Soal',
      href: '/guru/soal',
      icon: BookOpen,
      badge: counts.bankSoal || undefined,
    },
    {
      label: 'Buat Soal',
      href: '/guru/paket',
      icon: ClipboardList,
      badge: counts.bankSoal || undefined,
    },
    { label: 'Rekap Nilai', href: '/guru/nilai', icon: BarChart3 },
    { label: 'Analisis Ujian', href: '/guru/analisis-ujian', icon: BarChart3 },
  ]

  const extras: NavItem[] = []
  if (isWaliKelas) extras.push({ label: 'Wali Kelas', href: '/guru/wali-kelas', icon: School })
  if (hasPengawasan) {
    extras.push({ label: 'Jadwal Pengawasan', href: '/guru/jadwal-pengawasan', icon: Calendar })
    extras.push({ label: 'Mode Pengawas', href: '/guru/mode-pengawas', icon: Bell })
  }
  navItems.splice(1, 0, ...extras)

  return (
    <Sidebar
      role="GURU"
      roleColor="bg-emerald-600"
      roleLabel="Guru"
      accent="#059669"
      navItems={navItems}
    />
  )
}

export function KepsekSidebar() {
  return (
    <Sidebar
      role="KEPSEK"
      roleColor="bg-purple-600"
      roleLabel="Kepala Sekolah"
      accent="#7c3aed"
      navItems={[
        { label: 'Dashboard', href: '/kepsek', icon: LayoutDashboard },
        { label: 'Jadwal Ujian', href: '/kepsek/jadwal', icon: Calendar },
        { label: 'Hasil Ujian', href: '/kepsek/nilai', icon: BarChart3 },
        { label: 'Monitoring Ujian', href: '/kepsek/monitoring', icon: Eye },
      ]}
    />
  )
}

export function SiswaSidebar() {
  const [adaJadwalHariIni, setAdaJadwalHariIni] = useState(true) // default true agar tidak kedip saat load

  useEffect(() => {
    const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null
    if (!token) return
    apiRequest<{ data?: { tanggal: string; sudah_ikut: boolean; status: string }[]; zonaWaktu?: { utcOffsetJam: number } }>(
      '/api/siswa/jadwal',
      { timeoutMs: 8_000, cache: 'no-store' }
    )
      .then(json => {
        const zonaOffset = (json.zonaWaktu?.utcOffsetJam ?? 7) as number
        const shifted = new Date(Date.now() + zonaOffset * 60 * 60 * 1000)
        const today = shifted.toISOString().slice(0, 10)
        const jadwalHariIni = (json.data ?? []).filter((j) =>
          j.tanggal?.slice(0, 10) === today && !j.sudah_ikut && j.status !== 'SELESAI'
        )
        setAdaJadwalHariIni(jadwalHariIni.length > 0)
      })
      .catch(() => {})
  }, [])

  const navItems: NavItem[] = [
    { label: 'Beranda', href: '/siswa', icon: LayoutDashboard },
    { label: 'Kisi-kisi', href: '/siswa/kisi-kisi', icon: FileText },
    ...(adaJadwalHariIni ? [{ label: 'Mulai Ujian', href: '/siswa/ujian', icon: BookOpen } as NavItem] : []),
    { label: 'Nilai Saya', href: '/siswa/nilai', icon: BarChart3 },
    { label: 'Jadwal', href: '/siswa/jadwal', icon: Calendar },
  ]

  return (
    <Sidebar
      role="SISWA"
      roleColor="bg-cyan-600"
      roleLabel="Siswa"
      accent="#0891b2"
      navItems={navItems}
    />
  )
}
