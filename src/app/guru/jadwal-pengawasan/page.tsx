'use client'

import { useState, useEffect, useCallback } from 'react'
import { Calendar, Clock, BookOpen, Users, CheckCircle, PlayCircle, AlertCircle, RefreshCw } from 'lucide-react'
import { apiRequest, formatDate } from '@/lib/utils'
import { PageLoader } from '@/components/ui'

interface JadwalPengawasan {
  id: string
  tanggal: string
  sesi: number
  jam_mulai: string
  jam_selesai: string
  mapel_id: string
  kelas: string
  pengawas: string
  durasi: number
  status: 'AKTIF' | 'BERJALAN' | 'SELESAI'
  nama_mapel: string
  nama_kelas: string
}

const STATUS_CONFIG = {
  AKTIF:    { label: 'Akan Datang', cls: 'bg-blue-100 text-blue-700 border-blue-200',    icon: <Clock className="w-3.5 h-3.5" /> },
  BERJALAN: { label: 'Sedang Berlangsung', cls: 'bg-amber-100 text-amber-700 border-amber-200', icon: <PlayCircle className="w-3.5 h-3.5" /> },
  SELESAI:  { label: 'Selesai', cls: 'bg-emerald-100 text-emerald-700 border-emerald-200', icon: <CheckCircle className="w-3.5 h-3.5" /> },
}

function groupByMonth(list: JadwalPengawasan[]) {
  const map: Record<string, JadwalPengawasan[]> = {}
  list.forEach(j => {
    const key = j.tanggal.slice(0, 7) // YYYY-MM
    if (!map[key]) map[key] = []
    map[key].push(j)
  })
  return Object.entries(map).sort(([a], [b]) => a.localeCompare(b))
}

function isToday(dateStr: string) {
  return dateStr === new Date().toISOString().slice(0, 10)
}

function isPast(dateStr: string) {
  return dateStr < new Date().toISOString().slice(0, 10)
}

export default function JadwalPengawasanPage() {
  const [jadwal, setJadwal] = useState<JadwalPengawasan[]>([])
  const [loading, setLoading] = useState(true)
  const [hasJadwal, setHasJadwal] = useState(false)
  const [refreshing, setRefreshing] = useState(false)

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    else setRefreshing(true)
    try {
      const res = await apiRequest<{ data: JadwalPengawasan[]; hasJadwal: boolean }>('/api/guru/jadwal-pengawasan')
      setJadwal(res.data ?? [])
      setHasJadwal(res.hasJadwal ?? (res.data?.length > 0))
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  if (loading) return <PageLoader />

  const grouped = groupByMonth(jadwal)
  const upcoming = jadwal.filter(j => j.status !== 'SELESAI' && !isPast(j.tanggal))
  const total = jadwal.length
  const selesai = jadwal.filter(j => j.status === 'SELESAI').length
  const berjalan = jadwal.filter(j => j.status === 'BERJALAN').length

  return (
    <div className="space-y-8 animate-fade-in pb-10">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <div className="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center">
              <Calendar className="w-4 h-4 text-white" />
            </div>
            <span className="text-xs font-semibold text-indigo-600 uppercase tracking-wider">Jadwal Pengawasan</span>
          </div>
          <h1 className="text-2xl font-bold text-slate-900">Jadwal Mengawas Ujian</h1>
          <p className="text-slate-500 text-sm mt-0.5">Daftar seluruh jadwal ujian yang Anda awasi</p>
        </div>
        <button
          onClick={() => load(true)}
          disabled={refreshing}
          className="flex items-center gap-2 px-3 py-2 rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50 text-sm font-medium transition-colors"
        >
          <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <MiniStat bg="bg-indigo-50" icon={<Calendar className="w-5 h-5 text-indigo-600" />} label="Total Jadwal" value={total} />
        <MiniStat bg="bg-blue-50" icon={<Clock className="w-5 h-5 text-blue-600" />} label="Akan Datang" value={upcoming.length} />
        <MiniStat bg="bg-amber-50" icon={<PlayCircle className="w-5 h-5 text-amber-600" />} label="Berlangsung" value={berjalan} />
        <MiniStat bg="bg-emerald-50" icon={<CheckCircle className="w-5 h-5 text-emerald-600" />} label="Selesai" value={selesai} />
      </div>

      {/* Empty state */}
      {!hasJadwal && (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <div className="w-20 h-20 rounded-full bg-slate-100 flex items-center justify-center mb-4">
            <Calendar className="w-10 h-10 text-slate-300" />
          </div>
          <h3 className="text-lg font-semibold text-slate-600">Belum Ada Jadwal Pengawasan</h3>
          <p className="text-slate-400 text-sm mt-1">Hubungi administrator untuk penugasan pengawasan ujian.</p>
        </div>
      )}

      {/* Grouped list */}
      {grouped.map(([monthKey, items]) => {
        const monthLabel = new Date(monthKey + '-01').toLocaleDateString('id-ID', { month: 'long', year: 'numeric' })
        return (
          <section key={monthKey}>
            <div className="flex items-center gap-3 mb-4">
              <h2 className="text-sm font-bold text-slate-600 uppercase tracking-wider">{monthLabel}</h2>
              <div className="flex-1 h-px bg-slate-100" />
              <span className="text-xs text-slate-400">{items.length} jadwal</span>
            </div>

            <div className="space-y-3">
              {items.map(j => {
                const cfg = STATUS_CONFIG[j.status] ?? STATUS_CONFIG.AKTIF
                const today = isToday(j.tanggal)
                const past = isPast(j.tanggal) && j.status === 'AKTIF'
                const dayName = new Date(j.tanggal).toLocaleDateString('id-ID', { weekday: 'long' })

                return (
                  <div
                    key={j.id}
                    className={`bg-white border rounded-2xl shadow-sm hover:shadow-md transition-all overflow-hidden
                      ${today ? 'border-indigo-200 ring-2 ring-indigo-100' : 'border-slate-100'}`}
                  >
                    <div className="flex items-stretch">
                      {/* Left accent */}
                      <div className={`w-1.5 flex-shrink-0 rounded-l-2xl ${
                        j.status === 'BERJALAN' ? 'bg-amber-400' :
                        j.status === 'SELESAI'  ? 'bg-emerald-400' :
                        today ? 'bg-indigo-500' : 'bg-slate-200'
                      }`} />

                      <div className="flex-1 p-4">
                        <div className="flex items-start justify-between gap-3 flex-wrap">
                          <div className="flex-1 min-w-0">
                            {/* Mapel + Kelas */}
                            <div className="flex items-center gap-2 flex-wrap mb-2">
                              <span className="font-bold text-slate-900">{j.nama_mapel}</span>
                              <span className="text-slate-300">·</span>
                              <span className="text-sm text-slate-600 flex items-center gap-1">
                                <Users className="w-3.5 h-3.5" />
                                Kelas {j.nama_kelas}
                              </span>
                              {today && (
                                <span className="text-xs px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-700 font-semibold">
                                  Hari Ini
                                </span>
                              )}
                            </div>

                            {/* Info grid */}
                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                              <InfoItem icon={<Calendar className="w-3.5 h-3.5" />} label="Tanggal" value={`${dayName}, ${formatDate(j.tanggal)}`} />
                              <InfoItem icon={<BookOpen className="w-3.5 h-3.5" />} label="Sesi" value={`Sesi ${j.sesi}`} />
                              <InfoItem icon={<Clock className="w-3.5 h-3.5" />} label="Jam" value={`${j.jam_mulai} – ${j.jam_selesai}`} />
                              <InfoItem icon={<Clock className="w-3.5 h-3.5" />} label="Durasi" value={`${j.durasi} menit`} />
                            </div>
                          </div>

                          {/* Status badge */}
                          <span className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full border font-medium flex-shrink-0 ${cfg.cls}`}>
                            {cfg.icon}
                            {cfg.label}
                          </span>
                        </div>

                        {/* Today reminder */}
                        {today && j.status === 'AKTIF' && (
                          <div className="mt-3 flex items-center gap-2 text-xs text-indigo-600 bg-indigo-50 px-3 py-2 rounded-xl">
                            <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
                            Ujian hari ini! Buka menu <strong className="mx-1">Mode Pengawas</strong> untuk memulai sesi.
                          </div>
                        )}
                        {today && j.status === 'BERJALAN' && (
                          <div className="mt-3 flex items-center gap-2 text-xs text-amber-600 bg-amber-50 px-3 py-2 rounded-xl">
                            <PlayCircle className="w-3.5 h-3.5 flex-shrink-0" />
                            Sesi sedang berlangsung — pantau di <strong className="mx-1">Mode Pengawas</strong>.
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </section>
        )
      })}
    </div>
  )
}

function MiniStat({ bg, icon, label, value }: { bg: string; icon: React.ReactNode; label: string; value: number }) {
  return (
    <div className="bg-white border border-slate-100 rounded-2xl shadow-sm p-4 flex items-center gap-3">
      <div className={`w-10 h-10 rounded-xl ${bg} flex items-center justify-center flex-shrink-0`}>{icon}</div>
      <div>
        <div className="text-xs text-slate-500">{label}</div>
        <div className="text-xl font-bold text-slate-900">{value}</div>
      </div>
    </div>
  )
}

function InfoItem({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs text-slate-400 flex items-center gap-1">{icon}{label}</span>
      <span className="text-xs font-semibold text-slate-700">{value}</span>
    </div>
  )
}
