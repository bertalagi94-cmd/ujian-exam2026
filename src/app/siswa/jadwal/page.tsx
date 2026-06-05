'use client'

import { useState, useEffect, useCallback } from 'react'
import { Calendar, Clock } from 'lucide-react'
import { PageLoader, EmptyState, StatusBadge } from '@/components/ui'
import { apiRequest, formatDate } from '@/lib/utils'
import { Jadwal } from '@/types'

export default function SiswaJadwalPage() {
  const [jadwal, setJadwal] = useState<Jadwal[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    try {
      const res = await apiRequest<{ data: Jadwal[] }>('/api/siswa/jadwal')
      setJadwal(res.data)
    } finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  if (loading) return <PageLoader />

  const today = new Date().toISOString().slice(0, 10)
  // BUG FIX: Pisahkan hari ini, mendatang (besok dst), dan sudah lewat
  const hariIni   = jadwal.filter(j => j.tanggal === today)
  const mendatang = jadwal.filter(j => j.tanggal > today)
  const lewat     = jadwal.filter(j => j.tanggal < today)

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
                {hariIni.map(j => (
                  <div key={j.id} className="card py-4 flex items-center gap-4 border-l-4 border-brand-500">
                    <div className="w-12 h-12 bg-brand-50 rounded-xl flex flex-col items-center justify-center flex-shrink-0">
                      <span className="text-brand-700 font-bold text-lg leading-tight">
                        {new Date(j.tanggal).getDate()}
                      </span>
                      <span className="text-brand-400 text-xs leading-tight">
                        {new Date(j.tanggal).toLocaleDateString('id-ID', { month: 'short' })}
                      </span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold text-slate-900">{j.nama_mapel}</div>
                      <div className="flex items-center gap-3 text-sm text-slate-500 mt-0.5">
                        <span className="flex items-center gap-1">
                          <Clock className="w-3.5 h-3.5" />
                          {j.jam_mulai} – {j.jam_selesai}
                        </span>
                        <span>·</span>
                        <span>{j.durasi} menit</span>
                        <span>·</span>
                        <span>Sesi {j.sesi}</span>
                      </div>
                    </div>
                    <StatusBadge status={j.status} />
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Jadwal Mendatang (besok dan seterusnya) */}
          {mendatang.length > 0 && (
            <div>
              <h2 className="font-semibold text-slate-700 mb-3 text-sm uppercase tracking-wide">Mendatang</h2>
              <div className="space-y-2">
                {mendatang.map(j => (
                  <div key={j.id} className="card py-4 flex items-center gap-4">
                    <div className="w-12 h-12 bg-brand-50 rounded-xl flex flex-col items-center justify-center flex-shrink-0">
                      <span className="text-brand-700 font-bold text-lg leading-tight">
                        {new Date(j.tanggal).getDate()}
                      </span>
                      <span className="text-brand-400 text-xs leading-tight">
                        {new Date(j.tanggal).toLocaleDateString('id-ID', { month: 'short' })}
                      </span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold text-slate-900">{j.nama_mapel}</div>
                      <div className="flex items-center gap-3 text-sm text-slate-500 mt-0.5">
                        <span className="flex items-center gap-1">
                          <Clock className="w-3.5 h-3.5" />
                          {j.jam_mulai} – {j.jam_selesai}
                        </span>
                        <span>·</span>
                        <span>{j.durasi} menit</span>
                        <span>·</span>
                        <span>Sesi {j.sesi}</span>
                      </div>
                    </div>
                    <StatusBadge status={j.status} />
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Jadwal Sudah Lewat */}
          {lewat.length > 0 && (
            <div>
              <h2 className="font-semibold text-slate-400 mb-3 text-sm uppercase tracking-wide">Sudah Lewat</h2>
              <div className="space-y-2 opacity-60">
                {lewat.slice(0, 10).map(j => (
                  <div key={j.id} className="card py-3 flex items-center gap-4">
                    <div className="w-10 h-10 bg-slate-100 rounded-xl flex flex-col items-center justify-center flex-shrink-0">
                      <span className="text-slate-500 font-bold text-sm">{new Date(j.tanggal).getDate()}</span>
                      <span className="text-slate-400 text-[10px]">{new Date(j.tanggal).toLocaleDateString('id-ID', { month: 'short' })}</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-slate-700">{j.nama_mapel}</div>
                      <div className="text-xs text-slate-400">{j.jam_mulai} – {j.jam_selesai}</div>
                    </div>
                    <StatusBadge status={j.status} />
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
