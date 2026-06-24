'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import Link from 'next/link'
import {
  BarChart3, Users, BookOpen, TrendingUp, Calendar, Clock,
  PlayCircle, AlertTriangle, ChevronRight, CalendarClock,
} from 'lucide-react'
import { StatCard, PageLoader, EmptyState, Badge } from '@/components/ui'
import { apiRequest, nilaiColor } from '@/lib/utils'

interface JadwalHariIni {
  id: string
  sesi: number
  jam_mulai: string
  jam_selesai: string
  kelas: string
  status: 'AKTIF' | 'BERJALAN' | 'SELESAI'
  nama_mapel: string
  nama_pengawas: string | null
}

interface SesiBerlangsung {
  id: string
  nama_mapel: string
  kelas: string
  waktu_mulai: string
  durasi: number
  jumlah_peserta: number
  sisaDetik: number
  lewatWaktu: boolean
}

interface SiswaTidakHadir {
  nis: string
  nama: string
  kelas: string
  mapel_id: string
  nama_mapel: string
  sesi_id: string
}

interface KepsekData {
  stats: { totalSiswa: number; totalGuru: number; totalUjian: number; rataRata: number }
  nilaiPerKelas: Array<{ kelas: string; rata: number; total: number; lulus: number }>
  nilaiPerMapel: Array<{ nama: string; rata: number; total: number }>
  ujianHariIni: JadwalHariIni[]
  sedangBerlangsung: SesiBerlangsung[]
  siswaTidakHadir: SiswaTidakHadir[]
}

function formatSisaWaktu(detik: number): string {
  const m = Math.floor(detik / 60)
  const s = detik % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

export default function KepsekDashboard() {
  const [data, setData] = useState<KepsekData | null>(null)
  const [loading, setLoading] = useState(true)
  const [fetchedAt, setFetchedAt] = useState(Date.now())
  const [nowMs, setNowMs] = useState(Date.now())
  const [showTidakHadir, setShowTidakHadir] = useState(false)
  const [siteInfo, setSiteInfo] = useState({ namaSekolah: '', tahunAjaran: '' })

  const load = useCallback(async () => {
    try {
      const res = await apiRequest<KepsekData>('/api/kepsek/dashboard')
      setData(res)
      setFetchedAt(Date.now())
    } finally { setLoading(false) }
  }, [])

  // Sama seperti Dashboard Admin: ambil nama sekolah & tahun ajaran dari
  // pengaturan, bukan hardcode teks tetap. Sebelumnya subtitle di sini
  // SELALU menampilkan "MTS Alkhairaat Tatakalai" apa pun isi pengaturan
  // sekolah yang sebenarnya — bug ini yang dilaporkan.
  const loadSiteInfo = useCallback(() => {
    fetch('/api/public/pengaturan?t=' + Date.now(), { cache: 'no-store' })
      .then(r => r.json())
      .then(json => {
        if (json?.data) setSiteInfo({
          namaSekolah: json.data.namaSekolah ?? '',
          tahunAjaran: json.data.tahunAjaran ?? '',
        })
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    load()
    loadSiteInfo()
    window.addEventListener('pengaturan-changed', loadSiteInfo)
    return () => window.removeEventListener('pengaturan-changed', loadSiteInfo)
  }, [load, loadSiteInfo])

  // Refresh data tiap 30 detik agar status sesi tetap akurat
  useEffect(() => {
    const i = setInterval(load, 30000)
    return () => clearInterval(i)
  }, [load])

  // Tick tiap detik untuk countdown lokal di sisi klien (tanpa perlu fetch ulang)
  useEffect(() => {
    const i = setInterval(() => setNowMs(Date.now()), 1000)
    return () => clearInterval(i)
  }, [])

  const sesiLive = useMemo(() => {
    const elapsedSinceFetch = Math.floor((nowMs - fetchedAt) / 1000)
    return (data?.sedangBerlangsung ?? []).map(s => ({
      ...s,
      sisaLive: Math.max(0, s.sisaDetik - elapsedSinceFetch),
    }))
  }, [data?.sedangBerlangsung, fetchedAt, nowMs])

  if (loading) return <PageLoader />

  const jumlahTidakHadir = data?.siswaTidakHadir.length ?? 0

  return (
    <div className="space-y-8 animate-fade-in">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="page-title">Dashboard Kepala Sekolah</h1>
          <p className="page-subtitle">
            {siteInfo.namaSekolah
              ? `Ringkasan akademik ${siteInfo.namaSekolah}${siteInfo.tahunAjaran ? ' · Tahun Ajaran ' + siteInfo.tahunAjaran : ''}`
              : 'Ringkasan akademik sekolah'}
          </p>
        </div>
        <Link href="/kepsek/jadwal" className="btn-secondary btn-sm">
          <CalendarClock className="w-4 h-4" /> Lihat Semua Jadwal
        </Link>
      </div>

      {/* Alert siswa tidak hadir */}
      {jumlahTidakHadir > 0 && (
        <button
          onClick={() => setShowTidakHadir(v => !v)}
          className="w-full text-left card-sm border-amber-200 bg-amber-50 hover:bg-amber-100/70 transition-colors flex items-center gap-3"
        >
          <div className="w-9 h-9 rounded-xl bg-amber-500 flex items-center justify-center flex-shrink-0">
            <AlertTriangle className="w-4.5 h-4.5 text-white" />
          </div>
          <div className="flex-1">
            <p className="text-sm font-semibold text-amber-800">
              {jumlahTidakHadir} siswa tidak ikut ujian dalam 24 jam terakhir
            </p>
            <p className="text-xs text-amber-700/80">Klik untuk lihat detail siswa per kelas dan mapel</p>
          </div>
          <ChevronRight className={`w-4 h-4 text-amber-600 transition-transform ${showTidakHadir ? 'rotate-90' : ''}`} />
        </button>
      )}
      {showTidakHadir && jumlahTidakHadir > 0 && (
        <div className="card-sm -mt-2 animate-slide-up">
          <div className="table-wrapper">
            <table className="table">
              <thead>
                <tr>
                  <th>Nama Siswa</th>
                  <th>Kelas</th>
                  <th>Mapel</th>
                </tr>
              </thead>
              <tbody>
                {data?.siswaTidakHadir.map((s, i) => (
                  <tr key={`${s.sesi_id}-${s.nis}-${i}`}>
                    <td className="font-medium text-slate-800">{s.nama}</td>
                    <td>{s.kelas}</td>
                    <td>{s.nama_mapel}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Total Siswa" value={data?.stats.totalSiswa ?? 0} icon={Users} color="bg-brand-500" />
        <StatCard label="Total Guru" value={data?.stats.totalGuru ?? 0} icon={Users} color="bg-emerald-500" />
        <StatCard label="Total Ujian" value={data?.stats.totalUjian ?? 0} icon={BookOpen} color="bg-purple-500" />
        <StatCard label="Rata-rata Nilai" value={data?.stats.rataRata ?? 0} icon={TrendingUp} color="bg-amber-500" />
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        {/* Ujian Hari Ini */}
        <div className="card">
          <h2 className="font-semibold text-slate-900 mb-4 flex items-center gap-2">
            <Calendar className="w-4 h-4 text-brand-600" /> Ujian Hari Ini
          </h2>
          {!data?.ujianHariIni.length ? (
            <EmptyState message="Tidak ada jadwal ujian hari ini" icon={Calendar} />
          ) : (
            <div className="space-y-2.5">
              {data.ujianHariIni.map(j => (
                <div key={j.id} className="flex items-center gap-3 p-3 rounded-xl border border-slate-100 hover:border-slate-200 transition-colors">
                  <div className={`w-1.5 h-10 rounded-full flex-shrink-0 ${
                    j.status === 'BERJALAN' ? 'bg-amber-400' : j.status === 'SELESAI' ? 'bg-emerald-400' : 'bg-slate-200'
                  }`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-slate-800 text-sm">{j.nama_mapel}</span>
                      <span className="text-slate-300">·</span>
                      <span className="text-xs text-slate-500">Kelas {j.kelas}</span>
                    </div>
                    <p className="text-xs text-slate-400 mt-0.5">
                      Sesi {j.sesi} &middot; {j.jam_mulai}–{j.jam_selesai}
                      {j.nama_pengawas && <> &middot; Pengawas: {j.nama_pengawas}</>}
                    </p>
                  </div>
                  <Badge variant={j.status === 'BERJALAN' ? 'yellow' : j.status === 'SELESAI' ? 'green' : 'slate'} dot>
                    {j.status === 'AKTIF' ? 'Belum Mulai' : j.status === 'BERJALAN' ? 'Berjalan' : 'Selesai'}
                  </Badge>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Sedang Berlangsung */}
        <div className="card">
          <h2 className="font-semibold text-slate-900 mb-4 flex items-center gap-2">
            <PlayCircle className="w-4 h-4 text-amber-500" /> Sedang Berlangsung
          </h2>
          {!sesiLive.length ? (
            <EmptyState message="Tidak ada ujian yang sedang berjalan" icon={PlayCircle} />
          ) : (
            <div className="space-y-3">
              {sesiLive.map(s => {
                const persen = s.durasi > 0 ? Math.max(0, Math.min(100, (s.sisaLive / (s.durasi * 60)) * 100)) : 0
                const kritis = s.sisaLive < 300
                return (
                  <div key={s.id} className="p-3.5 rounded-xl border border-amber-100 bg-amber-50/40">
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="font-medium text-slate-800 text-sm truncate">{s.nama_mapel}</span>
                        <span className="text-slate-300 flex-shrink-0">·</span>
                        <span className="text-xs text-slate-500 flex-shrink-0">Kelas {s.kelas}</span>
                      </div>
                      <span className={`flex items-center gap-1 text-xs font-bold flex-shrink-0 ${kritis ? 'text-red-600' : 'text-amber-700'}`}>
                        <Clock className="w-3.5 h-3.5" />
                        {s.sisaLive <= 0 ? 'Waktu habis' : formatSisaWaktu(s.sisaLive)}
                      </span>
                    </div>
                    <div className="h-1.5 bg-amber-100 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all duration-1000 ${kritis ? 'bg-red-500' : 'bg-amber-500'}`}
                        style={{ width: `${persen}%` }}
                      />
                    </div>
                    <p className="text-xs text-slate-400 mt-1.5">{s.jumlah_peserta} peserta terdaftar</p>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        {/* Per Kelas */}
        <div className="card">
          <h2 className="font-semibold text-slate-900 mb-4 flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-brand-600" /> Rata-rata per Kelas
          </h2>
          <div className="space-y-3">
            {(data?.nilaiPerKelas ?? []).map(k => (
              <div key={k.kelas}>
                <div className="flex items-center justify-between text-sm mb-1">
                  <span className="font-medium text-slate-700">Kelas {k.kelas}</span>
                  <div className="flex items-center gap-3 text-xs text-slate-500">
                    <span>{k.total} siswa</span>
                    <span className="text-emerald-600">{Math.round((k.lulus / k.total) * 100)}% lulus</span>
                    <span className={`font-bold text-sm ${nilaiColor(k.rata)}`}>{k.rata}</span>
                  </div>
                </div>
                <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                  <div className="h-full bg-brand-500 rounded-full" style={{ width: `${Math.min(k.rata, 100)}%` }} />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Per Mapel */}
        <div className="card">
          <h2 className="font-semibold text-slate-900 mb-4 flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-brand-600" /> Rata-rata per Mapel
          </h2>
          <div className="space-y-3">
            {(data?.nilaiPerMapel ?? []).slice(0, 10).map(m => (
              <div key={m.nama}>
                <div className="flex items-center justify-between text-xs mb-1">
                  <span className="text-slate-600 truncate max-w-[160px]" title={m.nama}>{m.nama}</span>
                  <span className={`font-bold text-sm ${nilaiColor(m.rata)}`}>{m.rata}</span>
                </div>
                <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                  <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${Math.min(m.rata, 100)}%` }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
