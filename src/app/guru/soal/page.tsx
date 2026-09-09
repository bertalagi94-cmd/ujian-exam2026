'use client'

// FIX (konsolidasi menu): halaman "Bank Soal" (PG) sudah digabung ke menu
// "Buat Soal" (/guru/paket) supaya guru cuma perlu satu tempat untuk
// membuat, mengedit, mengirim, menarik, dan menduplikasi paket soal —
// baik PG maupun Essay. Redirect di sini supaya link/bookmark lama tidak 404.
// Pola sama persis seperti redirect /guru/soal-essay sebelumnya.
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Spinner } from '@/components/ui'

export default function GuruBankSoalRedirect() {
  const router = useRouter()

  useEffect(() => {
    router.replace('/guru/paket')
  }, [router])

  return (
    <div className="flex justify-center py-20">
      <Spinner size="lg" />
    </div>
  )
}
