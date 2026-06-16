'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  Users, BookOpen, CheckCircle, AlertTriangle, Download,
  TrendingUp, Award, XCircle, ChevronDown, ChevronUp,
  Calendar, RefreshCw, Clock, UserCheck, UserX, BarChart2
} from 'lucide-react'
import { apiRequest, formatDate, nilaiColor } from '@/lib/utils'
import { PageLoader } from '@/components/ui'

interface SiswaInfo { nis: string; nama: string }

interface MapelInfo {
  id: string
  kelas_id: string
  mapel_id: string
  nama_mapel: string
  nama_kelas: string
  status: string
  jadwal: {
    tanggal: string; sesi: number; jam_mulai: string; jam_selesai: string; status: string
  } | null
  sudahUjian: number
  totalSiswa: number
  belumUjianSiswa: SiswaInfo[]
  rataRata: number | null
  nilaiList: { nis: string; nilai: number; grade: string; lulus: boolean }[]
}

interface NilaiRow {
  nis: string
  nama: string
  [mapelId: string]: { nilai: number; grade: string; lulus: boolean } | string | null
}

interface WaliKelasData {
  isWaliKelas: boolean
  kelas: { id: string; nama: string; jurusan?: string; wali_kelas: string; jumlah: number } | null
  mapelList: MapelInfo[]
  siswaList: SiswaInfo[]
  nilaiRekap: NilaiRow[]
}

const GRADE_STYLE: Record<string, string> = {
  A: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  B: 'bg-blue-100 text-blue-700 border-blue-200',
  C: 'bg-yellow-100 text-yellow-700 border-yellow-200',
  D: 'bg-orange-100 text-orange-700 border-orange-200',
  E: 'bg-red-100 text-red-700 border-red-200',
}

const STATUS_JADWAL: Record<string, { label: string; cls: string; dot: string }> = {
  AKTIF:    { label: 'Aktif',       cls: 'bg-blue-100 text-blue-700',    dot: 'bg-blue-500' },
  BERJALAN: { label: 'Berlangsung', cls: 'bg-amber-100 text-amber-700',  dot: 'bg-amber-500' },
  SELESAI:  { label: 'Selesai',     cls: 'bg-emerald-100 text-emerald-700', dot: 'bg-emerald-500' },
}

export default function WaliKelasPage() {
  const [data, setData]             = useState<WaliKelasData | null>(null)
  const [loading, setLoading]       = useState(true)
  const [expandedBelum, setExpandedBelum] = useState<string | null>(null)
  const [downloading, setDownloading]     = useState(false)
  const [refreshing, setRefreshing]       = useState(false)

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    else setRefreshing(true)
    try {
      const res = await apiRequest<WaliKelasData>('/api/guru/wali-kelas')
      setData(res)
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  async function downloadExcel() {
    if (!data) return
    setDownloading(true)
    try {
      const XLSX = await import('xlsx')
      const wb = XLSX.utils.book_new()

      const ringkasanData = data.nilaiRekap.map((row, i) => {
        const r: Record<string, unknown> = { No: i + 1, NIS: row.nis, 'Nama Siswa': row.nama }
        data.mapelList.forEach(mp => {
          const v = row[mp.mapel_id]
          if (v && typeof v === 'object') {
            const obj = v as { nilai: number; grade: string; lulus: boolean }
            r[mp.nama_mapel] = obj.nilai
          } else {
            r[mp.nama_mapel] = '-'
          }
        })
        return r
      })
      const wsRingkasan = XLSX.utils.json_to_sheet(ringkasanData)
      XLSX.utils.book_append_sheet(wb, wsRingkasan, 'Ringkasan Semua Mapel')

      data.mapelList.forEach(mp => {
        const sheetData = data.nilaiRekap.map((row, i) => {
          const v = row[mp.mapel_id]
          const obj = v && typeof v === 'object' ? v as { nilai: number; grade: string; lulus: boolean } : null
          return {
            No: i + 1,
            NIS: row.nis,
            'Nama Siswa': row.nama,
            Nilai: obj ? obj.nilai : '-',
            Grade: obj ? obj.grade : '-',
            Status: obj ? (obj.lulus ? 'Lulus' : 'Tidak Lulus') : 'Belum Ujian',
          }
        })
        const ws = XLSX.utils.json_to_sheet(sheetData)
        XLSX.utils.book_append_sheet(wb, ws, mp.nama_mapel.substring(0, 31))
      })

      const kelasNama = data.kelas?.nama ?? 'Kelas'
      XLSX.writeFile(wb, `Rekap_Nilai_${kelasNama.replace(/\s/g, '_')}.xlsx`)
    } catch (e) {
      console.error(e)
      alert('Gagal membuat file Excel.')
    } finally {
      setDownloading(false)
    }
  }

  if (loading) return <PageLoader />

  if (!data?.isWaliKelas) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] space-y-4">
        <div className="w-20 h-20 rounded-full bg-slate-100 flex items-center justify-center">
          <Users className="w-10 h-10 text-slate-400" />
        </div>
        <div className="text-center">
          <h2 className="text-xl font-bold text-slate-700">Anda Bukan Wali Kelas</h2>
          <p className="text-slate-400 mt-1 text-sm">Hubungi administrator untuk penugasan wali kelas.</p>
        </div>
      </div>
    )
  }

  const kelas     = data.kelas!
  const mapelList = data.mapelList
  const nilaiRekap = data.nilaiRekap
  const siswaList  = data.siswaList

  const totalSiswa  = siswaList.length
  const totalMapel  = mapelList.length
  const mapelSelesai = mapelList.filter(m => m.jadwal?.status === 'SELESAI').length
  const mapelAktif   = mapelList.filter(m => m.jadwal !== null)

  const rataRataAll = mapelList.filter(m => m.rataRata !== null).length
    ? Math.round(
        mapelList.filter(m => m.rataRata !== null)
          .reduce((s, m) => s + (m.rataRata ?? 0), 0) /
        mapelList.filter(m => m.rataRata !== null).length
      )
    : null

  // Mapel yang sudah ada jadwal (sudah diujiankan / akan diujiankan)
  const mapelDijadwalkan = mapelList.filter(m => m.jadwal !== null)
  // Siswa yang paling banyak belum ujian (ringkasan cepat)
  const totalBelumLengkap = siswaList.filter(s =>
    mapelDijadwalkan.some(m => m.belumUjianSiswa.some(b => b.nis === s.nis))
  ).length

  return (
    <div className="space-y-8 animate-fade-in pb-10">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <div className="w-8 h-8 rounded-lg bg-emerald-600 flex items-center justify-center">
              <Users className="w-4 h-4 text-white" />
            </div>
            <span className="text-xs font-semibold text-emerald-600 uppercase tracking-wider">Wali Kelas</span>
          </div>
          <h1 className="text-2xl font-bold text-slate-900">Kelas {kelas.nama}</h1>
          <p className="text-slate-500 text-sm mt-0.5">
            {totalSiswa} siswa · {totalMapel} mata pelajaran
            {kelas.jurusan && kelas.jurusan !== '-' ? ` · ${kelas.jurusan}` : ''}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => load(true)}
            disabled={refreshing}
            className="flex items-center gap-2 px-3 py-2 rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50 text-sm font-medium transition-colors"
          >
            <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
            Refresh
          </button>
          <button
            onClick={downloadExcel}
            disabled={downloading}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-600 text-white hover:bg-emerald-700 text-sm font-medium transition-colors shadow-sm"
          >
            <Download className="w-4 h-4" />
            {downloading ? 'Memproses...' : 'Download Excel (Rekap Nilai)'}
          </button>
        </div>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatMini
          icon={<Users className="w-5 h-5 text-blue-600" />}
          bg="bg-blue-50"
          label="Jumlah Siswa"
          value={totalSiswa}
        />
        <StatMini
          icon={<BookOpen className="w-5 h-5 text-purple-600" />}
          bg="bg-purple-50"
          label="Mata Pelajaran"
          value={totalMapel > 0 ? totalMapel : '—'}
        />
        <StatMini
          icon={<CheckCircle className="w-5 h-5 text-emerald-600" />}
          bg="bg-emerald-50"
          label="Mapel Selesai"
          value={totalMapel > 0 ? `${mapelSelesai}/${totalMapel}` : '—'}
        />
        <StatMini
          icon={<TrendingUp className="w-5 h-5 text-amber-600" />}
          bg="bg-amber-50"
          label="Rata-rata Nilai"
          value={rataRataAll !== null ? rataRataAll : '—'}
        />
      </div>

      {/* ── Ringkasan per Mapel yang Dijadwalkan ── */}
      <section>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-bold text-slate-800 flex items-center gap-2">
            <BookOpen className="w-4 h-4 text-emerald-600" />
            Ringkasan per Mata Pelajaran
          </h2>
          {totalBelumLengkap > 0 && (
            <span className="flex items-center gap-1.5 text-xs font-medium text-amber-700 bg-amber-50 border border-amber-200 px-3 py-1.5 rounded-full">
              <AlertTriangle className="w-3.5 h-3.5" />
              {totalBelumLengkap} siswa belum lengkap nilainya
            </span>
          )}
        </div>

        {mapelDijadwalkan.length === 0 ? (
          <div className="bg-white border border-dashed border-slate-200 rounded-2xl p-10 text-center">
            <div className="w-12 h-12 rounded-xl bg-slate-100 flex items-center justify-center mx-auto mb-3">
              <Calendar className="w-6 h-6 text-slate-400" />
            </div>
            <p className="text-slate-500 text-sm font-medium">Belum ada mata pelajaran yang dijadwalkan</p>
            <p className="text-slate-400 text-xs mt-1">Kartu akan muncul otomatis saat admin menambahkan jadwal ujian untuk kelas ini</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
            {mapelDijadwalkan.map(mp => {
              const belumCount   = mp.belumUjianSiswa.length
              const sudahCount   = mp.sudahUjian
              const total        = mp.totalSiswa
              const pct          = total > 0 ? Math.round((sudahCount / total) * 100) : 0
              const jadwalStatus = mp.jadwal ? STATUS_JADWAL[mp.jadwal.status] ?? STATUS_JADWAL.AKTIF : null
              const isExpanded   = expandedBelum === mp.mapel_id
              const isSelesai    = mp.jadwal?.status === 'SELESAI'
              const lulusCount   = mp.nilaiList.filter(n => n.lulus).length
              const tidakLulus   = mp.nilaiList.filter(n => !n.lulus).length

              return (
                <div
                  key={mp.mapel_id}
                  className={`bg-white border rounded-2xl shadow-sm hover:shadow-md transition-all overflow-hidden ${
                    belumCount > 0 ? 'border-amber-200' : 'border-slate-100'
                  }`}
                >
                  {/* Top accent line */}
                  <div className={`h-1 w-full ${pct === 100 ? 'bg-emerald-500' : pct > 50 ? 'bg-blue-400' : 'bg-amber-400'}`} />

                  {/* Card Header */}
                  <div className="p-4 pb-3">
                    <div className="flex items-start justify-between gap-2 mb-3">
                      <div className="flex-1 min-w-0">
                        <h3 className="font-bold text-slate-900 text-sm leading-tight">{mp.nama_mapel}</h3>
                        {mp.jadwal && (
                          <p className="text-xs text-slate-400 mt-1 flex items-center gap-1">
                            <Calendar className="w-3 h-3 flex-shrink-0" />
                            {formatDate(mp.jadwal.tanggal)} · Sesi {mp.jadwal.sesi}
                            <span className="text-slate-300">·</span>
                            {mp.jadwal.jam_mulai}–{mp.jadwal.jam_selesai}
                          </p>
                        )}
                      </div>
                      {jadwalStatus && (
                        <span className={`flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium flex-shrink-0 ${jadwalStatus.cls}`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${jadwalStatus.dot} inline-block`} />
                          {jadwalStatus.label}
                        </span>
                      )}
                    </div>

                    {/* Progress bar keikutsertaan */}
                    <div className="space-y-1.5">
                      <div className="flex justify-between text-xs">
                        <span className="text-slate-500 flex items-center gap-1">
                          <UserCheck className="w-3 h-3" />
                          Peserta ujian
                        </span>
                        <span className="font-semibold text-slate-700">{sudahCount}/{total} siswa</span>
                      </div>
                      <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                        <div
                          className={`h-2 rounded-full transition-all duration-500 ${
                            pct === 100 ? 'bg-emerald-500' : pct > 50 ? 'bg-blue-500' : 'bg-amber-400'
                          }`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <div className="flex justify-between text-xs text-slate-400">
                        <span>{pct}% selesai</span>
                        {belumCount > 0 && (
                          <span className="text-amber-600 font-medium">{belumCount} belum ikut</span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Divider */}
                  <div className="border-t border-slate-50 mx-3" />

                  {/* Stats row – hanya jika sudah ada nilai */}
                  {isSelesai && mp.nilaiList.length > 0 && (
                    <div className="px-4 py-3 grid grid-cols-3 gap-2">
                      <div className="text-center">
                        <div className={`text-base font-bold ${nilaiColor(mp.rataRata ?? 0)}`}>
                          {mp.rataRata ?? '—'}
                        </div>
                        <div className="text-xs text-slate-400 mt-0.5 flex items-center justify-center gap-0.5">
                          <BarChart2 className="w-3 h-3" />Rata-rata
                        </div>
                      </div>
                      <div className="text-center border-x border-slate-50">
                        <div className="text-base font-bold text-emerald-600">{lulusCount}</div>
                        <div className="text-xs text-slate-400 mt-0.5 flex items-center justify-center gap-0.5">
                          <CheckCircle className="w-3 h-3" />Lulus
                        </div>
                      </div>
                      <div className="text-center">
                        <div className={`text-base font-bold ${tidakLulus > 0 ? 'text-red-500' : 'text-slate-300'}`}>
                          {tidakLulus}
                        </div>
                        <div className="text-xs text-slate-400 mt-0.5 flex items-center justify-center gap-0.5">
                          <XCircle className="w-3 h-3" />Tidak Lulus
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Belum ujian – tombol lihat siapa */}
                  {belumCount > 0 && (
                    <div className="px-3 pb-3">
                      <button
                        onClick={() => setExpandedBelum(isExpanded ? null : mp.mapel_id)}
                        className="w-full flex items-center justify-between gap-2 px-3 py-2.5 rounded-xl bg-amber-50 border border-amber-200 text-amber-700 hover:bg-amber-100 transition-colors text-xs font-semibold"
                      >
                        <div className="flex items-center gap-1.5">
                          <AlertTriangle className="w-3.5 h-3.5" />
                          <span>{belumCount} siswa belum ujian — lihat siapa</span>
                        </div>
                        {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                      </button>

                      {isExpanded && (
                        <div className="mt-2 bg-amber-50 border border-amber-100 rounded-xl overflow-hidden divide-y divide-amber-100">
                          {mp.belumUjianSiswa.map((s, i) => (
                            <div key={s.nis} className="flex items-center gap-2.5 px-3 py-2 text-xs">
                              <div className="w-6 h-6 rounded-full bg-amber-200 flex items-center justify-center font-bold text-amber-800 flex-shrink-0 text-xs">
                                {i + 1}
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="font-semibold text-amber-900 truncate">{s.nama}</div>
                                <div className="text-amber-600">{s.nis}</div>
                              </div>
                              <UserX className="w-3.5 h-3.5 text-amber-400 flex-shrink-0" />
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Semua sudah ujian */}
                  {belumCount === 0 && sudahCount > 0 && (
                    <div className="px-4 pb-3">
                      <div className="flex items-center gap-1.5 text-xs text-emerald-600 bg-emerald-50 px-3 py-2 rounded-xl">
                        <CheckCircle className="w-3.5 h-3.5" />
                        Semua siswa telah mengikuti ujian
                      </div>
                    </div>
                  )}

                  {/* Belum ada peserta */}
                  {sudahCount === 0 && (
                    <div className="px-4 pb-3">
                      <div className="flex items-center gap-1.5 text-xs text-slate-400 bg-slate-50 px-3 py-2 rounded-xl">
                        <Clock className="w-3.5 h-3.5" />
                        Belum ada siswa yang mengikuti ujian
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </section>

      {/* ── Tabel Rekap Nilai – selalu tampil meski kosong ── */}
      <section>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-bold text-slate-800 flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-emerald-600" />
            Rekap Nilai Semua Siswa
          </h2>
          <span className="text-xs text-slate-400 italic">
            ← geser tabel ke kanan untuk melihat semua mapel — nama siswa tetap terlihat
          </span>
        </div>

        <div className="bg-white border border-slate-100 rounded-2xl shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50">
                  <th className="text-left px-4 py-3 font-semibold text-slate-600 text-xs uppercase tracking-wider whitespace-nowrap sticky left-0 bg-slate-50 z-10 border-r border-slate-100">
                    No
                  </th>
                  <th className="text-left px-4 py-3 font-semibold text-slate-600 text-xs uppercase tracking-wider whitespace-nowrap sticky left-8 bg-slate-50 z-10 border-r border-slate-100 min-w-[160px]">
                    Nama Siswa
                  </th>
                  {mapelList.length > 0
                    ? mapelList.map(mp => (
                        <th
                          key={mp.mapel_id}
                          className="text-center px-3 py-3 font-semibold text-slate-600 text-xs whitespace-nowrap min-w-[120px]"
                        >
                          <div>{mp.nama_mapel}</div>
                          {mp.jadwal?.tanggal && (
                            <div className="font-normal text-slate-400 text-xs mt-0.5">
                              {new Date(mp.jadwal.tanggal).toLocaleDateString('id-ID', { day: '2-digit', month: 'short' })}
                            </div>
                          )}
                        </th>
                      ))
                    : (
                        <th className="text-center px-3 py-3 font-semibold text-slate-400 text-xs whitespace-nowrap min-w-[200px]">
                          — Belum ada mata pelajaran —
                        </th>
                      )
                  }
                </tr>
              </thead>
              <tbody>
                {/* Baris siswa selalu ditampilkan */}
                {(nilaiRekap.length > 0 ? nilaiRekap : siswaList.map(s => ({ nis: s.nis, nama: s.nama }))).map((row, idx) => (
                  <tr
                    key={row.nis as string}
                    className={`border-b border-slate-50 hover:bg-slate-50 transition-colors ${idx % 2 === 0 ? '' : 'bg-slate-50/30'}`}
                  >
                    <td className="px-4 py-3 text-slate-400 text-xs sticky left-0 bg-inherit z-10 border-r border-slate-100">
                      {idx + 1}
                    </td>
                    <td className="px-4 py-3 sticky left-8 bg-inherit z-10 border-r border-slate-100">
                      <div className="flex items-center gap-2">
                        <div className="w-7 h-7 rounded-lg bg-emerald-100 flex items-center justify-center text-emerald-700 text-xs font-bold flex-shrink-0">
                          {(row.nama as string).charAt(0)}
                        </div>
                        <div>
                          <div className="font-medium text-slate-800 text-xs whitespace-nowrap">{row.nama as string}</div>
                          <div className="text-slate-400 text-xs">{row.nis as string}</div>
                        </div>
                      </div>
                    </td>
                    {mapelList.length > 0
                      ? mapelList.map(mp => {
                          const v = row[mp.mapel_id]
                          if (!v || typeof v === 'string') {
                            return (
                              <td key={mp.mapel_id} className="px-3 py-3 text-center">
                                <span className="text-slate-300 text-xs">—</span>
                              </td>
                            )
                          }
                          const obj = v as { nilai: number; grade: string; lulus: boolean }
                          return (
                            <td key={mp.mapel_id} className="px-3 py-3 text-center">
                              <div className="flex flex-col items-center gap-1">
                                <span className={`text-sm font-bold ${nilaiColor(obj.nilai)}`}>{obj.nilai}</span>
                                <span className={`text-xs px-1.5 py-0.5 rounded-full border font-medium ${GRADE_STYLE[obj.grade] ?? 'bg-slate-100 text-slate-600 border-slate-200'}`}>
                                  {obj.grade}
                                </span>
                                <span className={`text-xs ${obj.lulus ? 'text-emerald-500' : 'text-red-500'}`}>
                                  {obj.lulus ? '✓ Lulus' : '✗ Tidak'}
                                </span>
                              </div>
                            </td>
                          )
                        })
                      : (
                          <td className="px-3 py-3 text-center">
                            <span className="text-slate-200 text-xs">—</span>
                          </td>
                        )
                    }
                  </tr>
                ))}

                {/* Baris kosong hanya jika betul-betul tidak ada siswa sama sekali */}
                {nilaiRekap.length === 0 && siswaList.length === 0 && (
                  <tr>
                    <td colSpan={mapelList.length + 2} className="text-center py-12 text-slate-400 text-sm">
                      Belum ada data siswa
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </div>
  )
}

function StatMini({ icon, bg, label, value }: {
  icon: React.ReactNode
  bg: string
  label: string
  value: string | number
}) {
  return (
    <div className="bg-white border border-slate-100 rounded-2xl shadow-sm p-4 flex items-center gap-3">
      <div className={`w-10 h-10 rounded-xl ${bg} flex items-center justify-center flex-shrink-0`}>
        {icon}
      </div>
      <div>
        <div className="text-xs text-slate-500">{label}</div>
        <div className="text-lg font-bold text-slate-900">{value}</div>
      </div>
    </div>
  )
}
