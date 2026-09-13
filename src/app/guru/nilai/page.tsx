'use client'

// FIX (konsolidasi menu): "Rekap Nilai" sudah digabung jadi tab "Rekap
// Nilai" di menu Penilaian (/guru/penilaian). Redirect di sini supaya
// link/bookmark lama tidak 404 — pola sama seperti redirect
// /guru/soal → /guru/paket.
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Spinner } from '@/components/ui'

export default function GuruNilaiRedirect() {
  const router = useRouter()

  useEffect(() => {
    router.replace('/guru/penilaian?tab=rekap')
  }, [router])

  return (
    <div className="flex justify-center py-20">
      <Spinner size="lg" />
    </div>
  )
}
