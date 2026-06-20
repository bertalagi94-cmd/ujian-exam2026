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
    <div className="flex min-h-screen bg-surface-50">
      <GuruSidebar />
      <FullscreenButton />
      <main className="flex-1 min-w-0 p-6 lg:p-8 pt-16 lg:pt-8">
        {children}
      </main>
      <SesiTerlupaPopup />
    </div>
  )
}
