'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { AdminSidebar } from '@/components/shared/Sidebar'
import { FullscreenButton } from '@/components/shared/FullscreenButton'

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter()

  useEffect(() => {
    const user = localStorage.getItem('user')
    if (!user) { router.replace('/login'); return }
    const parsed = JSON.parse(user)
    if (!['ADMIN'].includes(parsed.role)) {
      router.replace('/login')
    }
  }, [router])

  return (
    <div className="flex min-h-screen" style={{
      background: 'linear-gradient(135deg, #e0f7fa 0%, #f0f9ff 40%, #e8f5e9 100%)',
    }}>
      {/* Subtle SVG mesh — pure CSS, zero JS, zero server cost */}
      <svg aria-hidden="true" className="pointer-events-none fixed inset-0 w-full h-full" style={{ zIndex: 0, opacity: 0.18 }}
        viewBox="0 0 1440 900" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <radialGradient id="adm-g1" cx="20%" cy="20%" r="55%"><stop offset="0%" stopColor="#0891b2" stopOpacity="0.55"/><stop offset="100%" stopColor="#0891b2" stopOpacity="0"/></radialGradient>
          <radialGradient id="adm-g2" cx="80%" cy="75%" r="50%"><stop offset="0%" stopColor="#06b6d4" stopOpacity="0.45"/><stop offset="100%" stopColor="#06b6d4" stopOpacity="0"/></radialGradient>
          <radialGradient id="adm-g3" cx="55%" cy="10%" r="40%"><stop offset="0%" stopColor="#10b981" stopOpacity="0.3"/><stop offset="100%" stopColor="#10b981" stopOpacity="0"/></radialGradient>
        </defs>
        <rect width="1440" height="900" fill="url(#adm-g1)"/>
        <rect width="1440" height="900" fill="url(#adm-g2)"/>
        <rect width="1440" height="900" fill="url(#adm-g3)"/>
        <circle cx="200" cy="150" r="180" fill="none" stroke="#0891b2" strokeWidth="1" strokeOpacity="0.25"/>
        <circle cx="1280" cy="700" r="220" fill="none" stroke="#06b6d4" strokeWidth="1" strokeOpacity="0.2"/>
        <circle cx="750" cy="80" r="120" fill="none" stroke="#0891b2" strokeWidth="0.8" strokeOpacity="0.2"/>
        <line x1="0" y1="300" x2="500" y2="100" stroke="#0891b2" strokeWidth="0.7" strokeOpacity="0.18"/>
        <line x1="900" y1="0" x2="1440" y2="400" stroke="#06b6d4" strokeWidth="0.7" strokeOpacity="0.15"/>
        <line x1="0" y1="700" x2="700" y2="900" stroke="#0891b2" strokeWidth="0.6" strokeOpacity="0.13"/>
      </svg>
      <div className="relative z-10 flex w-full">
        <AdminSidebar />
        <FullscreenButton />
        <main className="flex-1 min-w-0 p-6 lg:p-8 pt-16 lg:pt-16">
          {children}
        </main>
      </div>
    </div>
  )
}
