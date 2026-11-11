'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { ShieldAlert, AlertTriangle, Repeat, TrendingDown, School, Users, HeartHandshake, UserX } from 'lucide-react'
import { apiRequest } from '@/lib/utils'
import { PageLoader, EmptyState, StatCard, ScopeWarningBanner } from '@/components/ui'

interface SiswaBerulang { nis: string; nama: string; kelas: string; jumlah: number; belum_ditindak: number }
interface SiswaNilaiRendah { nis: string; nama: string; kelas: string; jumlah_mapel_tidak_lulus: number }

interface DashboardData {
  scopeWarning?: string
  scope: { jumlahKelas: number; jumlahSiswa: number; kelas: string[] }
  pelanggaran: { mingguIni: number; bulanIni: number; belumDitindak: number }
  batasBerulang?: number
  berulang: SiswaBerulang[]
  jumlahBerulang?: number
  nilaiRendah: { jumlahSiswa: number; daftar: SiswaNilaiRendah[] }
}

interface RingkasanTidakUjian { tidakIkut: number; siswaTidakIkut: number; belumMasuk: number }

export default function BkDashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [nama, setNama] = useState('')
  // Kartu "Siswa Tidak Mengikuti Ujian" dimuat terpisah: bila gagal, dashboard
  // lain tetap tampil dan kartunya sekadar tidak muncul.
  const [tidakUjian, setTidakUjian] = useState<RingkasanTidakUjian | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      setData(await apiRequest<DashboardData>('/api/bk/dashboard'))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Gagal memuat dashboard')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
    try { setNama(JSON.parse(localStorage.getItem('user') ?? '{}').nama ?? '') } catch { /* abaikan */ }
    apiRequest<{ ringkasan?: RingkasanTidakUjian }>('/api/bk/tidak-ujian?ringkas=1', { timeoutMs: 30_000 })
      .then(r => setTidakUjian(r.ringkasan ?? null))
      .catch(() => setTidakUjian(null))
  }, [load])

  if (loading) return <PageLoader />

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="page-title flex items-center gap-2">
          <HeartHandshake className="w-6 h-6 text-pink-600" />
          Dashboard BK
        </h1>
        <p className="page-subtitle">
          {nama ? `Selamat datang, ${nama}. ` : ''}Ringkasan siswa yang perlu perhatian di kelas binaan Anda
        </p>
      </div>

      {error && <div className="card-sm border-red-200 bg-red-50 text-sm text-red-700">{error}</div>}
      {data?.scopeWarning && <ScopeWarningBanner title="Kelas binaan belum diatur" message={data.scopeWarning} />}

      {data && !data.scopeWarning && (
        <>
          <div className="card-sm flex items-start gap-3">
            <div className="w-9 h-9 rounded-xl bg-pink-50 text-pink-600 flex items-center justify-center flex-shrink-0">
              <School className="w-4.5 h-4.5" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-slate-800">
                {data.scope.jumlahKelas} kelas binaan · {data.scope.jumlahSiswa} siswa aktif
              </p>
              <div className="flex flex-wrap gap-1 mt-1.5">
                {data.scope.kelas.map(k => (
                  <span key={k} className="px-2 py-0.5 rounded-md bg-pink-50 border border-pink-200 text-pink-700 text-xs">Kelas {k}</span>
                ))}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard label="Pelanggaran 7 Hari Terakhir" value={data.pelanggaran.mingguIni} icon={ShieldAlert} color="bg-red-500"
              sub={`${data.pelanggaran.bulanIni} dalam 30 hari`} />
            <StatCard label="Belum Ditindaklanjuti" value={data.pelanggaran.belumDitindak} icon={AlertTriangle} color="bg-amber-500" />
            <StatCard label="Pelanggar Berulang" value={data.jumlahBerulang ?? 0} icon={Repeat} color="bg-pink-600"
              sub={`${data.batasBerulang ?? 3}+ pelanggaran / 30 hari`} />
            <StatCard label="Siswa Nilai di Bawah KKM" value={data.nilaiRendah.jumlahSiswa} icon={TrendingDown} color="bg-orange-500" />
          </div>

          {tidakUjian && (
            <Link href="/bk/tidak-ujian" className="card-sm flex items-center gap-3 hover:border-pink-300 transition-colors">
              <div className="w-9 h-9 rounded-xl bg-red-50 text-red-600 flex items-center justify-center flex-shrink-0">
                <UserX className="w-4.5 h-4.5" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-slate-800">
                  {tidakUjian.tidakIkut > 0
                    ? `${tidakUjian.siswaTidakIkut} siswa tidak mengikuti ujian (${tidakUjian.tidakIkut} mapel)`
                    : 'Tidak ada siswa yang tercatat tidak mengikuti ujian'}
                </p>
                <p className="text-xs text-slate-500">
                  {tidakUjian.belumMasuk > 0 ? `${tidakUjian.belumMasuk} lainnya belum masuk pada ujian yang sedang berjalan. ` : ''}
                  Lihat daftar lengkap
                </p>
              </div>
            </Link>
          )}

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
            <div className="card">
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-semibold text-slate-900 flex items-center gap-2">
                  <Repeat className="w-4 h-4 text-pink-600" /> Siswa Berulang Kali Melanggar
                </h2>
                <Link href="/bk/pelanggaran" className="text-xs text-pink-600 hover:underline">Lihat semua pelanggaran</Link>
              </div>
              {data.berulang.length === 0 ? (
                <EmptyState message="Tidak ada siswa yang berulang kali melanggar" icon={Users} />
              ) : (
                <div className="table-wrapper">
                  <table className="table">
                    <thead>
                      <tr><th>Siswa</th><th>Kelas</th><th>30 Hari</th><th>Belum Ditindak</th></tr>
                    </thead>
                    <tbody>
                      {data.berulang.map(s => (
                        <tr key={s.nis}>
                          <td>
                            <div className="font-medium text-slate-800">{s.nama}</div>
                            <div className="text-xs text-slate-400">{s.nis}</div>
                          </td>
                          <td className="text-slate-600">{s.kelas}</td>
                          <td><span className="badge-red">{s.jumlah}×</span></td>
                          <td>{s.belum_ditindak > 0 ? <span className="badge-yellow">{s.belum_ditindak}</span> : <span className="text-slate-300">—</span>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div className="card">
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-semibold text-slate-900 flex items-center gap-2">
                  <TrendingDown className="w-4 h-4 text-orange-500" /> Siswa dengan Nilai di Bawah KKM
                </h2>
                <Link href="/bk/nilai" className="text-xs text-pink-600 hover:underline">Lihat hasil & nilai</Link>
              </div>
              {data.nilaiRendah.daftar.length === 0 ? (
                <EmptyState message="Belum ada siswa dengan nilai di bawah KKM" icon={Users} />
              ) : (
                <div className="table-wrapper">
                  <table className="table">
                    <thead>
                      <tr><th>Siswa</th><th>Kelas</th><th>Mapel Tidak Lulus</th></tr>
                    </thead>
                    <tbody>
                      {data.nilaiRendah.daftar.map(s => (
                        <tr key={s.nis}>
                          <td>
                            <div className="font-medium text-slate-800">{s.nama}</div>
                            <div className="text-xs text-slate-400">{s.nis}</div>
                          </td>
                          <td className="text-slate-600">{s.kelas}</td>
                          <td><span className="badge-red">{s.jumlah_mapel_tidak_lulus} mapel</span></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
