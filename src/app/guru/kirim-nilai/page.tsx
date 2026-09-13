'use client'

// FIX (konsolidasi menu): "Kirim Nilai ke Wali Kelas" sudah digabung jadi
// tab "Kirim Nilai ke Wali Kelas" di menu Penilaian (/guru/penilaian).
// Redirect di sini supaya link/bookmark lama tidak 404 — pola sama seperti
// redirect /guru/soal → /guru/paket.
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Spinner } from '@/components/ui'

export default function GuruKirimNilaiRedirect() {
  const router = useRouter()

  useEffect(() => {
    router.replace('/guru/penilaian?tab=kirim')
  }, [router])

  return (
    <div className="flex justify-center py-20">
      <Spinner size="lg" />
    </div>
  )
}
