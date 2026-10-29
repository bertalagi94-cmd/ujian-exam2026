'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ValidasiSoalView, API_VALIDASI_ADMIN_KELAS } from '@/components/shared/ValidasiSoalView'
import { Spinner } from '@/components/ui'
import { apiRequest } from '@/lib/utils'

// Menu Admin Kelas: hanya guru yang ditunjuk Super Admin. Server tetap
// memeriksa penugasan di setiap request; pengecekan di sini hanya untuk UX.
export default function AdminKelasPage() {
  const router = useRouter()
  const [kelas, setKelas] = useState<{ id: string; nama: string }[] | null>(null)

  useEffect(() => {
    apiRequest<{ isAdminKelas: boolean; kelas: { id: string; nama: string }[] }>('/api/guru/admin-kelas/saya')
      .then(r => (r.isAdminKelas ? setKelas(r.kelas) : router.replace('/guru')))
      .catch(() => router.replace('/guru'))
  }, [router])

  if (!kelas) return <div className="flex justify-center py-20"><Spinner /></div>

  return (
    <ValidasiSoalView
      api={API_VALIDASI_ADMIN_KELAS}
      judul="Admin Kelas"
      subjudul="Validasi paket soal untuk kelas yang menjadi tanggung jawab Anda"
      info={
        <div className="flex flex-wrap gap-1.5 mt-2">
          {kelas.map(k => (
            <span key={k.id} className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 text-xs font-medium">
              Kelas {k.nama}
            </span>
          ))}
        </div>
      }
    />
  )
}
