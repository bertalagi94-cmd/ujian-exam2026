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
      background: 'linear-gradient(135deg, #d1fae5 0%, #ecfdf5 35%, #f0fdf4 70%, #ecfdf5 100%)',
    }}>
      {/* Decorative SVG mesh — pure SVG, zero JS, zero server cost */}
      <svg aria-hidden="true" className="pointer-events-none fixed inset-0 w-full h-full" style={{ zIndex: 0, opacity: 0.5 }}
        viewBox="0 0 1440 900" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <radialGradient id="gru-g1" cx="15%" cy="22%" r="60%"><stop offset="0%" stopColor="#059669" stopOpacity="0.48"/><stop offset="100%" stopColor="#059669" stopOpacity="0"/></radialGradient>
          <radialGradient id="gru-g2" cx="86%" cy="76%" r="55%"><stop offset="0%" stopColor="#10b981" stopOpacity="0.42"/><stop offset="100%" stopColor="#10b981" stopOpacity="0"/></radialGradient>
          <radialGradient id="gru-g3" cx="50%" cy="4%" r="45%"><stop offset="0%" stopColor="#34d399" stopOpacity="0.3"/><stop offset="100%" stopColor="#34d399" stopOpacity="0"/></radialGradient>
        </defs>
        <rect width="1440" height="900" fill="url(#gru-g1)"/>
        <rect width="1440" height="900" fill="url(#gru-g2)"/>
        <rect width="1440" height="900" fill="url(#gru-g3)"/>

        {/* Tilted squares cluster — top-left */}
        <rect x="90" y="90" width="130" height="130" fill="#059669" fillOpacity="0.1" stroke="#059669" strokeWidth="1.2" strokeOpacity="0.32" transform="rotate(20 155 155)"/>
        <rect x="130" y="140" width="70" height="70" fill="none" stroke="#10b981" strokeWidth="0.9" strokeOpacity="0.24" transform="rotate(-15 165 175)"/>

        {/* Large concentric circles bottom-right */}
        <circle cx="1300" cy="720" r="260" fill="none" stroke="#10b981" strokeWidth="1.3" strokeOpacity="0.28"/>
        <circle cx="1300" cy="720" r="170" fill="none" stroke="#059669" strokeWidth="1" strokeOpacity="0.2"/>

        {/* Hexagon filled — top-right */}
        <polygon points="1150,60 1240,30 1320,80 1320,170 1240,210 1150,170"
          fill="#34d399" fillOpacity="0.16" stroke="#059669" strokeWidth="1.1" strokeOpacity="0.32"/>

        {/* Hexagon outline — mid-left */}
        <polygon points="80,500 170,455 260,500 260,590 170,635 80,590"
          fill="none" stroke="#10b981" strokeWidth="1" strokeOpacity="0.24"/>

        {/* Small rotated diamond cluster center */}
        <rect x="650" y="700" width="80" height="80" fill="#059669" fillOpacity="0.08" stroke="#059669" strokeWidth="1" strokeOpacity="0.26" transform="rotate(45 690 740)"/>

        {/* Diagonal lines */}
        <line x1="0" y1="280" x2="540" y2="60" stroke="#059669" strokeWidth="0.9" strokeOpacity="0.2"/>
        <line x1="0" y1="330" x2="580" y2="110" stroke="#059669" strokeWidth="0.7" strokeOpacity="0.14"/>
        <line x1="860" y1="0" x2="1440" y2="410" stroke="#10b981" strokeWidth="0.9" strokeOpacity="0.18"/>
        <line x1="0" y1="740" x2="660" y2="900" stroke="#059669" strokeWidth="0.8" strokeOpacity="0.16"/>

        {/* Arcs */}
        <path d="M 960 900 A 360 360 0 0 1 1380 540" fill="none" stroke="#10b981" strokeWidth="1" strokeOpacity="0.2"/>
        <path d="M 0 50 A 280 280 0 0 1 280 0" fill="none" stroke="#059669" strokeWidth="0.9" strokeOpacity="0.18"/>

        {/* Dot cluster */}
        <g fill="#059669" fillOpacity="0.3">
          <circle cx="950" cy="280" r="4"/><circle cx="975" cy="270" r="4"/><circle cx="1000" cy="290" r="4"/>
          <circle cx="960" cy="305" r="4"/><circle cx="990" cy="315" r="4"/><circle cx="930" cy="295" r="4"/>
          <circle cx="1015" cy="275" r="4"/><circle cx="945" cy="325" r="4"/>
        </g>
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
