'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { KepsekSidebar } from '@/components/shared/Sidebar'
import { FullscreenButton } from '@/components/shared/FullscreenButton'

export default function KepsekLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  useEffect(() => {
    const user = localStorage.getItem('user')
    if (!user) { router.replace('/login'); return }
    if (JSON.parse(user).role !== 'KEPSEK') router.replace('/login')
  }, [router])
  return (
    <div className="flex min-h-screen" style={{
      background: 'linear-gradient(135deg, #ede9fe 0%, #f5f3ff 40%, #faf5ff 100%)',
    }}>
      {/* Subtle SVG mesh — pure CSS, zero JS, zero server cost */}
      <svg aria-hidden="true" className="pointer-events-none fixed inset-0 w-full h-full" style={{ zIndex: 0, opacity: 0.18 }}
        viewBox="0 0 1440 900" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <radialGradient id="kps-g1" cx="18%" cy="22%" r="55%"><stop offset="0%" stopColor="#7c3aed" stopOpacity="0.5"/><stop offset="100%" stopColor="#7c3aed" stopOpacity="0"/></radialGradient>
          <radialGradient id="kps-g2" cx="82%" cy="72%" r="50%"><stop offset="0%" stopColor="#8b5cf6" stopOpacity="0.45"/><stop offset="100%" stopColor="#8b5cf6" stopOpacity="0"/></radialGradient>
          <radialGradient id="kps-g3" cx="52%" cy="8%" r="40%"><stop offset="0%" stopColor="#a78bfa" stopOpacity="0.3"/><stop offset="100%" stopColor="#a78bfa" stopOpacity="0"/></radialGradient>
        </defs>
        <rect width="1440" height="900" fill="url(#kps-g1)"/>
        <rect width="1440" height="900" fill="url(#kps-g2)"/>
        <rect width="1440" height="900" fill="url(#kps-g3)"/>
        <circle cx="180" cy="180" r="190" fill="none" stroke="#7c3aed" strokeWidth="1" strokeOpacity="0.22"/>
        <circle cx="1260" cy="680" r="230" fill="none" stroke="#8b5cf6" strokeWidth="1" strokeOpacity="0.18"/>
        <circle cx="720" cy="55" r="125" fill="none" stroke="#7c3aed" strokeWidth="0.8" strokeOpacity="0.18"/>
        <line x1="0" y1="270" x2="520" y2="90" stroke="#7c3aed" strokeWidth="0.7" strokeOpacity="0.17"/>
        <line x1="870" y1="0" x2="1440" y2="360" stroke="#8b5cf6" strokeWidth="0.7" strokeOpacity="0.14"/>
        <line x1="0" y1="710" x2="670" y2="900" stroke="#7c3aed" strokeWidth="0.6" strokeOpacity="0.12"/>
      </svg>
      <div className="relative z-10 flex w-full">
        <KepsekSidebar />
        <FullscreenButton />
        <main className="flex-1 min-w-0 p-6 lg:p-8 pt-16 lg:pt-16">{children}</main>
      </div>
    </div>
  )
}
