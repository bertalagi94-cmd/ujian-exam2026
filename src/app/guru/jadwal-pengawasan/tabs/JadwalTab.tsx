'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { Calendar, Clock, Users, CheckCircle, PlayCircle, AlertCircle, RefreshCw, ClipboardList, X, UserX, RotateCcw, Copy } from 'lucide-react'
import { apiRequest } from '@/lib/utils'
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
  konflik?: boolean       // guru masih punya sesi lain yang berjalan
  sudahBerjalan?: boolean // sudah ada sesi berjalan untuk jadwal ini
  sesiAktifId?: string
  error?: string
}

const STATUS_CONFIG = {
  AKTIF:    { label: 'Akan Datang', pendek: 'Akan datang', cls: 'bg-blue-100 text-blue-700 border-blue-200',    icon: <Clock className="w-3.5 h-3.5" /> },
  BERJALAN: { label: 'Sedang Berlangsung', pendek: 'Berlangsung', cls: 'bg-amber-100 text-amber-700 border-amber-200', icon: <PlayCircle className="w-3.5 h-3.5" /> },
  SELESAI:  { label: 'Selesai', pendek: 'Selesai', cls: 'bg-emerald-100 text-emerald-700 border-emerald-200', icon: <CheckCircle className="w-3.5 h-3.5" /> },
}

// Format tanggal ringkas, mis. "Kam, 19 Nov 2026". Pakai UTC supaya tidak
// bergeser sehari di perangkat dengan zona waktu lain.
function tanggalPendek(tanggal: string): string {
  return new Date(`${tanggal}T00:00:00Z`).toLocaleDateString('id-ID', {
    weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC',
  })
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

// Zona waktu sekolah (offset jam dari UTC), dikirim oleh server lewat API
// /api/guru/jadwal-pengawasan — JANGAN dihitung dari timezone browser,
// karena guru bisa membuka aplikasi dari device dengan timezone berbeda
// (misalnya laptop yang salah-set, atau guru yang sedang di luar kota).
// Status ujian harus satu kebenaran tunggal yang sama untuk semua orang,
// ditentukan oleh lokasi SEKOLAH, bukan lokasi/perangkat masing-masing guru.
interface ZonaWaktuInfo {
  utcOffsetJam: number
  label: string
}

const ZONA_FALLBACK: ZonaWaktuInfo = { utcOffsetJam: 7, label: 'WIB (UTC+7)' }

// Tanggal "hari ini" pada zona waktu sekolah (bukan UTC, bukan timezone browser)
function tanggalHariIniDiZona(zona: ZonaWaktuInfo, now: Date): string {
  const shifted = new Date(now.getTime() + zona.utcOffsetJam * 60 * 60 * 1000)
  return shifted.toISOString().slice(0, 10)
}

function isToday(dateStr: string, zona: ZonaWaktuInfo, now: Date) {
  return dateStr === tanggalHariIniDiZona(zona, now)
}

function isPast(dateStr: string, zona: ZonaWaktuInfo, now: Date) {
  return dateStr < tanggalHariIniDiZona(zona, now)
}

// Kembalikan true jika sekarang sudah 15 menit sebelum jam_mulai (dan belum lewat jam_selesai)
function canStartSesi(tanggal: string, jamMulai: string, jamSelesai: string, now: Date, zona: ZonaWaktuInfo): boolean {
  if (!isToday(tanggal, zona, now)) return false
  const offsetStr = `+${String(zona.utcOffsetJam).padStart(2, '0')}:00`
  const mulaiMs   = new Date(`${tanggal}T${jamMulai}:00${offsetStr}`).getTime() - 15 * 60 * 1000
  const selesaiMs = new Date(`${tanggal}T${jamSelesai}:00${offsetStr}`).getTime()
  const nowMs = now.getTime()
  return nowMs >= mulaiMs && nowMs < selesaiMs
}

// Hitung sisa menit sebelum boleh mulai (negatif = sudah boleh)
function menitMenunggu(tanggal: string, jamMulai: string, now: Date, zona: ZonaWaktuInfo): number {
  if (!isToday(tanggal, zona, now)) return 999
  const offsetStr = `+${String(zona.utcOffsetJam).padStart(2, '0')}:00`
  const mulaiMs = new Date(`${tanggal}T${jamMulai}:00${offsetStr}`).getTime() - 15 * 60 * 1000
  return Math.ceil((mulaiMs - now.getTime()) / 60000)
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

  // Step 1: Panggil API susulan berdasarkan jadwal_id (mode CEK / dry-run — tidak insert apa pun)
  async function cekSiswa() {
    setPhase('checking')
    setErrorMsg(null)
    try {
      await new Promise(r => setTimeout(r, 1800))
      const res = await apiRequest<SusulanResult>(
        `/api/guru/susulan`,
        { method: 'POST', body: JSON.stringify({ jadwalId: jadwal.id }) }
      )
      // Guru masih memiliki sesi aktif di jadwal lain — blokir
      if (res.konflik || res.error) {
        setErrorMsg(res.error ?? res.message ?? 'Tidak dapat membuka sesi susulan.')
        setPhase('confirm')
        return
      }
      // Sudah ada sesi berjalan untuk jadwal ini (mungkin re-open)
      if (res.sudahBerjalan) {
        setKodeSesi(res.kodeSesi ?? null)
        setPhase('confirm')
        setErrorMsg(res.message ?? 'Sudah ada sesi yang sedang berjalan.')
        return
      }
      if (!res.bisa) {
        setPhase('empty')
      } else {
        setSiswaBelum(res.siswa ?? [])
        setKodeSesi(null) // belum ada sesi nyata — baru preview, belum di-insert
        setPhase('confirm')
      }
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'Gagal mengecek data susulan')
      setPhase('confirm')
    }
  }

  // Step 2: Dipanggil saat tombol "Ya, Buka Susulan" ditekan — baru di sini sesi benar-benar di-insert.
  async function bukaSusulan() {
    setPhase('opening')
    setErrorMsg(null)
    try {
      const res = await apiRequest<SusulanResult>(
        `/api/guru/susulan`,
        { method: 'POST', body: JSON.stringify({ jadwalId: jadwal.id, konfirmasi: true }) }
      )
      if (res.konflik || res.error) {
        setErrorMsg(res.error ?? res.message ?? 'Tidak dapat membuka sesi susulan.')
        setPhase('confirm')
        return
      }
      if (res.sudahBerjalan) {
        setKodeSesi(res.kodeSesi ?? null)
        setPhase('opened')
        return
      }
      if (!res.bisa) {
        setPhase('empty')
        return
      }
      setKodeSesi(res.kodeSesi ?? null)
      setPhase('opened')
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'Gagal membuka sesi susulan')
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

          {/* Opening — sesi sedang benar-benar dibuka (insert berjalan) */}
          {phase === 'opening' && (
            <div className="flex flex-col items-center py-8 gap-5">
              <div className="relative w-24 h-24">
                <div className="absolute inset-0 rounded-full border-4 border-purple-100" />
                <div className="absolute inset-0 rounded-full border-4 border-purple-500 border-t-transparent animate-spin" />
                <div className="absolute inset-0 flex items-center justify-center">
                  <ClipboardList className="w-8 h-8 text-purple-500" />
                </div>
              </div>
              <div className="text-center">
                <p className="text-base font-semibold text-slate-800">Membuka Sesi Susulan...</p>
                <p className="text-sm text-slate-400 mt-1">Mohon tunggu, sesi sedang dibuat</p>
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
                    ℹ Durasi sesi susulan ditentukan pengawas. Tutup sesi kapan pun lewat tab Mode Pengawas.
                  </p>

                  <div className="flex gap-3">
                    <button onClick={onClose} className="flex-1 px-4 py-2.5 rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50 text-sm font-medium">
                      Batal
                    </button>
                    <button
                      onClick={bukaSusulan}
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
                Tutup sesi kapan pun dari tab <strong>Mode Pengawas</strong> saat ujian susulan selesai.
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

// Dulu halaman sendiri (/guru/jadwal-pengawasan), sekarang tab "Jadwal
// Mengawas" di menu "Jadwal Mengawas Saya" (lihat ../page.tsx). Judul halaman
// kini dipegang halaman induk, jadi tab ini hanya punya tombol Refresh kecil.
//
// `onBukaMode`: dipanggil saat guru menekan "Mulai Sesi" — halaman induk
// berpindah ke tab Mode Pengawas (tanpa reload halaman).
export function JadwalTab({ onBukaMode }: { onBukaMode?: () => void }) {
  const [jadwal, setJadwal] = useState<JadwalPengawasan[]>([])
  const [loading, setLoading] = useState(true)
  const [hasJadwal, setHasJadwal] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [susulanTarget, setSusulanTarget] = useState<JadwalPengawasan | null>(null)
  const [now, setNow] = useState(() => new Date())
  const [zonaWaktu, setZonaWaktu] = useState<ZonaWaktuInfo>(ZONA_FALLBACK)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    else setRefreshing(true)
    try {
      const res = await apiRequest<{ data: JadwalPengawasan[]; hasJadwal: boolean; zonaWaktu?: ZonaWaktuInfo }>('/api/guru/jadwal-pengawasan')
      setJadwal(res.data ?? [])
      setHasJadwal(res.hasJadwal ?? (res.data?.length > 0))
      if (res.zonaWaktu) setZonaWaktu(res.zonaWaktu)
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  // Update jam setiap detik (untuk deteksi 15 menit sebelum dan status real-time)
  useEffect(() => {
    const tick = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(tick)
  }, [])

  // Auto-refresh data dari server setiap 30 detik
  // HEMAT VERCEL (10 Nov 2026, tahap 3): dilewati saat tab tersembunyi.
  useEffect(() => {
    intervalRef.current = setInterval(() => { if (!document.hidden) void load(true) }, 30000)
    return () => { if (intervalRef.current) clearInterval(intervalRef.current) }
  }, [load])

  if (loading) return <PageLoader />

  const grouped = groupByMonth(jadwal)
  const totalMengawas = jadwal.length
  const jumlahHari = new Set(jadwal.map(j => j.tanggal)).size

  return (
    <div className="space-y-5 sm:space-y-6 animate-fade-in pb-10">
      {/* Ringkasan singkat: total mengawas & jumlah hari */}
      <div className="card flex items-center gap-3 py-3 px-3.5 sm:px-5">
        <div className="grid grid-cols-2 flex-1 divide-x divide-slate-100">
          <div className="pr-3">
            <div className="text-2xl sm:text-3xl font-bold text-indigo-600 leading-none">
              {totalMengawas}<span className="text-sm font-semibold text-slate-400 ml-1">kali</span>
            </div>
            <div className="text-xs text-slate-500 mt-1">Total mengawas</div>
          </div>
          <div className="pl-3 sm:pl-5">
            <div className="text-2xl sm:text-3xl font-bold text-slate-800 leading-none">
              {jumlahHari}<span className="text-sm font-semibold text-slate-400 ml-1">hari</span>
            </div>
            <div className="text-xs text-slate-500 mt-1">Jumlah hari</div>
          </div>
        </div>
        <button
          onClick={() => load(true)}
          disabled={refreshing}
          aria-label="Refresh jadwal"
          className="flex items-center gap-2 p-2.5 sm:px-3 rounded-xl border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 text-sm font-medium transition-colors flex-shrink-0"
        >
          <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
          <span className="hidden sm:inline">Refresh</span>
        </button>
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
                const today = isToday(j.tanggal, zonaWaktu, now)
                const tgl = tanggalPendek(j.tanggal)
                const isSelesai = j.status === 'SELESAI'

                return (
                  <div
                    key={j.id}
                    className={`bg-white border rounded-2xl shadow-sm overflow-hidden
                      ${today ? 'border-indigo-200 ring-2 ring-indigo-100' : 'border-slate-100'}`}
                  >
                    <div className="flex items-stretch">
                      {/* Garis aksen kiri */}
                      <div className={`w-1.5 flex-shrink-0 ${
                        j.status === 'BERJALAN' ? 'bg-amber-400' :
                        j.status === 'SELESAI'  ? 'bg-emerald-400' :
                        today ? 'bg-indigo-500' : 'bg-slate-200'
                      }`} />

                      <div className="flex-1 min-w-0 p-3 sm:p-4">
                        {/* Baris 1: mapel + kelas, status di kanan */}
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="font-bold text-slate-900 text-sm sm:text-base leading-snug">{j.nama_mapel}</p>
                            <p className="mt-0.5 flex items-center gap-1.5 text-xs text-slate-500">
                              <Users className="w-3 h-3" />
                              Kelas {j.nama_kelas}
                              {today && (
                                <span className="px-1.5 py-0.5 rounded-full bg-indigo-100 text-indigo-700 text-[10px] font-bold leading-none">
                                  Hari ini
                                </span>
                              )}
                            </p>
                          </div>
                          <span className={`flex items-center gap-1 text-[11px] px-2 py-1 rounded-full border font-medium flex-shrink-0 ${cfg.cls}`}>
                            {cfg.icon}
                            {cfg.pendek}
                          </span>
                        </div>

                        {/* Baris 2: tanggal · jam · sesi — satu baris ringkas */}
                        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-600">
                          <span className="inline-flex items-center gap-1 font-semibold text-slate-700">
                            <Calendar className="w-3.5 h-3.5 text-slate-400" />
                            {tgl}
                          </span>
                          <span className="inline-flex items-center gap-1">
                            <Clock className="w-3.5 h-3.5 text-slate-400" />
                            {j.jam_mulai}–{j.jam_selesai}
                          </span>
                          <span className="text-slate-500">Sesi {j.sesi} · {j.durasi} mnt</span>
                        </div>

                        {/* Hari ini: pengingat + tombol mulai */}
                        {today && j.status === 'AKTIF' && (() => {
                          const bisa = canStartSesi(j.tanggal, j.jam_mulai, j.jam_selesai, now, zonaWaktu)
                          const menit = menitMenunggu(j.tanggal, j.jam_mulai, now, zonaWaktu)
                          if (bisa) {
                            return (
                              <div className="mt-3 flex flex-col sm:flex-row sm:items-center gap-2">
                                <div className="flex items-center gap-2 text-xs text-emerald-700 bg-emerald-50 px-3 py-2 rounded-xl flex-1">
                                  <PlayCircle className="w-3.5 h-3.5 flex-shrink-0" />
                                  {menit <= 0 ? 'Ujian sudah dimulai!' : `${menit} menit lagi — sudah bisa mulai sesi`}
                                </div>
                                <button
                                  type="button"
                                  onClick={() => onBukaMode?.()}
                                  className="flex items-center justify-center gap-2 w-full sm:w-auto px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-sm sm:text-xs font-semibold transition-all shadow-sm"
                                >
                                  <PlayCircle className="w-4 h-4 sm:w-3.5 sm:h-3.5" />
                                  Mulai Sesi
                                </button>
                              </div>
                            )
                          }
                          return (
                            <div className="mt-3 flex items-center gap-2 text-xs text-indigo-600 bg-indigo-50 px-3 py-2 rounded-xl">
                              <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
                              <span>Tombol mulai aktif <strong>{menit} menit lagi</strong> (15 mnt sebelum {j.jam_mulai})</span>
                            </div>
                          )
                        })()}
                        {today && j.status === 'BERJALAN' && (
                          <div className="mt-3 flex items-center gap-2 text-xs text-amber-700 bg-amber-50 px-3 py-2 rounded-xl">
                            <PlayCircle className="w-3.5 h-3.5 flex-shrink-0" />
                            <span className="flex-1 min-w-0">Sesi berlangsung — pantau di <strong>Mode Pengawas</strong>.</span>
                            {onBukaMode && (
                              <button
                                type="button"
                                onClick={() => onBukaMode()}
                                className="flex-shrink-0 underline font-semibold"
                              >
                                Buka
                              </button>
                            )}
                          </div>
                        )}

                        {/* Ujian Susulan — muncul kapan saja selama status SELESAI */}
                        {isSelesai && (
                          <div className="mt-3 flex items-center justify-between gap-2">
                            <p className="text-xs text-slate-400">Ada siswa tidak hadir?</p>
                            <button
                              onClick={() => setSusulanTarget(j)}
                              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-purple-50 hover:bg-purple-100 border border-purple-200 text-purple-700 text-xs font-semibold transition-all"
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
