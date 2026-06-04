'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import {
  Shield, Play, Square, Clock, Copy, CheckCircle,
  RefreshCw, AlertTriangle, BookOpen, Users, Lock, Unlock
} from 'lucide-react'
import { apiRequest, formatDate } from '@/lib/utils'
import { PageLoader } from '@/components/ui'

interface SesiUjianInfo {
  id: string
  kode_sesi: string
  status: 'BERJALAN' | 'SELESAI'
  waktu_mulai: string
  jumlah_peserta: number
}

interface JadwalHariIni {
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
  nama_kelas: string
  sesi_ujian: SesiUjianInfo | null
}

function getMinutesUntilStart(jamMulai: string): number {
  const now = new Date()
  const [h, m] = jamMulai.split(':').map(Number)
  const start = new Date()
  start.setHours(h, m, 0, 0)
  return Math.floor((start.getTime() - now.getTime()) / 60000)
}

function isBolehMulai(j: JadwalHariIni): boolean {
  // Boleh mulai 15 menit sebelum jam mulai, atau jika sudah lewat jam mulai
  return getMinutesUntilStart(j.jam_mulai) <= 15
}

function KodeSesiDisplay({ kode }: { kode: string }) {
  const [copied, setCopied] = useState(false)

  function copyKode() {
    navigator.clipboard.writeText(kode)
    setCopied(true)
    setTimeout(() => setCopied(false), 2500)
  }

  return (
    <div className="flex flex-col items-center gap-4 py-6">
      <div className="text-sm font-semibold text-slate-500 uppercase tracking-widest">Kode Sesi Ujian</div>

      {/* Kode besar */}
      <div className="flex items-center gap-2">
        {kode.split('').map((char, i) => (
          <div
            key={i}
            className="w-11 h-14 rounded-xl bg-gradient-to-b from-emerald-500 to-emerald-600 flex items-center justify-center text-white text-2xl font-black shadow-lg select-all"
          >
            {char}
          </div>
        ))}
      </div>

      <button
        onClick={copyKode}
        className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all ${
          copied
            ? 'bg-emerald-100 text-emerald-700 border border-emerald-200'
            : 'bg-slate-100 text-slate-600 hover:bg-slate-200 border border-slate-200'
        }`}
      >
        {copied ? <CheckCircle className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
        {copied ? 'Tersalin!' : 'Salin Kode'}
      </button>

      <p className="text-xs text-slate-400 text-center max-w-xs">
        Bagikan kode ini kepada siswa untuk memasuki ruang ujian. Kode berlaku selama sesi berlangsung.
      </p>
    </div>
  )
}

function CountdownTimer({ jamMulai }: { jamMulai: string }) {
  const [minsLeft, setMinsLeft] = useState(getMinutesUntilStart(jamMulai))

  useEffect(() => {
    const t = setInterval(() => setMinsLeft(getMinutesUntilStart(jamMulai)), 30000)
    return () => clearInterval(t)
  }, [jamMulai])

  if (minsLeft <= 0) return null

  return (
    <div className="flex items-center gap-1.5 text-xs text-slate-500 bg-slate-50 px-3 py-1.5 rounded-lg">
      <Clock className="w-3.5 h-3.5" />
      Tombol aktif dalam <strong className="text-slate-700 mx-1">{minsLeft} menit</strong> lagi
    </div>
  )
}

export default function ModePengawasPage() {
  const [jadwal, setJadwal] = useState<JadwalHariIni[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [starting, setStarting] = useState<string | null>(null)
  const [stopping, setStopping] = useState<string | null>(null)
  const [confirmTutup, setConfirmTutup] = useState<JadwalHariIni | null>(null)
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null)

  const showToast = (msg: string, type: 'success' | 'error' = 'success') => {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 3500)
  }

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    else setRefreshing(true)
    try {
      const res = await apiRequest<{ data: JadwalHariIni[] }>('/api/guru/mode-pengawas')
      setJadwal(res.data ?? [])
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  // Auto-refresh tiap 60 detik
  useEffect(() => {
    const t = setInterval(() => load(true), 60000)
    return () => clearInterval(t)
  }, [load])

  async function handleMulai(j: JadwalHariIni) {
    setStarting(j.id)
    try {
      const res = await apiRequest<{ message: string; kodeSesi: string; sesiId: string; sudahAda?: boolean }>(
        '/api/guru/mode-pengawas',
        { method: 'POST', body: JSON.stringify({ jadwalId: j.id }) }
      )
      showToast(res.sudahAda ? 'Sesi sudah berjalan — kode ditampilkan.' : 'Sesi ujian berhasil dibuka!')
      await load(true)
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Gagal membuka sesi', 'error')
    } finally {
      setStarting(null)
    }
  }

  async function handleTutup(j: JadwalHariIni) {
    if (!j.sesi_ujian) return
    setStopping(j.id)
    try {
      await apiRequest('/api/guru/mode-pengawas/tutup', {
        method: 'POST',
        body: JSON.stringify({ sesiId: j.sesi_ujian.id }),
      })
      showToast('Sesi ujian berhasil ditutup.')
      await load(true)
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Gagal menutup sesi', 'error')
    } finally {
      setStopping(null)
      setConfirmTutup(null)
    }
  }

  if (loading) return <PageLoader />

  const todayStr = new Date().toLocaleDateString('id-ID', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' })

  return (
    <div className="space-y-8 animate-fade-in pb-10 max-w-3xl mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <div className="w-8 h-8 rounded-lg bg-orange-600 flex items-center justify-center">
              <Shield className="w-4 h-4 text-white" />
            </div>
            <span className="text-xs font-semibold text-orange-600 uppercase tracking-wider">Mode Pengawas</span>
          </div>
          <h1 className="text-2xl font-bold text-slate-900">Pengawasan Ujian</h1>
          <p className="text-slate-500 text-sm mt-0.5">{todayStr}</p>
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

      {/* Empty state */}
      {jadwal.length === 0 && (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <div className="w-20 h-20 rounded-full bg-slate-100 flex items-center justify-center mb-4">
            <Shield className="w-10 h-10 text-slate-300" />
          </div>
          <h3 className="text-lg font-semibold text-slate-600">Tidak Ada Jadwal Hari Ini</h3>
          <p className="text-slate-400 text-sm mt-1">Anda tidak memiliki jadwal pengawasan hari ini.</p>
        </div>
      )}

      {/* Jadwal Cards */}
      <div className="space-y-5">
        {jadwal.map(j => {
          const boleh = isBolehMulai(j)
          const isRunning = j.status === 'BERJALAN' && j.sesi_ujian?.status === 'BERJALAN'
          const isDone = j.status === 'SELESAI'
          const minsLeft = getMinutesUntilStart(j.jam_mulai)

          return (
            <div
              key={j.id}
              className={`bg-white rounded-2xl border shadow-sm overflow-hidden transition-all ${
                isRunning ? 'border-amber-300 ring-2 ring-amber-100 shadow-amber-50' :
                isDone    ? 'border-slate-100 opacity-75' :
                            'border-slate-100 hover:shadow-md'
              }`}
            >
              {/* Running indicator bar */}
              {isRunning && (
                <div className="h-1 bg-gradient-to-r from-amber-400 via-orange-400 to-amber-400 animate-pulse" />
              )}

              <div className="p-5">
                {/* Top row */}
                <div className="flex items-start justify-between gap-3 mb-4">
                  <div>
                    <h3 className="font-bold text-slate-900 text-lg">{j.nama_mapel}</h3>
                    <div className="flex items-center gap-3 mt-1 text-sm text-slate-500 flex-wrap">
                      <span className="flex items-center gap-1"><Users className="w-3.5 h-3.5" />Kelas {j.nama_kelas}</span>
                      <span className="flex items-center gap-1"><BookOpen className="w-3.5 h-3.5" />Sesi {j.sesi}</span>
                      <span className="flex items-center gap-1"><Clock className="w-3.5 h-3.5" />{j.jam_mulai} – {j.jam_selesai}</span>
                      <span className="text-slate-400">{j.durasi} menit</span>
                    </div>
                  </div>

                  {/* Status chip */}
                  <span className={`text-xs px-2.5 py-1 rounded-full font-semibold flex-shrink-0 ${
                    isRunning ? 'bg-amber-100 text-amber-700' :
                    isDone    ? 'bg-emerald-100 text-emerald-700' :
                                'bg-blue-100 text-blue-700'
                  }`}>
                    {isRunning ? '● Berlangsung' : isDone ? '✓ Selesai' : '◷ Akan Datang'}
                  </span>
                </div>

                {/* Kode sesi (jika running) */}
                {isRunning && j.sesi_ujian && (
                  <div className="bg-slate-50 border border-slate-100 rounded-2xl mb-4">
                    <KodeSesiDisplay kode={j.sesi_ujian.kode_sesi} />
                    <div className="border-t border-slate-100 px-4 py-2 flex items-center justify-between text-xs text-slate-400">
                      <span>Peserta masuk: <strong className="text-slate-600">{j.sesi_ujian.jumlah_peserta}</strong></span>
                      <span>Mulai: {new Date(j.sesi_ujian.waktu_mulai).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}</span>
                    </div>
                  </div>
                )}

                {/* Done info */}
                {isDone && (
                  <div className="flex items-center gap-2 text-sm text-emerald-600 bg-emerald-50 px-4 py-3 rounded-xl mb-4">
                    <CheckCircle className="w-4 h-4 flex-shrink-0" />
                    Ujian telah selesai dilaksanakan.
                  </div>
                )}

                {/* Action buttons */}
                {!isDone && (
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    {/* Countdown / info */}
                    {!isRunning && !boleh && <CountdownTimer jamMulai={j.jam_mulai} />}
                    {!isRunning && boleh && (
                      <div className="flex items-center gap-1.5 text-xs text-emerald-600 bg-emerald-50 px-3 py-1.5 rounded-lg font-medium">
                        <Unlock className="w-3.5 h-3.5" />
                        Siap dimulai
                      </div>
                    )}
                    {isRunning && <div className="flex-1" />}

                    <div className="flex items-center gap-2">
                      {/* Tombol Mulai */}
                      {!isRunning && (
                        <button
                          onClick={() => handleMulai(j)}
                          disabled={!boleh || starting === j.id}
                          className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold transition-all shadow-sm ${
                            boleh
                              ? 'bg-emerald-600 hover:bg-emerald-700 text-white'
                              : 'bg-slate-100 text-slate-400 cursor-not-allowed'
                          }`}
                        >
                          {starting === j.id
                            ? <RefreshCw className="w-4 h-4 animate-spin" />
                            : boleh ? <Play className="w-4 h-4" /> : <Lock className="w-4 h-4" />
                          }
                          {starting === j.id ? 'Memulai...' : 'Mulai Ujian'}
                        </button>
                      )}

                      {/* Tombol Tutup */}
                      {isRunning && (
                        <button
                          onClick={() => setConfirmTutup(j)}
                          disabled={stopping === j.id}
                          className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold bg-red-600 hover:bg-red-700 text-white transition-all shadow-sm"
                        >
                          {stopping === j.id
                            ? <RefreshCw className="w-4 h-4 animate-spin" />
                            : <Square className="w-4 h-4" />
                          }
                          {stopping === j.id ? 'Menutup...' : 'Tutup Sesi'}
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* Confirm Tutup Dialog */}
      {confirmTutup && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl max-w-sm w-full p-6 animate-fade-in">
            <div className="w-12 h-12 rounded-full bg-red-100 flex items-center justify-center mx-auto mb-4">
              <AlertTriangle className="w-6 h-6 text-red-600" />
            </div>
            <h3 className="text-lg font-bold text-slate-900 text-center mb-2">Tutup Sesi Ujian?</h3>
            <p className="text-sm text-slate-500 text-center mb-1">
              <strong>{confirmTutup.nama_mapel}</strong> — Kelas {confirmTutup.nama_kelas}
            </p>
            <p className="text-xs text-slate-400 text-center mb-6">
              Semua siswa yang masih mengerjakan akan dianggap selesai. Tindakan ini tidak dapat dibatalkan.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setConfirmTutup(null)}
                className="flex-1 px-4 py-2.5 rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50 text-sm font-medium"
              >
                Batal
              </button>
              <button
                onClick={() => handleTutup(confirmTutup)}
                disabled={stopping === confirmTutup.id}
                className="flex-1 px-4 py-2.5 rounded-xl bg-red-600 hover:bg-red-700 text-white text-sm font-semibold"
              >
                {stopping === confirmTutup.id ? 'Menutup...' : 'Ya, Tutup'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className={`fixed bottom-6 right-6 z-50 flex items-center gap-3 px-4 py-3 rounded-2xl shadow-lg text-sm font-medium animate-fade-in ${
          toast.type === 'success' ? 'bg-emerald-600 text-white' : 'bg-red-600 text-white'
        }`}>
          {toast.type === 'success' ? <CheckCircle className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />}
          {toast.msg}
        </div>
      )}
    </div>
  )
}
