'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { Calendar, Clock, CheckCircle2, AlertTriangle, BookOpen } from 'lucide-react'
import { PageLoader, EmptyState } from '@/components/ui'
import { apiRequest } from '@/lib/utils'
import { Jadwal } from '@/types'

function StatusJadwalSiswa({ j }: { j: Jadwal }) {
  // Sudah mengikuti ujian ini
  if (j.sudah_ikut) {
    return (
      <div className="flex flex-row sm:flex-col items-center sm:items-end gap-2 sm:gap-1 flex-wrap">
        <span className="badge badge-green flex items-center gap-1">
          <CheckCircle2 className="w-3.5 h-3.5 flex-shrink-0" /> Sudah Mengikuti
        </span>
        {j.nilai_id && (
          <Link href={`/siswa/nilai/${j.nilai_id}`} className="text-xs font-medium text-brand-600 hover:underline whitespace-nowrap">
            Lihat nilai →
          </Link>
        )}
      </div>
    )
  }

  // Sesi sedang berlangsung, siswa belum masuk
  if (j.status === 'BERJALAN') {
    return (
      <span className="badge badge-blue flex items-center gap-1 whitespace-nowrap">
        <BookOpen className="w-3.5 h-3.5 flex-shrink-0" /> Sedang Berlangsung
      </span>
    )
  }

  // Sesi sudah ditutup, siswa tidak sempat ikut
  if (j.status === 'SELESAI') {
    return (
      <span className="badge badge-red flex items-center gap-1 whitespace-nowrap">
        <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" /> Tidak Sempat Ikut
      </span>
    )
  }

  // Jadwal aktif (belum waktunya / belum dibuka pengawas)
  if (j.status === 'AKTIF') {
    return (
      <span className="badge badge-slate flex items-center gap-1 whitespace-nowrap">
        <Clock className="w-3.5 h-3.5 flex-shrink-0" /> Terjadwal
      </span>
    )
  }

  // Fallback untuk status lain yang tidak terduga
  return <span className="badge badge-slate">{j.status}</span>
}

export default function SiswaJadwalPage() {
  const [jadwal, setJadwal] = useState<Jadwal[]>([])
  const [loading, setLoading] = useState(true)
  const [zonaWaktu, setZonaWaktu] = useState<{ utcOffsetJam: number; label: string }>({ utcOffsetJam: 7, label: 'WIB (UTC+7)' })

  const load = useCallback(async () => {
    try {
      const res = await apiRequest<{ data: Jadwal[]; zonaWaktu?: { utcOffsetJam: number; label: string } }>('/api/siswa/jadwal')
      setJadwal(res.data)
      if (res.zonaWaktu) setZonaWaktu(res.zonaWaktu)
    } finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  if (loading) return <PageLoader />

  // Tanggal "hari ini" pada zona waktu sekolah — bukan UTC.
  const today = (() => {
    const shifted = new Date(Date.now() + zonaWaktu.utcOffsetJam * 60 * 60 * 1000)
    return shifted.toISOString().slice(0, 10)
  })()

  const hariIni   = jadwal.filter(j => j.tanggal === today)
  const mendatang = jadwal.filter(j => j.tanggal > today)
  const lewat     = jadwal.filter(j => j.tanggal < today)

  // Card jadwal — dipakai ulang di semua seksi
  function JadwalCard({ j, compact = false }: { j: Jadwal; compact?: boolean }) {
    const tanggalDate = new Date(j.tanggal)
    const tidakSempatIkut = !j.sudah_ikut && j.status === 'SELESAI'

    return (
      <div className={`card flex flex-col sm:flex-row sm:items-center gap-3 ${
        compact ? 'py-3' : 'py-4'
      } ${
        j.tanggal === today && j.status !== 'SELESAI' ? 'border-l-4 border-brand-500' : ''
      } ${
        tidakSempatIkut ? 'opacity-60' : ''
      }`}>
        <div className="flex items-center gap-4 flex-1 min-w-0">
          <div className={`${compact ? 'w-10 h-10' : 'w-12 h-12'} ${
            tidakSempatIkut ? 'bg-slate-100' : j.tanggal === today ? 'bg-brand-50' : 'bg-brand-50'
          } rounded-xl flex flex-col items-center justify-center flex-shrink-0`}>
            <span className={`font-bold leading-tight ${compact ? 'text-sm text-slate-500' : 'text-lg text-brand-700'}`}>
              {tanggalDate.getDate()}
            </span>
            <span className={`text-xs leading-tight ${compact ? 'text-slate-400 text-[10px]' : 'text-brand-400'}`}>
              {tanggalDate.toLocaleDateString('id-ID', { month: 'short' })}
            </span>
          </div>
          <div className="flex-1 min-w-0">
            <div className={`font-${compact ? 'medium' : 'semibold'} text-slate-${compact ? '700' : '900'}`}>
              {j.nama_mapel}
            </div>
            <div className={`flex flex-wrap items-center gap-x-2 gap-y-0.5 text-slate-${compact ? '400' : '500'} mt-0.5 ${compact ? 'text-xs' : 'text-sm'}`}>
              <span className="flex items-center gap-1">
                <Clock className={compact ? 'w-3 h-3' : 'w-3.5 h-3.5'} />
                {j.jam_mulai} – {j.jam_selesai}
              </span>
              {!compact && (
                <>
                  <span>·</span>
                  <span>{j.durasi} menit</span>
                  <span>·</span>
                  <span>Sesi {j.sesi}</span>
                </>
              )}
            </div>
          </div>
        </div>
        <div className="sm:flex-shrink-0">
          <StatusJadwalSiswa j={j} />
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="page-title">Jadwal Ujian</h1>
        <p className="page-subtitle">Jadwal ujian untuk kelas Anda</p>
      </div>

      {jadwal.length === 0 ? (
        <div className="card"><EmptyState message="Tidak ada jadwal ujian" icon={Calendar} /></div>
      ) : (
        <>
          {/* Jadwal Hari Ini */}
          {hariIni.length > 0 && (
            <div>
              <h2 className="font-semibold text-brand-600 mb-3 text-sm uppercase tracking-wide">Hari Ini</h2>
              <div className="space-y-2">
                {hariIni.map(j => <JadwalCard key={j.id} j={j} />)}
              </div>
            </div>
          )}

          {/* Jadwal Mendatang */}
          {mendatang.length > 0 && (
            <div>
              <h2 className="font-semibold text-slate-700 mb-3 text-sm uppercase tracking-wide">Mendatang</h2>
              <div className="space-y-2">
                {mendatang.map(j => <JadwalCard key={j.id} j={j} />)}
              </div>
            </div>
          )}

          {/* Jadwal Sudah Lewat */}
          {lewat.length > 0 && (
            <div>
              <h2 className="font-semibold text-slate-400 mb-3 text-sm uppercase tracking-wide">Sudah Lewat</h2>
              <div className="space-y-2">
                {lewat.slice(0, 10).map(j => <JadwalCard key={j.id} j={j} compact />)}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
