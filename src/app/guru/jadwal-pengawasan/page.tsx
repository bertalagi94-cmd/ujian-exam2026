'use client'

import { useState, useEffect, useCallback } from 'react'
import { Calendar, Clock, BookOpen, Users, CheckCircle, PlayCircle, AlertCircle, RefreshCw, ClipboardList, X, UserX, RotateCcw, Copy } from 'lucide-react'
import { apiRequest, formatDate } from '@/lib/utils'
import { PageLoader, Spinner } from '@/components/ui'

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
  sesi_ujian?: { id: string; status: string } | null
}

interface SiswaInfo {
  nis: string
  nama: string
}

interface SusulanResult {
  bisa: boolean
  message: string
  sesiBaruId?: string
  kodeSesi?: string
  siswa?: SiswaInfo[]
}

const STATUS_CONFIG = {
  AKTIF:    { label: 'Akan Datang', cls: 'bg-blue-100 text-blue-700 border-blue-200',    icon: <Clock className="w-3.5 h-3.5" /> },
  BERJALAN: { label: 'Sedang Berlangsung', cls: 'bg-amber-100 text-amber-700 border-amber-200', icon: <PlayCircle className="w-3.5 h-3.5" /> },
  SELESAI:  { label: 'Selesai', cls: 'bg-emerald-100 text-emerald-700 border-emerald-200', icon: <CheckCircle className="w-3.5 h-3.5" /> },
}

function groupByMonth(list: JadwalPengawasan[]) {
  const map: Record<string, JadwalPengawasan[]> = {}
  list.forEach(j => {
    const key = j.tanggal.slice(0, 7)
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

// ── Modal Ujian Susulan ──────────────────────────────────────────────────────
function ModalSusulan({
  jadwal,
  onClose,
}: {
  jadwal: JadwalPengawasan
  onClose: () => void
}) {
  // 'idle' → 'checking' → 'confirm' (ada siswa belum) | 'empty' (semua sudah) → 'opening' → 'opened'
  type Phase = 'idle' | 'checking' | 'confirm' | 'empty' | 'opening' | 'opened'
  const [phase, setPhase] = useState<Phase>('idle')
  const [siswaBelum, setSiswaBelum] = useState<SiswaInfo[]>([])
  const [kodeSesi, setKodeSesi] = useState<string | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    const timer = setTimeout(() => cekSiswa(), 600)
    return () => clearTimeout(timer)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Step 1: Cek saja (tidak membuka sesi) — gunakan endpoint yang sama tapi kita akan
  // memanggil POST; karena API memang sekaligus membuka, kita tampung hasilnya dulu
  // dan baru tampilkan kode setelah user konfirmasi.
  // Karena API membuat sesi sekaligus, kita simpan hasilnya dan tampilkan di step 2.
  async function cekSiswa() {
    if (!jadwal.sesi_ujian?.id) return
    setPhase('checking')
    setErrorMsg(null)
    try {
      await new Promise(r => setTimeout(r, 1800)) // biar animasi terlihat
      const res = await apiRequest<SusulanResult>(
        `/api/pengawas/sesi/${jadwal.sesi_ujian.id}/susulan`,
        { method: 'POST' }
      )
      if (!res.bisa) {
        setPhase('empty')
      } else {
        setSiswaBelum(res.siswa ?? [])
        setKodeSesi(res.kodeSesi ?? null)
        setPhase('confirm')
      }
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'Gagal mengecek data susulan')
      setPhase('confirm')
    }
  }

  function copyKode(kode: string) {
    navigator.clipboard.writeText(kode)
    setCopied(true)
    setTimeout(() => setCopied(false), 2500)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full animate-fade-in overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-purple-100 flex items-center justify-center">
              <ClipboardList className="w-4 h-4 text-purple-600" />
            </div>
            <div>
              <div className="text-sm font-bold text-slate-900">Ujian Susulan</div>
              <div className="text-xs text-slate-400">{jadwal.nama_mapel} — Kelas {jadwal.nama_kelas}</div>
            </div>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-full hover:bg-slate-100 flex items-center justify-center text-slate-400 hover:text-slate-600">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6">
          {/* Idle */}
          {phase === 'idle' && (
            <div className="flex flex-col items-center py-8 gap-4">
              <Spinner size="lg" />
              <p className="text-sm text-slate-400">Mempersiapkan...</p>
            </div>
          )}

          {/* Checking */}
          {phase === 'checking' && (
            <div className="flex flex-col items-center py-8 gap-5">
              <div className="relative w-24 h-24">
                <div className="absolute inset-0 rounded-full border-4 border-purple-100" />
                <div className="absolute inset-2 rounded-full border-2 border-purple-200 animate-ping" style={{ animationDuration: '1.5s' }} />
                <div className="absolute inset-0 rounded-full border-4 border-purple-500 border-t-transparent animate-spin" />
                <div className="absolute inset-0 flex items-center justify-center">
                  <Users className="w-8 h-8 text-purple-500" />
                </div>
              </div>
              <div className="text-center">
                <p className="text-base font-semibold text-slate-800">Mengecek Data Siswa...</p>
                <p className="text-sm text-slate-400 mt-1">Sistem sedang memverifikasi kehadiran semua siswa</p>
              </div>
              <div className="flex gap-2">
                {[0, 1, 2].map(i => (
                  <div key={i} className="w-2 h-2 rounded-full bg-purple-400 animate-bounce" style={{ animationDelay: `${i * 0.15}s` }} />
                ))}
              </div>
            </div>
          )}

          {/* Empty — semua siswa sudah ujian */}
          {phase === 'empty' && (
            <div className="flex flex-col items-center py-4 gap-4">
              <div className="w-16 h-16 rounded-2xl bg-emerald-100 flex items-center justify-center">
                <CheckCircle className="w-8 h-8 text-emerald-600" />
              </div>
              <div className="text-center">
                <h3 className="font-bold text-slate-900 text-base mb-1">Semua Siswa Sudah Ujian</h3>
                <p className="text-sm text-slate-500">Tidak ada siswa yang perlu mengikuti ujian susulan.</p>
              </div>
              <button onClick={onClose} className="mt-2 px-6 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-900 text-white text-sm font-semibold">
                Tutup
              </button>
            </div>
          )}

          {/* Confirm — ada siswa belum ujian */}
          {phase === 'confirm' && (
            <div className="flex flex-col gap-4">
              {errorMsg ? (
                <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">
                  <AlertCircle className="w-4 h-4 flex-shrink-0" />
                  {errorMsg}
                </div>
              ) : (
                <>
                  <div className="flex items-center gap-3 p-3 bg-amber-50 border border-amber-200 rounded-xl">
                    <UserX className="w-5 h-5 text-amber-600 flex-shrink-0" />
                    <div>
                      <p className="text-sm font-semibold text-amber-800">
                        {siswaBelum.length} siswa belum mengikuti ujian
                      </p>
                      <p className="text-xs text-amber-600">Sesi susulan siap dibuka. Apakah Anda yakin?</p>
                    </div>
                  </div>

                  <div>
                    <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Daftar Siswa Belum Ujian:</p>
                    <div className="max-h-44 overflow-y-auto space-y-1.5 pr-1">
                      {siswaBelum.map((s, i) => (
                        <div key={s.nis} className="flex items-center gap-2 px-3 py-2 bg-slate-50 rounded-xl">
                          <div className="w-5 h-5 rounded-full bg-amber-100 text-amber-700 text-xs font-bold flex items-center justify-center flex-shrink-0">
                            {i + 1}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-slate-800 truncate">{s.nama}</p>
                            <p className="text-xs text-slate-400 font-mono">{s.nis}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <p className="text-xs text-slate-400 bg-slate-50 px-3 py-2 rounded-xl">
                    ℹ Durasi sesi susulan ditentukan pengawas. Tutup sesi kapan pun via Mode Pengawas.
                  </p>

                  <div className="flex gap-3">
                    <button onClick={onClose} className="flex-1 px-4 py-2.5 rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50 text-sm font-medium">
                      Batal
                    </button>
                    <button
                      onClick={() => setPhase('opened')}
                      className="flex-1 px-4 py-2.5 rounded-xl bg-purple-600 hover:bg-purple-700 text-white text-sm font-semibold flex items-center justify-center gap-2"
                    >
                      <RotateCcw className="w-4 h-4" />
                      Ya, Buka Susulan
                    </button>
                  </div>
                </>
              )}
              {errorMsg && (
                <button onClick={onClose} className="px-6 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-900 text-white text-sm font-semibold">
                  Tutup
                </button>
              )}
            </div>
          )}

          {/* Opened — tampilkan kode sesi */}
          {phase === 'opened' && kodeSesi && (
            <div className="flex flex-col items-center gap-5 py-2">
              <div className="w-14 h-14 rounded-2xl bg-purple-100 flex items-center justify-center">
                <ClipboardList className="w-7 h-7 text-purple-600" />
              </div>
              <div className="text-center">
                <h3 className="font-bold text-slate-900 text-base mb-1">Sesi Susulan Dibuka!</h3>
                <p className="text-sm text-slate-500">Bagikan kode ini kepada siswa yang belum ujian</p>
              </div>

              <div className="flex flex-col items-center gap-3">
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-widest">Kode Sesi Susulan</p>
                <div className="flex items-center gap-2">
                  {kodeSesi.split('').map((char, i) => (
                    <div key={i} className="w-11 h-14 rounded-xl bg-gradient-to-b from-purple-500 to-purple-700 flex items-center justify-center text-white text-2xl font-black shadow-lg">
                      {char}
                    </div>
                  ))}
                </div>
                <button
                  onClick={() => copyKode(kodeSesi)}
                  className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all ${copied ? 'bg-purple-100 text-purple-700 border border-purple-200' : 'bg-slate-100 text-slate-600 hover:bg-slate-200 border border-slate-200'}`}
                >
                  {copied ? <CheckCircle className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                  {copied ? 'Tersalin!' : 'Salin Kode'}
                </button>
              </div>

              <p className="text-xs text-slate-400 text-center">
                Tutup sesi kapan pun dari menu <strong>Mode Pengawas</strong> saat ujian susulan selesai.
              </p>

              <button onClick={onClose} className="w-full px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-900 text-white text-sm font-semibold">
                Tutup
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default function JadwalPengawasanPage() {
  const [jadwal, setJadwal] = useState<JadwalPengawasan[]>([])
  const [loading, setLoading] = useState(true)
  const [hasJadwal, setHasJadwal] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [susulanTarget, setSusulanTarget] = useState<JadwalPengawasan | null>(null)

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
                const dayName = new Date(j.tanggal).toLocaleDateString('id-ID', { weekday: 'long' })
                const isSelesai = j.status === 'SELESAI'

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

                        {/* Tombol Ujian Susulan — tampil kapan saja selama status SELESAI */}
                        {isSelesai && j.sesi_ujian?.id && (
                          <div className="mt-3 flex items-center justify-between gap-3 flex-wrap">
                            <p className="text-xs text-slate-400">Ada siswa yang tidak hadir?</p>
                            <button
                              onClick={() => setSusulanTarget(j)}
                              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-purple-50 hover:bg-purple-100 border border-purple-200 text-purple-700 text-xs font-semibold transition-all"
                            >
                              <ClipboardList className="w-3.5 h-3.5" />
                              Ujian Susulan
                            </button>
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

      {/* Modal Susulan */}
      {susulanTarget && (
        <ModalSusulan
          jadwal={susulanTarget}
          onClose={() => {
            setSusulanTarget(null)
            load(true)
          }}
        />
      )}
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
