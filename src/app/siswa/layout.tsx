'use client'

import { useEffect } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { SiswaSidebar } from '@/components/shared/Sidebar'
import { ViewAsBanner } from '@/components/shared/ViewAsBanner'
import { DipantauBanner } from '@/components/shared/DipantauBanner'
// FIX (belum ada antrean "ujian belum terkirim" yang permanen — temuan #2):
// penjaga outbox dipasang di SINI (bukan di halaman ujian) supaya retry
// pengiriman paket tertunda tetap jalan selama siswa berada di area /siswa
// manapun (beranda, nilai, dst), bukan cuma persis saat berada di halaman
// ujian. Lihat src/lib/ujian-outbox.ts untuk detail siklus statusnya.
import { mulaiPenjagaOutbox } from '@/lib/ujian-outbox'

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

  useEffect(() => {
    let nis: string | undefined
    try { nis = JSON.parse(localStorage.getItem('user') ?? '{}').nis } catch { /* abaikan */ }
    if (!nis) return
    return mulaiPenjagaOutbox(nis)
  }, [])

  return (
    <div className="flex min-h-screen bg-surface-50">
      <ViewAsBanner />
      <DipantauBanner />
      {!isUjian && <SiswaSidebar />}
      <main className={`flex-1 min-w-0 ${isUjian ? 'p-0' : 'p-6 lg:p-8 pt-16 lg:pt-8'}`}>
        {children}
      </main>
    </div>
  )
}
