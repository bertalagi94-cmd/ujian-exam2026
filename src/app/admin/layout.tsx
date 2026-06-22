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
      {/* FIX v2: pt-16 lg:pt-16 — sebelumnya cuma "pt-16" tanpa varian lg:, dan
          ternyata KALAH cascade dari "lg:p-8" karena Tailwind mengelompokkan semua
          utility ber-breakpoint (lg:) di blok @media terpisah di AKHIR file CSS,
          jadi lg:p-8 selalu menang di atas pt-16 tanpa prefix, walau pt-16 ditulis
          belakangan di className. Sekarang lg:pt-16 ada di blok @media yang sama
          dengan lg:p-8 dan ditulis setelahnya → menang juga di layar besar. */}
      <main className="flex-1 min-w-0 p-6 lg:p-8 pt-16 lg:pt-16">
        {children}
      </main>
    </div>
  )
}
