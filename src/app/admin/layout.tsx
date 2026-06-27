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
      background: 'linear-gradient(135deg, #cffafe 0%, #e0f7fa 35%, #f0f9ff 70%, #ecfeff 100%)',
    }}>
      {/* Decorative SVG mesh — pure SVG, zero JS, zero server cost */}
      <svg aria-hidden="true" className="pointer-events-none fixed inset-0 w-full h-full" style={{ zIndex: 0, opacity: 0.5 }}
        viewBox="0 0 1440 900" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <radialGradient id="adm-g1" cx="18%" cy="18%" r="60%"><stop offset="0%" stopColor="#0891b2" stopOpacity="0.5"/><stop offset="100%" stopColor="#0891b2" stopOpacity="0"/></radialGradient>
          <radialGradient id="adm-g2" cx="85%" cy="80%" r="55%"><stop offset="0%" stopColor="#06b6d4" stopOpacity="0.42"/><stop offset="100%" stopColor="#06b6d4" stopOpacity="0"/></radialGradient>
          <radialGradient id="adm-g3" cx="55%" cy="6%" r="45%"><stop offset="0%" stopColor="#22d3ee" stopOpacity="0.3"/><stop offset="100%" stopColor="#22d3ee" stopOpacity="0"/></radialGradient>
        </defs>
        <rect width="1440" height="900" fill="url(#adm-g1)"/>
        <rect width="1440" height="900" fill="url(#adm-g2)"/>
        <rect width="1440" height="900" fill="url(#adm-g3)"/>

        {/* Concentric circles, top-left */}
        <circle cx="180" cy="160" r="230" fill="none" stroke="#0891b2" strokeWidth="1.4" strokeOpacity="0.3"/>
        <circle cx="180" cy="160" r="150" fill="none" stroke="#0891b2" strokeWidth="1.1" strokeOpacity="0.24"/>
        <circle cx="180" cy="160" r="80" fill="none" stroke="#06b6d4" strokeWidth="1" strokeOpacity="0.2"/>

        {/* Large bottom-right circle */}
        <circle cx="1290" cy="730" r="260" fill="none" stroke="#06b6d4" strokeWidth="1.3" strokeOpacity="0.28"/>
        <circle cx="1290" cy="730" r="180" fill="none" stroke="#06b6d4" strokeWidth="1" strokeOpacity="0.18"/>

        {/* Pentagon — top-right */}
        <polygon points="1180,40 1280,100 1250,210 1110,210 1080,100"
          fill="#0891b2" fillOpacity="0.1" stroke="#0891b2" strokeWidth="1.2" strokeOpacity="0.35"/>
        <polygon points="1180,75 1250,118 1228,195 1132,195 1110,118"
          fill="none" stroke="#0891b2" strokeWidth="0.8" strokeOpacity="0.22"/>

        {/* Hexagon — mid-left, filled */}
        <polygon points="120,480 200,440 280,480 280,560 200,600 120,560"
          fill="#22d3ee" fillOpacity="0.16" stroke="#0891b2" strokeWidth="1" strokeOpacity="0.3"/>

        {/* Hexagon outline — center-bottom */}
        <polygon points="640,720 740,665 840,720 840,830 740,885 640,830"
          fill="none" stroke="#06b6d4" strokeWidth="1.1" strokeOpacity="0.26"/>

        {/* Tilted squares */}
        <rect x="950" y="160" width="90" height="90" fill="#0891b2" fillOpacity="0.08" stroke="#0891b2" strokeWidth="1" strokeOpacity="0.28" transform="rotate(18 995 205)"/>
        <rect x="380" y="60" width="60" height="60" fill="none" stroke="#22d3ee" strokeWidth="1" strokeOpacity="0.24" transform="rotate(-12 410 90)"/>

        {/* Diagonal line bundles */}
        <line x1="0" y1="340" x2="560" y2="90" stroke="#0891b2" strokeWidth="0.9" strokeOpacity="0.22"/>
        <line x1="0" y1="390" x2="600" y2="140" stroke="#0891b2" strokeWidth="0.7" strokeOpacity="0.15"/>
        <line x1="880" y1="0" x2="1440" y2="430" stroke="#06b6d4" strokeWidth="0.9" strokeOpacity="0.2"/>
        <line x1="930" y1="0" x2="1440" y2="380" stroke="#06b6d4" strokeWidth="0.7" strokeOpacity="0.14"/>
        <line x1="0" y1="760" x2="640" y2="900" stroke="#0891b2" strokeWidth="0.8" strokeOpacity="0.17"/>

        {/* Arcs */}
        <path d="M 1000 900 A 380 380 0 0 1 1440 520" fill="none" stroke="#06b6d4" strokeWidth="1" strokeOpacity="0.2"/>
        <path d="M 0 60 A 300 300 0 0 1 300 0" fill="none" stroke="#0891b2" strokeWidth="0.9" strokeOpacity="0.18"/>

        {/* Dot cluster */}
        <g fill="#0891b2" fillOpacity="0.3">
          <circle cx="500" cy="500" r="4"/><circle cx="525" cy="490" r="4"/><circle cx="550" cy="510" r="4"/>
          <circle cx="510" cy="525" r="4"/><circle cx="540" cy="535" r="4"/><circle cx="480" cy="515" r="4"/>
          <circle cx="565" cy="495" r="4"/><circle cx="495" cy="545" r="4"/>
        </g>
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
