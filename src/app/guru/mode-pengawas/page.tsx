'use client'

// FIX (konsolidasi menu): "Mode Pengawas" sudah digabung jadi tab "Mode
// Pengawas" di menu "Jadwal Mengawas Saya" (/guru/jadwal-pengawasan).
// Redirect di sini supaya link/bookmark lama tidak 404 — pola sama seperti
// /guru/nilai → /guru/penilaian?tab=rekap.
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Spinner } from '@/components/ui'

export default function ModePengawasRedirect() {
  const router = useRouter()

  useEffect(() => {
    router.replace('/guru/jadwal-pengawasan?tab=mode')
  }, [router])

  return (
    <div className="flex justify-center py-20">
      <Spinner size="lg" />
    </div>
  )
}
