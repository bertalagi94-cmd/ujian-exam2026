'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { BkSidebar } from '@/components/shared/Sidebar'
import { TopBarControls } from '@/components/shared/TopBarControls'
import { ViewAsBanner } from '@/components/shared/ViewAsBanner'
import { DashboardPhotoBackground } from '@/components/shared/DashboardPhotoBackground'

// Layout khusus Guru BK (role 'BK'). Pemeriksaan di sini hanya untuk tampilan;
// pembatasan data yang sebenarnya ada di tiap endpoint /api/bk/* (requireRoleAktif
// + getBkScope), jadi memanipulasi localStorage tidak membuka data apa pun.
export default function BkLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  useEffect(() => {
    const user = localStorage.getItem('user')
    if (!user) { router.replace('/login'); return }
    if (JSON.parse(user).role !== 'BK') router.replace('/login')
  }, [router])
  return (
    <div className="flex min-h-screen" style={{
      background: 'linear-gradient(135deg, #fce7f3 0%, #fdf2f8 35%, #fff1f2 70%, #fdf2f8 100%)',
    }}>
      <ViewAsBanner />
      <DashboardPhotoBackground tint="#db2777" />
      {/* Hiasan SVG statis — tanpa JS, tanpa biaya server */}
      <svg aria-hidden="true" className="pointer-events-none fixed inset-0 w-full h-full" style={{ zIndex: 0, opacity: 0.5 }}
        viewBox="0 0 1440 900" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <radialGradient id="bk-g1" cx="18%" cy="20%" r="60%"><stop offset="0%" stopColor="#db2777" stopOpacity="0.4"/><stop offset="100%" stopColor="#db2777" stopOpacity="0"/></radialGradient>
          <radialGradient id="bk-g2" cx="84%" cy="74%" r="55%"><stop offset="0%" stopColor="#f472b6" stopOpacity="0.38"/><stop offset="100%" stopColor="#f472b6" stopOpacity="0"/></radialGradient>
        </defs>
        <rect width="1440" height="900" fill="url(#bk-g1)"/>
        <rect width="1440" height="900" fill="url(#bk-g2)"/>
        <circle cx="200" cy="190" r="260" fill="none" stroke="#db2777" strokeWidth="1.4" strokeOpacity="0.28"/>
        <circle cx="200" cy="190" r="180" fill="none" stroke="#db2777" strokeWidth="1.1" strokeOpacity="0.22"/>
        <circle cx="200" cy="190" r="100" fill="none" stroke="#ec4899" strokeWidth="1" strokeOpacity="0.18"/>
        <polygon points="1080,560 1260,500 1400,610 1380,790 1190,860 1040,760 1020,650"
          fill="#db2777" fillOpacity="0.08" stroke="#db2777" strokeWidth="1.3" strokeOpacity="0.26"/>
        <line x1="0" y1="300" x2="560" y2="80" stroke="#db2777" strokeWidth="0.9" strokeOpacity="0.18"/>
        <line x1="900" y1="0" x2="1440" y2="380" stroke="#ec4899" strokeWidth="0.9" strokeOpacity="0.16"/>
      </svg>
      <div className="relative z-10 flex w-full">
        <BkSidebar />
        <TopBarControls accent="#db2777" />
        <main className="flex-1 min-w-0 p-6 lg:p-8 pt-16 lg:pt-16">{children}</main>
      </div>
    </div>
  )
}
