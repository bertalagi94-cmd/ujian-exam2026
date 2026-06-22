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
    <div className="flex min-h-screen bg-surface-50">
      <AdminSidebar />
      <FullscreenButton />
      {/* FIX: pt-16 di semua breakpoint — sebelumnya "pt-16 lg:pt-8" bikin tombol
          di header halaman (mis. "Tambah Pengguna") bertabrakan dengan FullscreenButton
          yang fixed top-4 right-4 (z-30) */}
      <main className="flex-1 min-w-0 p-6 lg:p-8 pt-16">
        {children}
      </main>
    </div>
  )
}
