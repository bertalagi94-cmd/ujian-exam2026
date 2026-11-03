'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ClipboardCheck, KeyRound, ListChecks } from 'lucide-react'
import { ValidasiSoalView, API_VALIDASI_ADMIN_KELAS } from '@/components/shared/ValidasiSoalView'
import { Spinner } from '@/components/ui'
import { apiRequest, cn } from '@/lib/utils'
import { KesiapanTab } from './tabs/KesiapanTab'
import { ResetPasswordTab } from './tabs/ResetPasswordTab'

type TabKey = 'validasi' | 'kesiapan' | 'reset'

const TABS: { key: TabKey; label: string; icon: React.ElementType }[] = [
  { key: 'validasi', label: 'Validasi Soal', icon: ClipboardCheck },
  { key: 'kesiapan', label: 'Kesiapan Ujian', icon: ListChecks },
  { key: 'reset', label: 'Reset Password Siswa', icon: KeyRound },
]

// Menu Admin Kelas: hanya guru yang ditunjuk Super Admin. Server tetap
// memeriksa penugasan di setiap request; pengecekan di sini hanya untuk UX.
//
// Tiga tab, semuanya dibatasi ke kelas wilayah di server:
//   1. Validasi Soal       - menyetujui/menolak paket soal kelas saya.
//   2. Kesiapan Ujian      - papan hanya-baca: status soal & jadwal per mapel.
//   3. Reset Password Siswa - kembalikan password siswa kelas saya ke NISN.
// Hanya tab aktif yang di-mount, supaya tidak ada fetch tersembunyi.
export default function AdminKelasPage() {
  const router = useRouter()
  const [kelas, setKelas] = useState<{ id: string; nama: string }[] | null>(null)
  const [tab, setTab] = useState<TabKey>('validasi')

  useEffect(() => {
    apiRequest<{ isAdminKelas: boolean; kelas: { id: string; nama: string }[] }>('/api/guru/admin-kelas/saya')
      .then(r => (r.isAdminKelas ? setKelas(r.kelas) : router.replace('/guru')))
      .catch(() => router.replace('/guru'))
  }, [router])

  if (!kelas) return <div className="flex justify-center py-20"><Spinner /></div>

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="page-title">Admin Kelas</h1>
        <p className="page-subtitle">Kelola validasi soal, kesiapan ujian, dan akun siswa untuk kelas yang menjadi tanggung jawab Anda</p>
        <div className="flex flex-wrap gap-1.5 mt-2">
          {kelas.map(k => (
            <span key={k.id} className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 text-xs font-medium">
              Kelas {k.nama}
            </span>
          ))}
        </div>
      </div>

      <div className="flex gap-1 bg-slate-100 p-1 rounded-xl w-fit max-w-full overflow-x-auto" role="tablist">
        {TABS.map(t => {
          const Icon = t.icon
          const aktif = tab === t.key
          return (
            <button
              key={t.key}
              role="tab"
              aria-selected={aktif}
              onClick={() => setTab(t.key)}
              className={cn(
                'inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-all',
                aktif ? 'bg-white shadow-card text-slate-900' : 'text-slate-500 hover:text-slate-700'
              )}
            >
              <Icon className="w-4 h-4" /> {t.label}
            </button>
          )
        })}
      </div>

      {tab === 'validasi' && <ValidasiSoalView api={API_VALIDASI_ADMIN_KELAS} sembunyikanJudul />}
      {tab === 'kesiapan' && <KesiapanTab onBukaValidasi={() => setTab('validasi')} />}
      {tab === 'reset' && <ResetPasswordTab />}
    </div>
  )
}
