'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { AdminSidebar } from '@/components/shared/Sidebar'

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
    <div className="flex min-h-screen bg-surface-50">
      <AdminSidebar />
      <main className="flex-1 min-w-0 p-6 lg:p-8 pt-16 lg:pt-8">
        {children}
      </main>
    </div>
  )
}
