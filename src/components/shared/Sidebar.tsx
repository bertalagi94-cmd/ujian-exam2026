'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import {
  LayoutDashboard, Users, BookOpen, Calendar, ClipboardList,
  BarChart3, Settings, LogOut, Menu, X, ChevronRight, ChevronLeft,
  GraduationCap, School, Bell, User, FileText, Eye, ShieldAlert,
  FileBarChart, CheckSquare, Send
} from 'lucide-react'
import { cn, apiRequest } from '@/lib/utils'
import { AuthUser } from '@/types'
import { useSidebarCollapsedPref } from '@/lib/sidebar-collapsed-pref'
// FIX (belum ada antrean "ujian belum terkirim" yang permanen — temuan #2):
// dipakai untuk badge jumlah paket tertunda di menu SiswaSidebar.
import { ambilSemuaPaketTertunda } from '@/lib/ujian-outbox'
import { hapusCadanganLihatSebagai } from '@/lib/lihat-sebagai'

interface NavItem {
  label: string
  href: string
  icon: React.ElementType
  badge?: number
  // FITUR BARU (pisahkan menu "Wali Kelas" dari menu guru-pengampu biasa):
  // dua opsi tampilan murni visual, tidak memengaruhi urutan/isi navItems
  // di array-nya sendiri (itu diatur oleh pemanggilnya, mis. GuruSidebar).
  //  - `divider`: render garis pembatas + sedikit jarak SEBELUM item ini,
  //    dipakai untuk menandai "mulai bagian baru" di sidebar.
  //  - `variant: 'highlight'`: beri gaya berbeda (latar putih, teks hitam
  //    tebal) saat item ini TIDAK aktif, supaya menonjol dari menu lain.
  //    Saat item ini aktif (sedang dibuka), tetap pakai gaya aktif standar
  //    (gradient warna aksen) seperti menu lainnya, supaya penanda "sedang
  //    di halaman ini" tetap konsisten di seluruh sidebar.
  divider?: boolean
  variant?: 'default' | 'highlight'
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

interface SiteInfo {
  namaSekolah: string
  logoUrl: string
}

interface SidebarContentProps {
  navItems: NavItem[]
  roleColor: string
  roleLabel: string
  accent: string
  user: AuthUser | null
  siteInfo: SiteInfo
  onClose: () => void
  onLogout: () => void
}

function SidebarContent({ navItems, roleColor, roleLabel, accent, user, siteInfo, onClose, onLogout }: SidebarContentProps) {
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
      {/* Logo — pakai logo & nama sekolah dari Pengaturan jika sudah diisi,
          sama seperti di halaman login. Fallback ke ikon default "SmartExam"
          kalau admin belum upload logo / isi nama sekolah. */}
      <div className="px-4 py-5" style={{ borderBottom: '1px solid rgba(0,0,0,0.07)' }}>
        <div className="flex items-center gap-3">
          {siteInfo.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={siteInfo.logoUrl}
              alt={siteInfo.namaSekolah || 'Logo'}
              className="w-9 h-9 rounded-xl object-contain bg-white/40 p-1 flex-shrink-0"
            />
          ) : (
            <div className={cn('w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0', roleColor)}>
              <GraduationCap className="w-5 h-5 text-white" />
            </div>
          )}
          <div className="min-w-0">
            <div className="font-bold text-slate-800 text-sm leading-tight truncate glass-text">
              {siteInfo.namaSekolah || 'SmartExam'}
            </div>
            <div className="sidebar-sublabel">{roleLabel}</div>
          </div>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 p-3 space-y-0.5 overflow-y-auto">
        {navItems.map((item) => {
          const isActive = pathname === item.href || pathname.startsWith(item.href + '/')
          // FITUR BARU (menu "Wali Kelas" dipisah secara visual): item dengan
          // variant 'highlight' dan sedang TIDAK aktif dapat gaya sendiri
          // (latar putih, teks hitam tebal, border tipis) supaya langsung
          // terlihat beda dari menu guru-pengampu biasa di atasnya — tanpa
          // mengubah perilaku klik/navigasi sama sekali.
          const isHighlight = item.variant === 'highlight' && !isActive
          return (
            <div key={item.href}>
              {item.divider && (
                <div className="my-2 border-t border-slate-200/70" />
              )}
              <Link
                href={item.href}
                onClick={onClose}
                className={cn(
                  'nav-link group',
                  isActive && 'nav-link-active-zoom',
                  !isActive && !isHighlight && 'nav-link-inactive',
                  isHighlight && 'bg-white text-slate-900 font-bold border border-slate-200 shadow-sm hover:bg-slate-50'
                )}
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
            </div>
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
            <div className="text-sm font-medium text-slate-800 truncate glass-text">{user?.nama ?? '...'}</div>
            <div className="sidebar-sublabel">{user?.username}</div>
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
  const [siteInfo, setSiteInfo] = useState<SiteInfo>({ namaSekolah: '', logoUrl: '' })
  // Sembunyikan/tampilkan sidebar khusus tampilan desktop/laptop, supaya
  // halaman bisa dibuat lebih lebar seperti aplikasi web pada umumnya.
  // Tidak berlaku untuk drawer mobile (menu tetap muncul via tombol ☰).
  const [collapsed, setCollapsed] = useSidebarCollapsedPref()

  useEffect(() => {
    const stored = localStorage.getItem('user')
    if (stored) setUser(JSON.parse(stored))
  }, [])

  // Ambil logo & nama sekolah dari Pengaturan (endpoint publik yang sama
  // dipakai halaman login), supaya sidebar admin/guru/kepsek/siswa ikut
  // menampilkan logo custom, bukan ikon default terus-menerus.
  const loadSiteInfo = useCallback(() => {
    fetch('/api/public/pengaturan?t=' + Date.now(), { cache: 'no-store' })
      .then(r => r.json())
      .then(json => {
        if (json?.data) {
          setSiteInfo({
            namaSekolah: json.data.namaSekolah ?? '',
            logoUrl: json.data.logoAplikasi || json.data.logoUrl || '',
          })
        }
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    loadSiteInfo()
    // Pengaturan bisa diubah admin di halaman lain tanpa reload — dengarkan
    // event yang sama yang sudah dipakai dashboard admin (lihat pengaturan/page.tsx).
    window.addEventListener('pengaturan-changed', loadSiteInfo)
    return () => window.removeEventListener('pengaturan-changed', loadSiteInfo)
  }, [loadSiteInfo])

  // BUG FIX #2: logout() was recreated every render, which caused subtle
  // reference instability. Wrap with useCallback so it's stable.
  const logout = useCallback(() => {
    localStorage.removeItem('token')
    localStorage.removeItem('user')
    // FIX (audit Device Binding, temuan 🟠): ujian_device_id sebelumnya TIDAK
    // pernah dihapus saat logout, sehingga di komputer/browser bersama (mis.
    // lab sekolah) nilai device_id lama tetap tersimpan dan bisa "diwariskan"
    // ke siswa berikutnya yang login di perangkat/browser yang sama. Ini
    // bukan pengikatan kriptografis (device_id tetap bisa disalin manual lewat
    // DevTools oleh pihak yang punya kredensial siswa lain), tapi mengurangi
    // jejak paling mudah: begitu siswa menekan Logout, device_id lama tidak
    // lagi ada untuk "ditemukan" begitu saja oleh siswa berikutnya di
    // perangkat yang sama. Login berikutnya (siswa mana pun) akan membuat
    // device_id BARU (lihat getDeviceId() di siswa/ujian/page.tsx).
    localStorage.removeItem('ujian_device_id')
    hapusCadanganLihatSebagai()
    router.push('/login')
  }, [router])

  const handleClose = useCallback(() => setOpen(false), [])

  return (
    <>
      {/* Mobile toggle — glass/frosted, role-tinted.
          FIX KONTRAS (Latar Kaca Transparan): sebelumnya background cuma
          rgba(255,255,255,0.6) — kalau foto blur di baliknya kebetulan
          gelap, ikon jadi kurang jelas. Dinaikkan ke 0.88 supaya tetap
          terasa "kaca" tapi jauh lebih aman dibaca di kedua kondisi latar. */}
      <button
        onClick={() => setOpen(true)}
        className="fixed top-4 left-4 z-40 lg:hidden btn-icon"
        style={{
          background: 'rgba(255,255,255,0.88)',
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
                background: 'rgba(255,255,255,0.88)',
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
              siteInfo={siteInfo}
              onClose={handleClose}
              onLogout={logout}
            />
          </div>
        </div>
      )}

      {/* Desktop sidebar — frosted glass with role-tinted gradient wash.
          Lebar dianimasikan ke 0 saat disembunyikan (overflow-hidden supaya
          isinya ikut ter-"gulung", bukan cuma ditumpuk transparan), konten
          di dalamnya dikunci lebar 240px supaya tidak ikut menyusut/kusut
          selama animasi berjalan.
          FIX KONTRAS (Latar Kaca Transparan): titik tengah gradient tadinya
          rgba(255,255,255,0.78) — cukup transparan sehingga saat efek latar
          foto aktif, sisa ~22% foto blur masih bisa membuat teks menu (yang
          tidak duduk di dalam .card) kurang kontras. Dinaikkan ke 0.92 (mirip
          drawer mobile di atas yang sudah 0.92) supaya sidebar tetap terasa
          "kaca" tapi teksnya konsisten mudah dibaca di kedua kondisi latar. */}
      <aside
        className="hidden lg:flex flex-col h-screen sticky top-0 flex-shrink-0 overflow-hidden transition-[width] duration-300 ease-in-out"
        style={{
          width: collapsed ? 0 : 240,
          background: `linear-gradient(165deg, ${accent}14 0%, rgba(255,255,255,0.92) 50%, ${accent}0A 100%)`,
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
          borderRight: collapsed ? 'none' : `1px solid ${accent}26`,
          boxShadow: collapsed ? 'none' : `4px 0 24px ${accent}14`,
        }}
      >
        <div style={{ width: 240 }} className="h-full flex-shrink-0">
          <SidebarContent
            navItems={navItems}
            roleColor={roleColor}
            roleLabel={roleLabel}
            accent={accent}
            user={user}
            siteInfo={siteInfo}
            onClose={handleClose}
            onLogout={logout}
          />
        </div>
      </aside>

      {/* Tombol sembunyikan/tampilkan — khusus desktop/laptop. Posisinya
          "menempel" di tepi kanan sidebar dan otomatis geser ke kiri
          (menempel tepi layar) saat sidebar disembunyikan, jadi selalu
          mudah ditemukan untuk memunculkan menu lagi. */}
      <button
        type="button"
        onClick={() => setCollapsed(!collapsed)}
        className="hidden lg:flex fixed z-30 items-center justify-center w-6 h-12 rounded-r-xl transition-[left] duration-300 ease-in-out"
        style={{
          top: '50%',
          transform: 'translateY(-50%)',
          left: collapsed ? 0 : 240,
          background: 'rgba(255,255,255,0.92)',
          border: `1px solid ${accent}33`,
          borderLeft: collapsed ? `1px solid ${accent}33` : 'none',
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
          boxShadow: `2px 2px 10px ${accent}22`,
          color: accent,
        }}
        title={collapsed ? 'Tampilkan menu' : 'Sembunyikan menu'}
        aria-label={collapsed ? 'Tampilkan menu' : 'Sembunyikan menu'}
      >
        {collapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
      </button>
    </>
  )
}

// ── Helper: fetch badge count ─────────────────────────────────────────────────
function useBadgeCounts(role: 'ADMIN' | 'GURU' | 'SISWA') {
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

    // FIX (badge sidebar lambat hilang setelah menyetujui soal): sebelumnya
    // badge hanya diperbarui oleh polling 30 detik, jadi setelah admin
    // menyetujui/menolak paket, angka di sidebar baru turun paling lama 30
    // detik kemudian (sementara badge di toggle Soal PG/Essay pada halaman
    // langsung berubah). Halaman yang mengubah jumlah tugas menunggu
    // memancarkan event 'notif-changed' → sidebar langsung fetch ulang.
    window.addEventListener('notif-changed', fetch_)

    return () => {
      if (id !== null) clearInterval(id)
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('notif-changed', fetch_)
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
    { label: 'Data Pengguna', href: '/admin/users', icon: User },
    { label: 'Kelas', href: '/admin/kelas', icon: School },
    { label: 'Mata Pelajaran', href: '/admin/mapel', icon: BookOpen },
    { label: 'Jadwal Ujian', href: '/admin/jadwal', icon: Calendar },
    { label: 'Kisi-kisi', href: '/admin/kisi-kisi', icon: FileText },
    {
      label: 'Validasi Soal',
      href: '/admin/soal',
      icon: ClipboardList,
      badge: counts.validasiSoal || undefined,
    },
    { label: 'Rekap Nilai', href: '/admin/nilai', icon: BarChart3 },
    { label: 'Analisis Ujian', href: '/admin/analisis-ujian', icon: BarChart3 },
    { label: 'Pelanggaran', href: '/admin/pelanggaran', icon: ShieldAlert },
    { label: 'Laporan Lengkap', href: '/admin/laporan', icon: FileBarChart },
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

  // FITUR (badge "Kisi-kisi baru dari rekan kerja"): pola yang sama persis
  // dengan notifSentRef di atas untuk /guru/soal — begitu guru membuka menu
  // Kisi-kisi, tandai sudah dibaca (sekali per kunjungan, bukan tiap render)
  // supaya angka badge langsung hilang dan tidak muncul lagi untuk
  // kisi-kisi yang sama.
  const kisiKisiNotifSentRef = useRef(false)
  useEffect(() => {
    const onKisiKisiPage = pathname?.startsWith('/guru/kisi-kisi')
    if (!onKisiKisiPage) {
      kisiKisiNotifSentRef.current = false
      return
    }
    if (kisiKisiNotifSentRef.current) return
    const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null
    if (!token) return
    kisiKisiNotifSentRef.current = true
    apiRequest('/api/notif', { method: 'POST', body: JSON.stringify({ type: 'kisi_kisi' }), timeoutMs: 8_000 })
      .then(() => window.dispatchEvent(new Event('notif-changed')))
      .catch(() => {})
  }, [pathname])

  const navItems: NavItem[] = [
    { label: 'Dashboard', href: '/guru', icon: LayoutDashboard },
    {
      label: 'Kisi-kisi',
      href: '/guru/kisi-kisi',
      icon: FileText,
      badge: counts.kisiKisiBaru || undefined,
    },
    {
      // FIX (konsolidasi menu): menu "Bank Soal" (/guru/soal) digabung ke
      // sini — satu tempat untuk PG & Essay: buat, edit, kirim, tarik,
      // duplicate paket soal. Halaman /guru/soal masih ada sebagai redirect
      // supaya link/bookmark lama tidak 404, tapi tidak lagi punya menu sendiri.
      label: 'Buat Soal',
      href: '/guru/paket',
      icon: ClipboardList,
      badge: counts.bankSoal || undefined,
    },
    // FIX (konsolidasi menu): "Koreksi Essay", "Rekap Nilai", dan "Kirim
    // Nilai ke Wali Kelas" digabung jadi satu menu "Penilaian" dengan 3 tab
    // bernomor (lihat src/app/guru/penilaian/page.tsx) — guru cuma perlu
    // satu tempat untuk seluruh alur penilaian, dari periksa jawaban essay
    // sampai kirim nilai akhir. Route lama (/guru/koreksi-essay, /guru/nilai,
    // /guru/kirim-nilai) masih ada sebagai redirect supaya link/bookmark
    // lama tidak 404, tapi tidak lagi punya menu sendiri.
    { label: 'Penilaian', href: '/guru/penilaian', icon: CheckSquare },
    // FIX (kejelasan menu): sebelumnya pakai ikon BarChart3 yang sama persis
    // dengan "Rekap Nilai" (kini tab di dalam "Penilaian"), jadi dua menu
    // berbeda fungsi terlihat seperti menu yang sama sekilas pandang.
    // Dipakaikan FileBarChart (sudah dipakai di sidebar admin untuk "Laporan
    // Lengkap", jadi maknanya konsisten: laporan/analisis, bukan tabel nilai
    // mentah) supaya guru bisa membedakan dua menu ini tanpa harus membaca
    // labelnya dulu.
    { label: 'Analisis Ujian', href: '/guru/analisis-ujian', icon: FileBarChart },
  ]

  // FIX (kejelasan menu — permintaan: menu "Wali Kelas" sering tertukar
  // dengan menu "Penilaian" karena sama-sama soal nilai dan posisinya
  // berdekatan di atas): "Wali Kelas" TIDAK lagi digabung dengan extras lain
  // di posisi awal. Sekarang selalu ditaruh PALING AKHIR (setelah "Analisis
  // Ujian"), dipisahkan dengan garis pembatas (`divider`) dan gaya berbeda
  // (`variant: 'highlight'` — latar putih, teks hitam tebal, lihat
  // SidebarContent) supaya guru sadar ini adalah "topi" / peran yang
  // berbeda (wali kelas), bukan sekadar menu penilaian mapel biasa.
  // Kondisi tampil (hanya untuk guru yang memang wali kelas) TIDAK berubah.
  if (isWaliKelas) {
    navItems.push({
      label: 'Wali Kelas',
      href: '/guru/wali-kelas',
      icon: School,
      divider: true,
      variant: 'highlight',
    })
  }

  const extras: NavItem[] = []
  if (hasPengawasan) {
    extras.push({ label: 'Jadwal Pengawasan', href: '/guru/jadwal-pengawasan', icon: Calendar })
    extras.push({ label: 'Mode Pengawas', href: '/guru/mode-pengawas', icon: Bell })
  }
  navItems.splice(1, 0, ...extras)

  return (
    <Sidebar
      role="GURU"
      roleColor="bg-emerald-600"
      roleLabel={isWaliKelas ? 'Guru & Wali Kelas' : 'Guru'}
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
        { label: 'Data Kelas', href: '/kepsek/kelas', icon: Users },
        { label: 'Guru & Mapel', href: '/kepsek/guru', icon: BookOpen },
        { label: 'Jadwal Ujian', href: '/kepsek/jadwal', icon: Calendar },
        { label: 'Kisi-kisi', href: '/kepsek/kisi-kisi', icon: FileText },
        { label: 'Hasil Ujian', href: '/kepsek/nilai', icon: BarChart3 },
        { label: 'Monitoring Ujian', href: '/kepsek/monitoring', icon: Eye },
      ]}
    />
  )
}

export function SiswaSidebar() {
  const counts = useBadgeCounts('SISWA')
  const pathname = usePathname()
  const [adaJadwalHariIni, setAdaJadwalHariIni] = useState(true) // default true agar tidak kedip saat load
  // FIX (belum ada antrean "ujian belum terkirim" yang permanen — temuan #2):
  // badge jumlah paket tertunda di menu, dibaca dari outbox lokal (bukan
  // state global) — konsisten dengan cara halaman /siswa/pengiriman-tertunda
  // membacanya. Di-poll ringan supaya badge hilang otomatis begitu penjaga
  // latar belakang (mulaiPenjagaOutbox, lihat siswa/layout.tsx) berhasil
  // mengirim ulang paketnya, tanpa siswa perlu me-refresh halaman.
  const [jumlahTertunda, setJumlahTertunda] = useState(0)

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
        // FIX BUG (menu "Mulai Ujian" tidak muncul untuk sesi susulan):
        // sebelumnya filter di sini HANYA mengandalkan `j.tanggal === today`
        // — sama persis dengan bug yang sudah diperbaiki di
        // src/app/siswa/ujian/page.tsx (lihat komentar panjang di sana) dan
        // src/app/siswa/jadwal/page.tsx, tapi perbaikannya waktu itu tidak
        // ikut diterapkan di sini. Akibatnya: untuk sesi susulan yang dibuka
        // admin/pengawas pada jadwal yang tanggal ASLINYA sudah lewat (lihat
        // /api/admin/susulan — hanya `jadwal.status` yang di-set 'BERJALAN',
        // `jadwal.tanggal` sengaja tidak diubah), menu "Mulai Ujian" di
        // sidebar tetap disembunyikan walau siswa sebenarnya bisa masuk lewat
        // halaman /siswa/ujian atau /siswa/jadwal. Sekarang disamakan: sesi
        // dengan status BERJALAN ikut dihitung apa pun tanggalnya.
        const jadwalHariIni = (json.data ?? []).filter((j) =>
          (j.tanggal?.slice(0, 10) === today || j.status === 'BERJALAN') && !j.sudah_ikut && j.status !== 'SELESAI'
        )
        setAdaJadwalHariIni(jadwalHariIni.length > 0)
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    let nis: string | undefined
    try { nis = JSON.parse(localStorage.getItem('user') ?? '{}').nis } catch { /* abaikan */ }
    if (!nis) return
    let batal = false
    // FIX AUDIT P0 #7: ambilSemuaPaketTertunda sekarang async (IndexedDB) —
    // lihat src/lib/ujian-outbox.ts.
    const cek = () => {
      ambilSemuaPaketTertunda(nis!).then((daftar) => {
        if (!batal) setJumlahTertunda(daftar.length)
      })
    }
    cek()
    const interval = setInterval(cek, 5000)
    return () => { batal = true; clearInterval(interval) }
  }, [])

  // FITUR (badge "Kisi-kisi baru"): pola sama seperti GuruSidebar — begitu
  // siswa membuka menu Kisi-kisi, tandai sudah dibaca (sekali per kunjungan)
  // supaya angka badge langsung hilang.
  const kisiKisiNotifSentRef = useRef(false)
  useEffect(() => {
    const onKisiKisiPage = pathname?.startsWith('/siswa/kisi-kisi')
    if (!onKisiKisiPage) {
      kisiKisiNotifSentRef.current = false
      return
    }
    if (kisiKisiNotifSentRef.current) return
    const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null
    if (!token) return
    kisiKisiNotifSentRef.current = true
    apiRequest('/api/notif', { method: 'POST', body: JSON.stringify({ type: 'kisi_kisi' }), timeoutMs: 8_000 })
      .then(() => window.dispatchEvent(new Event('notif-changed')))
      .catch(() => {})
  }, [pathname])

  const navItems: NavItem[] = [
    { label: 'Beranda', href: '/siswa', icon: LayoutDashboard },
    {
      label: 'Kisi-kisi',
      href: '/siswa/kisi-kisi',
      icon: FileText,
      badge: counts.kisiKisiBaru || undefined,
    },
    ...(adaJadwalHariIni ? [{ label: 'Mulai Ujian', href: '/siswa/ujian', icon: BookOpen } as NavItem] : []),
    ...(jumlahTertunda > 0
      ? [{ label: 'Pengiriman Tertunda', href: '/siswa/pengiriman-tertunda', icon: Send, badge: jumlahTertunda } as NavItem]
      : []),
    { label: 'Nilai Saya', href: '/siswa/nilai', icon: BarChart3 },
    { label: 'Jadwal', href: '/siswa/jadwal', icon: Calendar },
    // FITUR (Halaman profil siswa): biodata + ganti password sendiri.
    { label: 'Profil Saya', href: '/siswa/profil', icon: User },
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
