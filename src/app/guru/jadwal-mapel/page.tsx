'use client'

// Menu "Jadwal Mapel Saya": daftar jadwal ujian untuk mata pelajaran yang
// DIAMPU guru ini (bukan jadwal tugas pengawasan — itu ada di menu "Jadwal
// Pengawasan"). Data dari /api/guru/jadwal-mapel.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { CalendarDays, CheckCircle, Clock, PlayCircle, Users, UserCheck, AlertCircle, RefreshCw } from 'lucide-react'
import { apiRequest, cn } from '@/lib/utils'
import { EmptyState, PageLoader } from '@/components/ui'

type StatusJadwal = 'AKTIF' | 'BERJALAN' | 'SELESAI'

interface JadwalMapel {
  id: string
  tanggal: string // YYYY-MM-DD
  sesi: number | null
  jam_mulai: string
  jam_selesai: string
  durasi: number | null
  status: StatusJadwal
  mapel_id: string
  nama_mapel: string
  kelas: string
  nama_kelas: string
  pengawas: string | null
  nama_pengawas: string | null
}

interface MapelRingkas {
  id: string
  nama: string
}

interface Respons {
  data: JadwalMapel[]
  mapelList: MapelRingkas[]
  hariIni: string
}

const STATUS_CONFIG: Record<StatusJadwal, { label: string; pendek: string; cls: string; icon: React.ReactNode }> = {
  AKTIF:    { label: 'Akan Datang', pendek: 'Akan datang', cls: 'bg-blue-100 text-blue-700 border-blue-200', icon: <Clock className="w-3.5 h-3.5" /> },
  BERJALAN: { label: 'Sedang Berlangsung', pendek: 'Berlangsung', cls: 'bg-amber-100 text-amber-700 border-amber-200', icon: <PlayCircle className="w-3.5 h-3.5" /> },
  SELESAI:  { label: 'Selesai', pendek: 'Selesai', cls: 'bg-emerald-100 text-emerald-700 border-emerald-200', icon: <CheckCircle className="w-3.5 h-3.5" /> },
}

// Tanggal dari server berupa 'YYYY-MM-DD' (tanpa zona). Diformat dengan
// timeZone UTC supaya hasilnya tidak bergeser sehari di perangkat dengan
// zona waktu lain.
function bagianTanggal(tanggal: string) {
  const d = new Date(`${tanggal}T00:00:00Z`)
  return {
    hari: d.toLocaleDateString('id-ID', { weekday: 'long', timeZone: 'UTC' }),
    hariPendek: d.toLocaleDateString('id-ID', { weekday: 'short', timeZone: 'UTC' }),
    tgl: d.toLocaleDateString('id-ID', { day: 'numeric', timeZone: 'UTC' }),
    bulanPendek: d.toLocaleDateString('id-ID', { month: 'short', timeZone: 'UTC' }),
    lengkap: d.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }),
  }
}

function labelBulan(key: string) {
  return new Date(`${key}-01T00:00:00Z`).toLocaleDateString('id-ID', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

export default function JadwalMapelSayaPage() {
  const [data, setData] = useState<Respons | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filterMapel, setFilterMapel] = useState('')
  const [filterStatus, setFilterStatus] = useState<'' | StatusJadwal>('')

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await apiRequest<Respons>('/api/guru/jadwal-mapel')
      setData(res)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Gagal memuat jadwal')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const semua = useMemo(() => data?.data ?? [], [data])

  const ringkasan = useMemo(() => ({
    total: semua.length,
    akanDatang: semua.filter(j => j.status === 'AKTIF').length,
    berjalan: semua.filter(j => j.status === 'BERJALAN').length,
    selesai: semua.filter(j => j.status === 'SELESAI').length,
  }), [semua])

  const terfilter = useMemo(
    () => semua.filter(j =>
      (!filterMapel || j.mapel_id === filterMapel) &&
      (!filterStatus || j.status === filterStatus)
    ),
    [semua, filterMapel, filterStatus]
  )

  const perBulan = useMemo(() => {
    const map: Record<string, JadwalMapel[]> = {}
    for (const j of terfilter) {
      const key = j.tanggal.slice(0, 7)
      if (!map[key]) map[key] = []
      map[key].push(j)
    }
    return Object.entries(map).sort(([a], [b]) => a.localeCompare(b))
  }, [terfilter])

  const judul = (
    <div>
      <h1 className="page-title">Jadwal Mapel Saya</h1>
      <p className="page-subtitle">
        Jadwal ujian untuk mata pelajaran yang Anda ampu, lengkap dengan kelas, waktu, dan pengawasnya.
      </p>
    </div>
  )

  if (loading && !data) return <PageLoader />

  if (error && !data) {
    return (
      <div className="space-y-6 animate-fade-in">
        {judul}
        <div className="card flex flex-col items-center gap-3 py-12 text-center">
          <AlertCircle className="w-10 h-10 text-red-400" />
          <p className="text-sm text-slate-600">{error}</p>
          <button onClick={load} className="btn-secondary btn-sm">
            <RefreshCw className="w-4 h-4" /> Coba lagi
          </button>
        </div>
      </div>
    )
  }

  const mapelList = data?.mapelList ?? []
  const hariIni = data?.hariIni ?? ''

  if (mapelList.length === 0) {
    return (
      <div className="space-y-6 animate-fade-in">
        {judul}
        <div className="card">
          <EmptyState
            icon={CalendarDays}
            title="Belum ada mata pelajaran yang Anda ampu"
            description="Jadwal akan muncul di sini setelah admin menetapkan Anda sebagai guru pengampu mata pelajaran."
          />
        </div>
      </div>
    )
  }

  if (semua.length === 0) {
    return (
      <div className="space-y-6 animate-fade-in">
        {judul}
        <div className="card">
          <EmptyState
            icon={CalendarDays}
            title="Belum ada jadwal ujian"
            description="Jadwal ujian untuk mata pelajaran yang Anda ampu belum dibuat oleh admin."
          />
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4 sm:space-y-6 animate-fade-in">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="page-title">Jadwal Mapel Saya</h1>
          <p className="page-subtitle">Jadwal ujian mapel yang Anda ampu, beserta kelas, waktu, dan pengawasnya.</p>
        </div>
        <button
          onClick={load}
          disabled={loading}
          aria-label="Muat ulang"
          className="btn-secondary btn-sm flex-shrink-0"
        >
          <RefreshCw className={cn('w-4 h-4', loading && 'animate-spin')} />
          <span className="hidden sm:inline">Muat ulang</span>
        </button>
      </div>

      {/* Ringkasan ringkas: 4 angka sejajar, muat di layar HP */}
      <div className="grid grid-cols-4 gap-2 sm:gap-4">
        <RingkasTile label="Total" value={ringkasan.total} cls="text-slate-800" />
        <RingkasTile label="Akan datang" value={ringkasan.akanDatang} cls="text-blue-600" />
        <RingkasTile label="Berlangsung" value={ringkasan.berjalan} cls="text-amber-600" />
        <RingkasTile label="Selesai" value={ringkasan.selesai} cls="text-emerald-600" />
      </div>

      {/* Filter: 2 kolom sejajar di HP */}
      <div className="grid grid-cols-2 gap-2 sm:flex sm:gap-3">
        <select
          value={filterMapel}
          onChange={e => setFilterMapel(e.target.value)}
          className="select w-full sm:w-56"
          aria-label="Filter mapel"
        >
          <option value="">Semua Mapel</option>
          {mapelList.map(m => <option key={m.id} value={m.id}>{m.nama}</option>)}
        </select>
        <select
          value={filterStatus}
          onChange={e => setFilterStatus(e.target.value as '' | StatusJadwal)}
          className="select w-full sm:w-52"
          aria-label="Filter status"
        >
          <option value="">Semua Status</option>
          <option value="AKTIF">Akan Datang</option>
          <option value="BERJALAN">Berlangsung</option>
          <option value="SELESAI">Selesai</option>
        </select>
      </div>

      {perBulan.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={CalendarDays}
            title="Tidak ada jadwal yang cocok"
            description="Coba ubah filter mapel atau status di atas."
          />
        </div>
      ) : (
        perBulan.map(([bulan, daftar]) => (
          <section key={bulan} className="space-y-2">
            <h2 className="text-xs font-bold text-slate-600 uppercase tracking-wider">{labelBulan(bulan)}</h2>
            <div className="space-y-2">
              {daftar.map(j => {
                const t = bagianTanggal(j.tanggal)
                const st = STATUS_CONFIG[j.status] ?? STATUS_CONFIG.AKTIF
                const hariIniKah = j.tanggal === hariIni
                return (
                  <div
                    key={j.id}
                    className={cn(
                      'card flex items-stretch gap-3 p-3 sm:p-4',
                      hariIniKah && 'ring-2 ring-emerald-300'
                    )}
                  >
                    {/* Blok tanggal */}
                    <div
                      className={cn(
                        'w-12 sm:w-14 flex-shrink-0 rounded-xl flex flex-col items-center justify-center py-1.5',
                        hariIniKah ? 'bg-emerald-600 text-white' : 'bg-slate-100 text-slate-700'
                      )}
                      title={t.lengkap}
                    >
                      <span className="text-[10px] uppercase tracking-wide opacity-80">{t.hariPendek}</span>
                      <span className="text-lg sm:text-xl font-bold leading-none">{t.tgl}</span>
                      <span className="text-[10px] uppercase opacity-80">{t.bulanPendek}</span>
                    </div>

                    <div className="min-w-0 flex-1">
                      {/* Mapel + kelas */}
                      <div className="flex items-start justify-between gap-2">
                        <p className="font-semibold text-slate-800 text-sm sm:text-base leading-snug">{j.nama_mapel}</p>
                        <span className="inline-flex flex-shrink-0 items-center gap-1 rounded-full bg-slate-100 text-slate-600 px-2 py-0.5 text-xs font-semibold">
                          <Users className="w-3 h-3" /> {j.nama_kelas}
                        </span>
                      </div>

                      {/* Jam · sesi */}
                      <p className="mt-1 text-xs sm:text-sm text-slate-500 flex items-center gap-x-2.5 gap-y-0.5 flex-wrap">
                        <span className="inline-flex items-center gap-1">
                          <Clock className="w-3.5 h-3.5 text-slate-400" />
                          {j.jam_mulai}–{j.jam_selesai}
                        </span>
                        {j.sesi != null && <span>Sesi {j.sesi}</span>}
                        {j.durasi ? <span>{j.durasi} mnt</span> : null}
                      </p>

                      {/* Pengawas (kiri) + status (kanan) */}
                      <div className="mt-1.5 flex items-center justify-between gap-2">
                        <p className="min-w-0 text-xs text-slate-500 inline-flex items-center gap-1">
                          <UserCheck className="w-3.5 h-3.5 flex-shrink-0 text-slate-400" />
                          <span className="truncate">{j.nama_pengawas ?? 'Pengawas belum ditentukan'}</span>
                        </p>
                        <span className={cn('inline-flex flex-shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium', st.cls)}>
                          {st.icon}
                          {hariIniKah && j.status === 'AKTIF' ? 'Hari ini' : st.pendek}
                        </span>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </section>
        ))
      )}
    </div>
  )
}

function RingkasTile({ label, value, cls }: { label: string; value: number; cls: string }) {
  return (
    <div className="card p-2.5 sm:p-4 text-center">
      <div className={cn('text-xl sm:text-2xl font-bold leading-none', cls)}>{value}</div>
      <div className="mt-1 text-[10px] sm:text-xs text-slate-500 leading-tight">{label}</div>
    </div>
  )
}
