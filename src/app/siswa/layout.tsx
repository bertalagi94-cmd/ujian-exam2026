'use client'

import { useEffect } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { SiswaSidebar } from '@/components/shared/Sidebar'

export default function SiswaLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()

  // Sembunyikan sidebar saat siswa sedang mengerjakan ujian
  const isUjian = pathname?.startsWith('/siswa/ujian')

  useEffect(() => {
    const user = localStorage.getItem('user')
    if (!user) { router.replace('/login'); return }
    const parsed = JSON.parse(user)
    if (parsed.role !== 'SISWA') router.replace('/login')
  }, [router])

  return (
    <div className="flex min-h-screen bg-surface-50">
      {!isUjian && <SiswaSidebar />}
      <main className={`flex-1 min-w-0 ${isUjian ? 'p-0' : 'p-6 lg:p-8 pt-16 lg:pt-8'}`}>
        {children}
      </main>
    </div>
  )
}
