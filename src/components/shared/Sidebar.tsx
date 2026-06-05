'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import {
  LayoutDashboard, Users, BookOpen, Calendar, ClipboardList,
  BarChart3, Settings, LogOut, Menu, X, ChevronRight,
  GraduationCap, School, Bell, User, FileUp, FileText
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { AuthUser } from '@/types'

interface NavItem {
  label: string
  href: string
  icon: React.ElementType
  badge?: string
}

interface SidebarProps {
  navItems: NavItem[]
  role: string
  roleColor: string
  roleLabel: string
}

export function Sidebar({ navItems, role, roleColor, roleLabel }: SidebarProps) {
  const pathname = usePathname()
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [user, setUser] = useState<AuthUser | null>(null)

  useEffect(() => {
    const stored = localStorage.getItem('user')
    if (stored) setUser(JSON.parse(stored))
  }, [])

  function logout() {
    localStorage.removeItem('token')
    localStorage.removeItem('user')
    router.push('/login')
  }

  const SidebarContent = () => (
    <div className="flex flex-col h-full">
      {/* Logo */}
      <div className="px-4 py-5 border-b border-slate-100">
        <div className="flex items-center gap-3">
          <div className={cn('w-9 h-9 rounded-xl flex items-center justify-center', roleColor)}>
            <GraduationCap className="w-5 h-5 text-white" />
          </div>
          <div>
            <div className="font-bold text-slate-900 text-sm leading-tight">SmartExam</div>
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
              onClick={() => setOpen(false)}
              className={cn(
                'nav-link group',
                isActive ? 'nav-link-active' : 'nav-link-inactive'
              )}
            >
              <item.icon className="w-4 h-4 flex-shrink-0" />
              <span className="flex-1">{item.label}</span>
              {item.badge && (
                <span className="text-xs px-1.5 py-0.5 rounded-full bg-danger-500 text-white font-medium">
                  {item.badge}
                </span>
              )}
              {!isActive && <ChevronRight className="w-3 h-3 opacity-0 group-hover:opacity-40 transition-opacity" />}
            </Link>
          )
        })}
      </nav>

      {/* User info + logout */}
      <div className="p-3 border-t border-slate-100">
        <div className="flex items-center gap-3 px-3 py-2.5 rounded-xl bg-slate-50 mb-1">
          <div className={cn('w-8 h-8 rounded-lg flex items-center justify-center text-white text-xs font-bold', roleColor)}>
            {user?.nama?.charAt(0) ?? 'U'}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium text-slate-800 truncate">{user?.nama ?? '...'}</div>
            <div className="text-xs text-slate-400">{user?.username}</div>
          </div>
        </div>
        <button
          onClick={logout}
          className="nav-link-inactive w-full text-danger-600 hover:bg-danger-50 hover:text-danger-700"
        >
          <LogOut className="w-4 h-4" />
          <span>Keluar</span>
        </button>
      </div>
    </div>
  )

  return (
    <>
      {/* Mobile toggle */}
      <button
        onClick={() => setOpen(true)}
        className="fixed top-4 left-4 z-40 lg:hidden btn-secondary btn-icon shadow-card-md"
      >
        <Menu className="w-5 h-5" />
      </button>

      {/* Mobile drawer */}
      {open && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-0 bottom-0 w-64 bg-white shadow-card-lg animate-slide-up">
            <button
              onClick={() => setOpen(false)}
              className="absolute top-3 right-3 btn-ghost btn-icon"
            >
              <X className="w-4 h-4" />
            </button>
            <SidebarContent />
          </div>
        </div>
      )}

      {/* Desktop sidebar */}
      <aside className="hidden lg:flex flex-col w-60 bg-white border-r border-slate-100 h-screen sticky top-0 flex-shrink-0">
        <SidebarContent />
      </aside>
    </>
  )
}

// Role-specific sidebar configs
export function AdminSidebar() {
  return (
    <Sidebar
      role="ADMIN"
      roleColor="bg-brand-600"
      roleLabel="Administrator"
      navItems={[
        { label: 'Dashboard', href: '/admin', icon: LayoutDashboard },
        { label: 'Data Siswa', href: '/admin/siswa', icon: Users },
        { label: 'Data Guru', href: '/admin/users', icon: User },
        { label: 'Kelas', href: '/admin/kelas', icon: School },
        { label: 'Mata Pelajaran', href: '/admin/mapel', icon: BookOpen },
        { label: 'Jadwal Ujian', href: '/admin/jadwal', icon: Calendar },
        { label: 'Validasi Soal', href: '/admin/soal', icon: ClipboardList },
        { label: 'Rekap Nilai', href: '/admin/nilai', icon: BarChart3 },
        { label: 'Import Data', href: '/admin/import', icon: FileUp },
        { label: 'Pengaturan', href: '/admin/pengaturan', icon: Settings },
      ]}
    />
  )
}

export function GuruSidebar() {
  const [isWaliKelas, setIsWaliKelas] = useState(false)
  const [hasPengawasan, setHasPengawasan] = useState(false)

  useEffect(() => {
    const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null
    if (!token) return
    const headers = { Authorization: `Bearer ${token}` }

    fetch('/api/guru/wali-kelas', { headers })
      .then(r => r.json())
      .then(d => { if (d.isWaliKelas) setIsWaliKelas(true) })
      .catch(() => {})

    fetch('/api/guru/jadwal-pengawasan', { headers })
      .then(r => r.json())
      .then(d => { if (d.hasJadwal || (d.data && d.data.length > 0)) setHasPengawasan(true) })
      .catch(() => {})
  }, [])

  const navItems: NavItem[] = [
    { label: 'Dashboard', href: '/guru', icon: LayoutDashboard },
    { label: 'Kisi-kisi', href: '/guru/kisi-kisi', icon: FileText },  // ← BARU
    { label: 'Bank Soal', href: '/guru/soal', icon: BookOpen },
    { label: 'Buat Soal', href: '/guru/paket', icon: ClipboardList },
    { label: 'Rekap Nilai', href: '/guru/nilai', icon: BarChart3 },
    { label: 'Analisis Soal', href: '/guru/analisis', icon: BarChart3 },
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
      navItems={navItems}
    />
  )
}

export function PengawasSidebar() {
  return (
    <Sidebar
      role="PENGAWAS"
      roleColor="bg-orange-600"
      roleLabel="Pengawas"
      navItems={[
        { label: 'Dashboard', href: '/pengawas', icon: LayoutDashboard },
        { label: 'Buka Sesi', href: '/pengawas/sesi', icon: Calendar },
        { label: 'Monitor Ujian', href: '/pengawas/monitor', icon: BarChart3 },
      ]}
    />
  )
}

export function KepsekSidebar() {
  return (
    <Sidebar
      role="KEPSEK"
      roleColor="bg-purple-600"
      roleLabel="Kepala Sekolah"
      navItems={[
        { label: 'Dashboard', href: '/kepsek', icon: LayoutDashboard },
        { label: 'Rekap Nilai', href: '/kepsek/nilai', icon: BarChart3 },
        { label: 'Persetujuan', href: '/kepsek/persetujuan', icon: ClipboardList },
      ]}
    />
  )
}

export function SiswaSidebar() {
  return (
    <Sidebar
      role="SISWA"
      roleColor="bg-cyan-600"
      roleLabel="Siswa"
      navItems={[
        { label: 'Beranda', href: '/siswa', icon: LayoutDashboard },
        { label: 'Kisi-kisi', href: '/siswa/kisi-kisi', icon: FileText },  // ← BARU
        { label: 'Mulai Ujian', href: '/siswa/ujian', icon: BookOpen },
        { label: 'Nilai Saya', href: '/siswa/nilai', icon: BarChart3 },
        { label: 'Jadwal', href: '/siswa/jadwal', icon: Calendar },
      ]}
    />
  )
}
