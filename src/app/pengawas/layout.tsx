'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { PengawasSidebar } from '@/components/shared/Sidebar'

export default function PengawasLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  useEffect(() => {
    const user = localStorage.getItem('user')
    if (!user) { router.replace('/login'); return }
    if (!['PENGAWAS', 'GURU_KEPSEK'].includes(JSON.parse(user).role)) router.replace('/login')
  }, [router])
  return (
    <div className="flex min-h-screen bg-surface-50">
      <PengawasSidebar />
      <main className="flex-1 min-w-0 p-6 lg:p-8 pt-16 lg:pt-8">{children}</main>
    </div>
  )
}
