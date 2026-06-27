'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { GuruSidebar } from '@/components/shared/Sidebar'
import { SesiTerlupaPopup } from '@/components/shared/SesiTerlupaPopup'
import { FullscreenButton } from '@/components/shared/FullscreenButton'

export default function GuruLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter()

  useEffect(() => {
    const user = localStorage.getItem('user')
    if (!user) { router.replace('/login'); return }
    const parsed = JSON.parse(user)
    if (parsed.role !== 'GURU') router.replace('/login')
  }, [router])

  return (
    <div className="flex min-h-screen" style={{
      background: 'linear-gradient(135deg, #d1fae5 0%, #f0fdf4 40%, #ecfdf5 100%)',
    }}>
      {/* Subtle SVG mesh — pure CSS, zero JS, zero server cost */}
      <svg aria-hidden="true" className="pointer-events-none fixed inset-0 w-full h-full" style={{ zIndex: 0, opacity: 0.18 }}
        viewBox="0 0 1440 900" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <radialGradient id="gru-g1" cx="15%" cy="25%" r="55%"><stop offset="0%" stopColor="#059669" stopOpacity="0.5"/><stop offset="100%" stopColor="#059669" stopOpacity="0"/></radialGradient>
          <radialGradient id="gru-g2" cx="85%" cy="70%" r="50%"><stop offset="0%" stopColor="#10b981" stopOpacity="0.45"/><stop offset="100%" stopColor="#10b981" stopOpacity="0"/></radialGradient>
          <radialGradient id="gru-g3" cx="50%" cy="5%" r="40%"><stop offset="0%" stopColor="#34d399" stopOpacity="0.3"/><stop offset="100%" stopColor="#34d399" stopOpacity="0"/></radialGradient>
        </defs>
        <rect width="1440" height="900" fill="url(#gru-g1)"/>
        <rect width="1440" height="900" fill="url(#gru-g2)"/>
        <rect width="1440" height="900" fill="url(#gru-g3)"/>
        <circle cx="150" cy="200" r="200" fill="none" stroke="#059669" strokeWidth="1" strokeOpacity="0.22"/>
        <circle cx="1300" cy="650" r="240" fill="none" stroke="#10b981" strokeWidth="1" strokeOpacity="0.18"/>
        <circle cx="700" cy="60" r="130" fill="none" stroke="#059669" strokeWidth="0.8" strokeOpacity="0.18"/>
        <line x1="0" y1="250" x2="550" y2="80" stroke="#059669" strokeWidth="0.7" strokeOpacity="0.17"/>
        <line x1="850" y1="0" x2="1440" y2="380" stroke="#10b981" strokeWidth="0.7" strokeOpacity="0.14"/>
        <line x1="0" y1="720" x2="650" y2="900" stroke="#059669" strokeWidth="0.6" strokeOpacity="0.12"/>
      </svg>
      <div className="relative z-10 flex w-full">
        <GuruSidebar />
        <FullscreenButton />
        <main className="flex-1 min-w-0 p-6 lg:p-8 pt-16 lg:pt-16">
          {children}
        </main>
        <SesiTerlupaPopup />
      </div>
    </div>
  )
}
