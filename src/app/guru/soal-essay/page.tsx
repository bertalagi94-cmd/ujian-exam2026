'use client'

// Halaman lama "Soal Essay" (berbasis pengaturan per-jadwal) sudah digantikan
// oleh alur "Buat Soal" → kartu "Soal Essay" yang berbasis paket_essay per
// mapel+kelas, sama seperti soal PG. Lihat src/app/guru/paket/page.tsx.
// Redirect di sini supaya link/bookmark lama tidak 404.
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Spinner } from '@/components/ui'

export default function GuruSoalEssayRedirect() {
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
