// PERF: modal Aktivitas dipisah dari src/app/login/page.tsx supaya bisa
// di-lazy-load lewat next/dynamic({ ssr: false }). Fetch data aktivitas juga
// dipindah ke dalam komponen ini (jalan otomatis saat modal dibuka/mount),
// sehingga parent (page.tsx) tidak perlu lagi menyimpan state ini.
'use client'

import { useEffect, useState } from 'react'
import {
  X, Activity, Radio, CalendarDays, Trophy, Loader2,
  ClipboardList, GraduationCap, Users, Clock,
} from 'lucide-react'

interface UjianBerlangsung {
  id: string
  mapel: string
  kelas: string
  sekolah: string
  pengawas: string
  waktu_mulai: string
}

interface JadwalItem {
  id: string
  tanggal: string
  tanggal_raw: string
  jam: string
  mapel: string
  kelas: string
  sekolah: string
  status: string
  isToday: boolean
}

interface JuaraItem {
  kelas: string
  sekolah: string
  nama_siswa: string
  nilai_rata: number
}

interface AktivitasModalProps {
  onClose: () => void
}

export default function AktivitasModal({ onClose }: AktivitasModalProps) {
  const [aktivitasLoading, setAktivitasLoading] = useState(false)
  const [ujianBerlangsung, setUjianBerlangsung] = useState<UjianBerlangsung[]>([])
  const [jadwalList, setJadwalList] = useState<JadwalItem[]>([])
  const [juaraList, setJuaraList] = useState<JuaraItem[]>([])
  const [aktivitasTab, setAktivitasTab] = useState<'ujian' | 'jadwal' | 'juara'>('ujian')

  async function loadAktivitas() {
    setAktivitasLoading(true)
    try {
      const res = await fetch('/api/public/aktivitas?t=' + Date.now(), { cache: 'no-store' })
      const json = await res.json()
      setUjianBerlangsung(json.ujianBerlangsung || [])
      setJadwalList(json.jadwal || [])
      setJuaraList(json.juaraPerKelas || [])
    } catch { /* ignore */ } finally {
      setAktivitasLoading(false)
    }
  }

  useEffect(() => {
    loadAktivitas()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backdropFilter: 'blur(8px)', background: 'rgba(10,4,30,0.82)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden">

        {/* Header */}
        <div className="px-5 sm:px-6 py-4 sm:py-5 border-b border-slate-100 flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center flex-shrink-0">
              <Activity className="w-4 h-4 sm:w-5 sm:h-5 text-white" />
            </div>
            <div>
              <h2 className="font-bold text-slate-900 text-base sm:text-lg">Aktivitas Ujian</h2>
              <p className="text-xs text-slate-400">Informasi real-time sekolah</p>
            </div>
          </div>
          <button type="button" onClick={onClose}
            className="w-8 h-8 rounded-full flex items-center justify-center text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors flex-shrink-0">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tab bar */}
        <div className="flex gap-1 px-5 sm:px-6 pt-3 pb-0 flex-shrink-0 overflow-x-auto">
          {[
            { key: 'ujian', label: 'Ujian Berlangsung', icon: <Radio className="w-3.5 h-3.5" /> },
            { key: 'jadwal', label: 'Jadwal Hari Ini & Besok', icon: <CalendarDays className="w-3.5 h-3.5" /> },
            { key: 'juara', label: 'Juara Per Kelas', icon: <Trophy className="w-3.5 h-3.5" /> },
          ].map(tab => (
            <button key={tab.key} type="button"
              onClick={() => setAktivitasTab(tab.key as typeof aktivitasTab)}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-t-xl text-xs font-semibold border-b-2 transition-all whitespace-nowrap ${
                aktivitasTab === tab.key
                  ? 'border-emerald-500 text-emerald-700 bg-emerald-50'
                  : 'border-transparent text-slate-400 hover:text-slate-600 hover:bg-slate-50'
              }`}
            >
              {tab.icon}
              <span className="hidden sm:inline">{tab.label}</span>
              <span className="sm:hidden">{tab.key === 'ujian' ? 'Live' : tab.key === 'jadwal' ? 'Jadwal' : 'Juara'}</span>
            </button>
          ))}
        </div>
        <div className="h-px bg-slate-100 flex-shrink-0 mx-5 sm:mx-6" />

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5 sm:p-6">
          {aktivitasLoading ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3 text-slate-400">
              <Loader2 className="w-8 h-8 animate-spin text-emerald-400" />
              <p className="text-sm">Memuat data...</p>
            </div>
          ) : (
            <>
              {/* ── Tab: Ujian Berlangsung ── */}
              {aktivitasTab === 'ujian' && (
                <div>
                  {ujianBerlangsung.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-14 gap-3">
                      <div className="w-14 h-14 rounded-2xl bg-slate-100 flex items-center justify-center">
                        <Radio className="w-7 h-7 text-slate-300" />
                      </div>
                      <p className="text-slate-400 text-sm font-medium">Tidak ada ujian yang sedang berlangsung</p>
                      <p className="text-slate-300 text-xs">Ujian aktif akan muncul di sini secara real-time</p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <div className="flex items-center gap-2 mb-3">
                        <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-red-50 border border-red-200 text-red-600 text-xs font-semibold">
                          <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                          {ujianBerlangsung.length} sesi aktif
                        </span>
                      </div>
                      {ujianBerlangsung.map(u => (
                        <div key={u.id} className="rounded-2xl border border-emerald-200 bg-gradient-to-br from-emerald-50 to-teal-50 p-4">
                          <div className="flex items-start gap-3">
                            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center flex-shrink-0">
                              <ClipboardList className="w-4 h-4 text-white" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="font-bold text-slate-900 text-sm">{u.mapel}</p>
                              <div className="flex flex-wrap gap-x-4 gap-y-0.5 mt-1">
                                <span className="flex items-center gap-1 text-xs text-slate-500">
                                  <GraduationCap className="w-3 h-3" /> Kelas {u.kelas}
                                </span>
                                {u.sekolah && u.sekolah !== '-' && (
                                  <span className="px-1.5 py-0.5 rounded-md bg-emerald-100 text-emerald-700 text-[10px] font-semibold">
                                    {u.sekolah}
                                  </span>
                                )}
                                <span className="flex items-center gap-1 text-xs text-slate-500">
                                  <Users className="w-3 h-3" /> Pengawas: <span className="font-medium text-slate-700 ml-1">{u.pengawas}</span>
                                </span>
                                <span className="flex items-center gap-1 text-xs text-slate-400">
                                  <Clock className="w-3 h-3" /> Mulai: {new Date(u.waktu_mulai).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}
                                </span>
                              </div>
                            </div>
                            <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-100 text-red-600 text-[10px] font-bold flex-shrink-0">
                              <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" /> LIVE
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* ── Tab: Jadwal Hari Ini & Besok ── */}
              {aktivitasTab === 'jadwal' && (
                <div>
                  {jadwalList.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-14 gap-3">
                      <div className="w-14 h-14 rounded-2xl bg-slate-100 flex items-center justify-center">
                        <CalendarDays className="w-7 h-7 text-slate-300" />
                      </div>
                      <p className="text-slate-400 text-sm font-medium">Tidak ada jadwal untuk hari ini dan besok</p>
                    </div>
                  ) : (
                    <div className="space-y-5">
                      {(['today', 'tomorrow'] as const).map(which => {
                        const items = jadwalList.filter(j => which === 'today' ? j.isToday : !j.isToday)
                        if (items.length === 0) return null
                        const tanggalLabel = items[0].tanggal
                        const label = which === 'today' ? 'Hari Ini' : 'Besok'
                        return (
                          <div key={which}>
                            <div className={`flex items-center gap-2 px-3 py-2 rounded-xl mb-3 ${which === 'today' ? 'bg-blue-50' : 'bg-amber-50'}`}>
                              <CalendarDays className={`w-4 h-4 ${which === 'today' ? 'text-blue-500' : 'text-amber-500'}`} />
                              <span className={`font-semibold text-sm ${which === 'today' ? 'text-blue-700' : 'text-amber-700'}`}>{label}</span>
                              <span className={`text-xs ${which === 'today' ? 'text-blue-400' : 'text-amber-400'}`}>— {tanggalLabel}</span>
                            </div>
                            <div className="space-y-2">
                              {items.map(j => (
                                <div key={j.id} className="rounded-xl border border-slate-200 bg-white p-3.5 flex items-center gap-3">
                                  <div className={`w-1 self-stretch rounded-full flex-shrink-0 ${
                                    j.status === 'BERJALAN' ? 'bg-emerald-400' : j.status === 'SELESAI' ? 'bg-slate-300' : 'bg-blue-400'
                                  }`} />
                                  <div className="flex-1 min-w-0">
                                    <p className="font-semibold text-slate-800 text-sm">{j.mapel}</p>
                                    <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-0.5">
                                      <span className="flex items-center gap-1 text-xs text-slate-500">
                                        <GraduationCap className="w-3 h-3" /> Kelas {j.kelas}
                                      </span>
                                      {j.sekolah && j.sekolah !== '-' && (
                                        <span className="px-1.5 py-0.5 rounded-md bg-blue-100 text-blue-700 text-[10px] font-semibold">
                                          {j.sekolah}
                                        </span>
                                      )}
                                      <span className="flex items-center gap-1 text-xs text-slate-500">
                                        <Clock className="w-3 h-3" /> {j.jam}
                                      </span>
                                    </div>
                                  </div>
                                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold flex-shrink-0 ${
                                    j.status === 'BERJALAN' ? 'bg-emerald-100 text-emerald-700' :
                                    j.status === 'SELESAI' ? 'bg-slate-100 text-slate-500' :
                                    'bg-blue-100 text-blue-700'
                                  }`}>
                                    {j.status === 'BERJALAN' ? 'Berlangsung' : j.status === 'SELESAI' ? 'Selesai' : 'Terjadwal'}
                                  </span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* ── Tab: Juara Per Kelas ── */}
              {aktivitasTab === 'juara' && (
                <div>
                  {juaraList.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-14 gap-3">
                      <div className="w-14 h-14 rounded-2xl bg-slate-100 flex items-center justify-center">
                        <Trophy className="w-7 h-7 text-slate-300" />
                      </div>
                      <p className="text-slate-400 text-sm font-medium">Belum ada data nilai untuk ditampilkan</p>
                      <p className="text-slate-300 text-xs">Juara per kelas dihitung dari akumulasi semua mata pelajaran</p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <p className="text-xs text-slate-400 mb-3">Berdasarkan rata-rata nilai akumulasi semua mata pelajaran</p>
                      {juaraList.map((j, idx) => (
                        <div key={j.kelas} className="rounded-2xl border border-slate-200 bg-white p-4 flex items-center gap-4">
                          <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${
                            idx === 0 ? 'bg-gradient-to-br from-yellow-400 to-amber-500' :
                            idx === 1 ? 'bg-gradient-to-br from-slate-400 to-slate-500' :
                            idx === 2 ? 'bg-gradient-to-br from-orange-400 to-amber-600' :
                            'bg-gradient-to-br from-slate-100 to-slate-200'
                          }`}>
                            {idx < 3
                              ? <Trophy className="w-5 h-5 text-white" />
                              : <span className="text-xs font-bold text-slate-500">{idx + 1}</span>
                            }
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="font-bold text-slate-900 text-sm">{j.nama_siswa}</p>
                            <p className="text-xs text-slate-400 mt-0.5 flex items-center gap-1.5">
                              <span className="flex items-center gap-1"><GraduationCap className="w-3 h-3" /> Kelas {j.kelas}</span>
                              {j.sekolah && j.sekolah !== '-' && (
                                <span className="px-1.5 py-0.5 rounded-md bg-amber-100 text-amber-700 text-[10px] font-semibold">
                                  {j.sekolah}
                                </span>
                              )}
                            </p>
                          </div>
                          <div className="text-right flex-shrink-0">
                            <p className={`text-2xl font-black ${
                              j.nilai_rata >= 90 ? 'text-emerald-600' :
                              j.nilai_rata >= 75 ? 'text-blue-600' :
                              'text-orange-500'
                            }`}>{j.nilai_rata}</p>
                            <p className="text-[10px] text-slate-400">rata-rata</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 sm:px-6 py-3 sm:py-4 border-t border-slate-100 flex items-center justify-between flex-shrink-0 gap-2">
          <button type="button" onClick={loadAktivitas} disabled={aktivitasLoading}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-200 text-slate-500 hover:bg-slate-50 text-xs font-medium transition-all disabled:opacity-50">
            <Loader2 className={`w-3.5 h-3.5 ${aktivitasLoading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
          <button type="button" onClick={onClose}
            className="px-5 py-2 rounded-xl bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 transition-colors">
            Tutup
          </button>
        </div>
      </div>
    </div>
  )
}
