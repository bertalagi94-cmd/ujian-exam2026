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
      background: 'linear-gradient(135deg, #ede9fe 0%, #f5f3ff 35%, #faf5ff 70%, #f5f3ff 100%)',
    }}>
      {/* Decorative SVG mesh — pure SVG, zero JS, zero server cost */}
      <svg aria-hidden="true" className="pointer-events-none fixed inset-0 w-full h-full" style={{ zIndex: 0, opacity: 0.5 }}
        viewBox="0 0 1440 900" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <radialGradient id="kps-g1" cx="18%" cy="20%" r="60%"><stop offset="0%" stopColor="#7c3aed" stopOpacity="0.48"/><stop offset="100%" stopColor="#7c3aed" stopOpacity="0"/></radialGradient>
          <radialGradient id="kps-g2" cx="84%" cy="74%" r="55%"><stop offset="0%" stopColor="#8b5cf6" stopOpacity="0.42"/><stop offset="100%" stopColor="#8b5cf6" stopOpacity="0"/></radialGradient>
          <radialGradient id="kps-g3" cx="52%" cy="6%" r="45%"><stop offset="0%" stopColor="#a78bfa" stopOpacity="0.3"/><stop offset="100%" stopColor="#a78bfa" stopOpacity="0"/></radialGradient>
        </defs>
        <rect width="1440" height="900" fill="url(#kps-g1)"/>
        <rect width="1440" height="900" fill="url(#kps-g2)"/>
        <rect width="1440" height="900" fill="url(#kps-g3)"/>

        {/* Big concentric circles — top-left, signature element */}
        <circle cx="200" cy="190" r="260" fill="none" stroke="#7c3aed" strokeWidth="1.4" strokeOpacity="0.32"/>
        <circle cx="200" cy="190" r="180" fill="none" stroke="#7c3aed" strokeWidth="1.1" strokeOpacity="0.26"/>
        <circle cx="200" cy="190" r="100" fill="none" stroke="#8b5cf6" strokeWidth="1" strokeOpacity="0.2"/>
        <circle cx="200" cy="190" r="35" fill="#8b5cf6" fillOpacity="0.12"/>

        {/* Large polygon (irregular) — bottom-right, signature element */}
        <polygon points="1080,560 1260,500 1400,610 1380,790 1190,860 1040,760 1020,650"
          fill="#7c3aed" fillOpacity="0.09" stroke="#7c3aed" strokeWidth="1.3" strokeOpacity="0.3"/>
        <polygon points="1130,610 1250,575 1340,640 1330,760 1200,810 1090,740"
          fill="none" stroke="#8b5cf6" strokeWidth="0.9" strokeOpacity="0.22"/>

        {/* Hexagon — top-right */}
        <polygon points="1160,50 1250,20 1330,70 1330,160 1250,200 1160,160"
          fill="#a78bfa" fillOpacity="0.14" stroke="#7c3aed" strokeWidth="1" strokeOpacity="0.28"/>

        {/* Tilted square — mid */}
        <rect x="600" y="70" width="70" height="70" fill="none" stroke="#a78bfa" strokeWidth="1" strokeOpacity="0.24" transform="rotate(25 635 105)"/>

        {/* Diagonal lines */}
        <line x1="0" y1="300" x2="560" y2="80" stroke="#7c3aed" strokeWidth="0.9" strokeOpacity="0.2"/>
        <line x1="0" y1="350" x2="600" y2="130" stroke="#7c3aed" strokeWidth="0.7" strokeOpacity="0.14"/>
        <line x1="900" y1="0" x2="1440" y2="380" stroke="#8b5cf6" strokeWidth="0.9" strokeOpacity="0.18"/>
        <line x1="0" y1="780" x2="600" y2="900" stroke="#7c3aed" strokeWidth="0.8" strokeOpacity="0.16"/>

        {/* Arcs */}
        <path d="M 0 900 A 320 320 0 0 1 380 580" fill="none" stroke="#8b5cf6" strokeWidth="1" strokeOpacity="0.2"/>
        <path d="M 1100 0 A 260 260 0 0 1 1340 200" fill="none" stroke="#7c3aed" strokeWidth="0.9" strokeOpacity="0.18"/>

        {/* Dot cluster */}
        <g fill="#7c3aed" fillOpacity="0.3">
          <circle cx="560" cy="520" r="4"/><circle cx="585" cy="510" r="4"/><circle cx="610" cy="530" r="4"/>
          <circle cx="570" cy="545" r="4"/><circle cx="600" cy="555" r="4"/><circle cx="540" cy="535" r="4"/>
          <circle cx="625" cy="515" r="4"/><circle cx="555" cy="565" r="4"/>
        </g>
      </svg>
      <div className="relative z-10 flex w-full">
        <KepsekSidebar />
        <FullscreenButton />
        <main className="flex-1 min-w-0 p-6 lg:p-8 pt-16 lg:pt-16">{children}</main>
      </div>
    </div>
  )
}
