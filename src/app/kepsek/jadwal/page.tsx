'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { Calendar, Clock, Users, CheckCircle, PlayCircle, Timer, BookOpen } from 'lucide-react'
import { apiRequest, formatDate } from '@/lib/utils'
import { PageLoader, EmptyState } from '@/components/ui'

interface JadwalRow {
  id: string
  tanggal: string
  sesi: number
  jam_mulai: string
  jam_selesai: string
  mapel_id: string
  kelas: string
  durasi: number
  status: 'AKTIF' | 'BERJALAN' | 'SELESAI'
  nama_mapel: string
  nama_pengawas: string | null
  jumlah_sudah_nilai: number | null
}

const STATUS_CONFIG = {
  AKTIF:    { label: 'Akan Datang',       cls: 'bg-blue-50 text-blue-700 border-blue-200',       icon: <Clock className="w-3.5 h-3.5" /> },
  BERJALAN: { label: 'Sedang Berlangsung', cls: 'bg-amber-50 text-amber-700 border-amber-200',    icon: <PlayCircle className="w-3.5 h-3.5" /> },
  SELESAI:  { label: 'Selesai',           cls: 'bg-emerald-50 text-emerald-700 border-emerald-200', icon: <CheckCircle className="w-3.5 h-3.5" /> },
}

function groupByMonth(list: JadwalRow[]) {
  const map: Record<string, JadwalRow[]> = {}
  for (const j of list) {
    const key = j.tanggal.slice(0, 7)
    if (!map[key]) map[key] = []
    map[key].push(j)
  }
  return Object.entries(map).sort(([a], [b]) => b.localeCompare(a))
}

function monthLabel(key: string) {
  const [y, m] = key.split('-')
  return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString('id-ID', { month: 'long', year: 'numeric' })
}

function isToday(dateStr: string) {
  return dateStr === new Date().toISOString().slice(0, 10)
}

export default function KepsekJadwalPage() {
  const [data, setData] = useState<JadwalRow[]>([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState<string>('')
  const [kelasFilter, setKelasFilter] = useState<string>('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (statusFilter) params.set('status', statusFilter)
      if (kelasFilter) params.set('kelas', kelasFilter)
      const res = await apiRequest<{ data: JadwalRow[] }>(`/api/kepsek/jadwal?${params}`)
      setData(res.data ?? [])
    } finally { setLoading(false) }
  }, [statusFilter, kelasFilter])

  useEffect(() => { load() }, [load])

  const kelasOptions = useMemo(() => [...new Set(data.map(d => d.kelas))].sort(), [data])
  const grouped = useMemo(() => groupByMonth(data), [data])

  const summary = useMemo(() => ({
    total: data.length,
    aktif: data.filter(d => d.status === 'AKTIF').length,
    berjalan: data.filter(d => d.status === 'BERJALAN').length,
    selesai: data.filter(d => d.status === 'SELESAI').length,
  }), [data])

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="page-title">Jadwal Ujian</h1>
        <p className="page-subtitle">Seluruh jadwal ujian yang telah diinput admin, lengkap dengan statusnya</p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="card-sm">
          <p className="text-xs text-slate-500">Total Jadwal</p>
          <p className="text-xl font-bold text-slate-900 mt-0.5">{summary.total}</p>
        </div>
        <div className="card-sm">
          <p className="text-xs text-slate-500">Akan Datang</p>
          <p className="text-xl font-bold text-blue-600 mt-0.5">{summary.aktif}</p>
        </div>
        <div className="card-sm">
          <p className="text-xs text-slate-500">Berlangsung</p>
          <p className="text-xl font-bold text-amber-600 mt-0.5">{summary.berjalan}</p>
        </div>
        <div className="card-sm">
          <p className="text-xs text-slate-500">Selesai</p>
          <p className="text-xl font-bold text-emerald-600 mt-0.5">{summary.selesai}</p>
        </div>
      </div>

      <div className="flex flex-wrap gap-3">
        <select className="select w-auto" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
          <option value="">Semua Status</option>
          <option value="AKTIF">Akan Datang</option>
          <option value="BERJALAN">Sedang Berlangsung</option>
          <option value="SELESAI">Selesai</option>
        </select>
        <select className="select w-auto" value={kelasFilter} onChange={e => setKelasFilter(e.target.value)}>
          <option value="">Semua Kelas</option>
          {kelasOptions.map(k => <option key={k} value={k}>Kelas {k}</option>)}
        </select>
      </div>

      {loading ? <PageLoader /> : !data.length ? (
        <div className="card"><EmptyState message="Belum ada jadwal ujian" icon={Calendar} /></div>
      ) : (
        <div className="space-y-8">
          {grouped.map(([monthKey, items]) => (
            <div key={monthKey}>
              <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-wide mb-3">{monthLabel(monthKey)}</h3>
              <div className="space-y-2.5">
                {items.map(j => {
                  const cfg = STATUS_CONFIG[j.status]
                  const today = isToday(j.tanggal)
                  return (
                    <div
                      key={j.id}
                      className={`rounded-2xl bg-white border overflow-hidden transition-all hover:shadow-card-md
                        ${today ? 'border-indigo-200 ring-2 ring-indigo-100' : 'border-slate-100'}`}
                    >
                      <div className="flex items-stretch">
                        <div className={`w-1.5 flex-shrink-0 rounded-l-2xl ${
                          j.status === 'BERJALAN' ? 'bg-amber-400' : j.status === 'SELESAI' ? 'bg-emerald-400' : today ? 'bg-indigo-500' : 'bg-slate-200'
                        }`} />
                        <div className="flex-1 p-4">
                          <div className="flex items-start justify-between gap-3 flex-wrap">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap mb-2">
                                <span className="font-bold text-slate-900">{j.nama_mapel}</span>
                                <span className="text-slate-300">·</span>
                                <span className="text-sm text-slate-600 flex items-center gap-1">
                                  <Users className="w-3.5 h-3.5" /> Kelas {j.kelas}
                                </span>
                                {today && (
                                  <span className="text-xs px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-700 font-semibold">Hari Ini</span>
                                )}
                              </div>
                              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                                <InfoItem icon={<Calendar className="w-3.5 h-3.5" />} label="Tanggal" value={formatDate(j.tanggal)} />
                                <InfoItem icon={<BookOpen className="w-3.5 h-3.5" />} label="Sesi" value={`Sesi ${j.sesi}`} />
                                <InfoItem icon={<Clock className="w-3.5 h-3.5" />} label="Jam" value={`${j.jam_mulai} – ${j.jam_selesai}`} />
                                <InfoItem icon={<Timer className="w-3.5 h-3.5" />} label="Durasi" value={`${j.durasi} menit`} />
                              </div>
                              {j.nama_pengawas && (
                                <p className="text-xs text-slate-400 mt-2">Pengawas: {j.nama_pengawas}</p>
                              )}
                              {j.status === 'SELESAI' && j.jumlah_sudah_nilai !== null && (
                                <p className="text-xs text-emerald-600 mt-1.5 font-medium">{j.jumlah_sudah_nilai} siswa sudah memiliki nilai</p>
                              )}
                            </div>
                            <span className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full border font-medium flex-shrink-0 ${cfg.cls}`}>
                              {cfg.icon} {cfg.label}
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function InfoItem({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center gap-1.5 text-slate-500">
      {icon}
      <span>{label}: <span className="text-slate-700 font-medium">{value}</span></span>
    </div>
  )
}
