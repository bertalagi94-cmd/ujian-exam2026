'use client'

// FIX (konsolidasi menu): "Koreksi Essay" sudah digabung jadi tab "Periksa
// Jawaban Essay" di menu Penilaian (/guru/penilaian). Redirect di sini
// supaya link/bookmark lama tidak 404 — pola sama seperti redirect
// /guru/soal → /guru/paket.
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Spinner } from '@/components/ui'

export default function GuruKoreksiEssayRedirect() {
  const router = useRouter()

  useEffect(() => {
    router.replace('/guru/penilaian?tab=periksa')
  }, [router])

  return (
    <div className="flex justify-center py-20">
      <Spinner size="lg" />
    </div>
  )
}
