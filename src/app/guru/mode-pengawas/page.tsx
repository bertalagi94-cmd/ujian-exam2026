'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import {
  Shield, Play, Square, Clock, Copy, CheckCircle,
  RefreshCw, AlertTriangle, BookOpen, Users, Lock, Unlock,
  ShieldAlert, RotateCcw, KeyRound, Eye, ChevronDown, ChevronUp, FileQuestion
} from 'lucide-react'
import { apiRequest, formatDate } from '@/lib/utils'
import { PageLoader, Spinner } from '@/components/ui'
import { isStatusSoalSiap, labelStatusSoal, pesanStatusSoal } from '@/lib/soal-status-shared'

interface SesiUjianInfo {
  id: string
  kode_sesi: string
  status: 'BERJALAN' | 'SELESAI'
  waktu_mulai: string
  jumlah_peserta: number
  jumlah_selesai: number
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
  diambil_alih_pengawas: { username: string; nama: string } | null
  status_soal?: 'BELUM_ADA' | 'DRAFT' | 'MENUNGGU' | 'DITOLAK' | 'DISETUJUI'
  status_soal_guru?: string | null
}

interface SiswaAktif {
  nis: string
  nama: string
  kelas: string
  status: 'AKTIF' | 'SELESAI' | 'RESET' | 'TERKUNCI'
  waktu_daftar: string
  waktu_selesai: string | null
  jumlah_pelanggaran: number
  kode_reset: string | null
}

interface Pelanggaran {
  id: string
  sesi_id: string
  nis: string
  nama_siswa: string
  jenis: string
  level: number
  detail: string
  status: string
  created_at: string
}

interface ResetResult {
  dikunci_permanen: boolean
  kode_reset?: string
  nama_siswa: string
  reset_ke?: number
  message: string
}


// ── Terjemahan jenis pelanggaran ke Bahasa Indonesia ──────────────────────
function terjemahJenis(jenis: string): string {
  const map: Record<string, string> = {
    WINDOW_BLUR:     'Keluar dari Aplikasi Ujian',
    EXIT_FULLSCREEN: 'Keluar Layar Penuh',
    TAB_SWITCH:      'Berpindah Tab/Aplikasi',
    COPY_PASTE:      'Salin/Tempel Teks',
    CONTEXT_MENU:    'Klik Kanan',
    KEYBOARD_BLOCK:  'Shortcut Terlarang',
    DRAG_DROP:       'Drag & Drop',
  }
  return map[jenis] ?? jenis.replace(/_/g, ' ')
}

function getMinutesUntilStart(jamMulai: string): number {
  const now = new Date()
  const [h, m] = jamMulai.split(':').map(Number)
  const start = new Date()
  start.setHours(h, m, 0, 0)
  return Math.ceil((start.getTime() - now.getTime()) / 60000)
}

function isBolehMulai(j: JadwalHariIni): boolean {
  return getMinutesUntilStart(j.jam_mulai) <= 15
}

// Badge kecil status kesiapan soal — sama gayanya dengan yang dipakai di
// halaman /pengawas (lihat SoalStatusBadge di src/app/pengawas/page.tsx).
function SoalStatusBadge({ status }: { status?: string }) {
  const siap = isStatusSoalSiap(status)
  const warna = siap
    ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
    : status === 'MENUNGGU'
      ? 'bg-amber-50 text-amber-700 border-amber-200'
      : status === 'DITOLAK'
        ? 'bg-red-50 text-red-700 border-red-200'
        : 'bg-slate-50 text-slate-500 border-slate-200'
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${warna}`}>
      <FileQuestion className="w-3 h-3" /> {labelStatusSoal(status)}
    </span>
  )
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
      <div className="flex items-center justify-center gap-1.5 flex-wrap px-2">
        {kode.split('').map((char, i) => (
          <div key={i} className="w-9 h-11 sm:w-11 sm:h-14 rounded-xl bg-gradient-to-b from-emerald-500 to-emerald-600 flex items-center justify-center text-white text-xl sm:text-2xl font-black shadow-lg select-all">
            {char}
          </div>
        ))}
      </div>
      <button onClick={copyKode} className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all ${copied ? 'bg-emerald-100 text-emerald-700 border border-emerald-200' : 'bg-slate-100 text-slate-600 hover:bg-slate-200 border border-slate-200'}`}>
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
      Dapat dimulai 15 menit sebelum jadwal · aktif dalam <strong className="text-slate-700 mx-1">{minsLeft} menit</strong> lagi
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

  // Monitor: siswa aktif & pelanggaran per sesi
  const [siswaMap, setSiswaMap] = useState<Record<string, SiswaAktif[]>>({})
  const [pelanggaranMap, setPelanggaranMap] = useState<Record<string, Pelanggaran[]>>({})
  const [expandedSesi, setExpandedSesi] = useState<Set<string>>(new Set())

  // Reset siswa
  const [resetTarget, setResetTarget] = useState<{ sesiId: string; nis: string; nama: string } | null>(null)
  const [resetResult, setResetResult] = useState<ResetResult | null>(null)
  const [resetting, setResetting] = useState(false)

  // Notif pelanggaran baru
  const [pelNotif, setPelNotif] = useState<Pelanggaran | null>(null)
  const seenPelIdsRef = useRef<Set<string>>(new Set())

  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const showToast = (msg: string, type: 'success' | 'error' = 'success') => {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 3500)
  }

  function playAlert() {
    try {
      const ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)()
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.connect(gain); gain.connect(ctx.destination)
      osc.frequency.setValueAtTime(880, ctx.currentTime)
      osc.frequency.setValueAtTime(660, ctx.currentTime + 0.1)
      gain.gain.setValueAtTime(0.3, ctx.currentTime)
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4)
      osc.start(ctx.currentTime); osc.stop(ctx.currentTime + 0.4)
    } catch { /* silent */ }
  }

  const fetchMonitor = useCallback(async (sesiIds: string[]) => {
    if (!sesiIds.length) return
    try {
      const [siswaResults, pelResults] = await Promise.all([
        Promise.all(sesiIds.map(id => apiRequest<{ data: SiswaAktif[] }>(`/api/pengawas/sesi/${id}/siswa`))),
        Promise.all(sesiIds.map(id => apiRequest<{ data: Pelanggaran[] }>(`/api/pengawas/pelanggaran?sesiId=${id}`))),
      ])

      // Update siswa map + auto-expand sesi yang ada siswanya
      const newSiswaMap: Record<string, SiswaAktif[]> = {}
      sesiIds.forEach((id, i) => { newSiswaMap[id] = siswaResults[i].data ?? [] })
      setSiswaMap(newSiswaMap)
      setExpandedSesi(prev => {
        const next = new Set(prev)
        sesiIds.forEach((id, i) => { if ((siswaResults[i].data ?? []).length > 0) next.add(id) })
        return next
      })

      // Update pelanggaran map + notif jika ada baru
      const newPelMap: Record<string, Pelanggaran[]> = {}
      sesiIds.forEach((id, i) => { newPelMap[id] = pelResults[i].data ?? [] })
      setPelanggaranMap(newPelMap)

      const allPel = Object.values(newPelMap).flat()
      const brandNew = allPel.filter(p => !seenPelIdsRef.current.has(p.id))
      if (brandNew.length > 0 && seenPelIdsRef.current.size > 0) {
        playAlert()
        setPelNotif(brandNew[0])
        setTimeout(() => setPelNotif(null), 8000)
      }
      allPel.forEach(p => seenPelIdsRef.current.add(p.id))
    } catch { /* silent */ }
  }, [])

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    else setRefreshing(true)
    try {
      const res = await apiRequest<{ data: JadwalHariIni[] }>('/api/guru/mode-pengawas')
      const data = res.data ?? []
      setJadwal(data)
      // Fetch monitor untuk sesi yang sedang berjalan
      const runningSesiIds = data
        .filter(j => j.sesi_ujian?.status === 'BERJALAN')
        .map(j => j.sesi_ujian!.id)
      if (runningSesiIds.length > 0) await fetchMonitor(runningSesiIds)
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [fetchMonitor])

  useEffect(() => { load() }, [load])

  // Polling tiap 5 detik jika ada sesi berjalan
  useEffect(() => {
    if (pollingRef.current) clearInterval(pollingRef.current)
    const runningSesiIds = jadwal
      .filter(j => j.sesi_ujian?.status === 'BERJALAN')
      .map(j => j.sesi_ujian!.id)
    if (!runningSesiIds.length) return
    pollingRef.current = setInterval(() => fetchMonitor(runningSesiIds), 5000)
    return () => { if (pollingRef.current) clearInterval(pollingRef.current) }
  }, [jadwal, fetchMonitor])

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
    } finally { setStarting(null) }
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
    } finally { setStopping(null); setConfirmTutup(null) }
  }

  async function handleReset() {
    if (!resetTarget) return
    setResetting(true)
    try {
      const res = await apiRequest<ResetResult>(`/api/pengawas/sesi/${resetTarget.sesiId}/reset-siswa`, {
        method: 'POST',
        body: JSON.stringify({ nis: resetTarget.nis }),
      })
      setResetResult(res)
      await fetchMonitor([resetTarget.sesiId])
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Gagal mereset siswa', 'error')
      setResetTarget(null)
    } finally { setResetting(false) }
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
          className="flex items-center gap-2 px-4 py-2 rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50 text-sm font-medium transition-colors"
        >
          <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {/* Popup notif pelanggaran */}
      {pelNotif && (
        <div className="fixed top-4 right-4 z-50 bg-red-600 text-white px-4 py-3 rounded-2xl shadow-2xl flex items-center gap-3 animate-fade-in max-w-xs">
          <ShieldAlert className="w-5 h-5 flex-shrink-0" />
          <div>
            <div className="text-xs font-bold uppercase tracking-wide">Pelanggaran Baru!</div>
            <div className="text-sm font-semibold truncate">{pelNotif.nama_siswa}</div>
            <div className="text-xs opacity-80">{terjemahJenis(pelNotif.jenis)}</div>
          </div>
          <button onClick={() => setPelNotif(null)} className="ml-1 opacity-70 hover:opacity-100 text-lg leading-none">×</button>
        </div>
      )}

      {jadwal.length === 0 ? (
        <div className="card py-12 flex flex-col items-center gap-3 text-slate-400">
          <BookOpen className="w-8 h-8" />
          <p className="text-sm">Tidak ada jadwal pengawasan hari ini</p>
        </div>
      ) : (
        <div className="space-y-4">
          {jadwal.map(j => {
            const diambilAlih = !!j.diambil_alih_pengawas
            const isRunning = j.status === 'BERJALAN' && j.sesi_ujian?.status === 'BERJALAN'
            const isDone = j.status === 'SELESAI' || j.sesi_ujian?.status === 'SELESAI'
            const boleh = isBolehMulai(j)
            const soalSiap = isStatusSoalSiap(j.status_soal)
            const sesiId = j.sesi_ujian?.id
            const siswaList = sesiId ? (siswaMap[sesiId] ?? []) : []
            const pelList = sesiId ? (pelanggaranMap[sesiId] ?? []) : []
            const isExpanded = sesiId ? expandedSesi.has(sesiId) : false

            const aktifCount = siswaList.filter(s => s.status === 'AKTIF').length
            const selesaiCount = siswaList.filter(s => s.status === 'SELESAI').length
            const resetCount = siswaList.filter(s => s.status === 'RESET').length
            const terkunciCount = siswaList.filter(s => s.status === 'TERKUNCI').length

            return (
              <div key={j.id} className={`card p-0 overflow-hidden ${isRunning || diambilAlih ? 'ring-2 ring-amber-400' : ''}`}>
                {(isRunning || diambilAlih) && <div className="h-1 bg-gradient-to-r from-amber-400 via-orange-400 to-amber-400 animate-pulse" />}

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
                      {!isRunning && !isDone && !diambilAlih && !soalSiap && (
                        <div className="mt-1.5">
                          <SoalStatusBadge status={j.status_soal} />
                        </div>
                      )}
                    </div>
                    <span className={`text-xs px-2.5 py-1 rounded-full font-semibold flex-shrink-0 ${diambilAlih ? 'bg-purple-100 text-purple-700' : isRunning ? 'bg-amber-100 text-amber-700' : isDone ? 'bg-emerald-100 text-emerald-700' : 'bg-blue-100 text-blue-700'}`}>
                      {diambilAlih ? '● Berlangsung' : isRunning ? '● Berlangsung' : isDone ? '✓ Selesai' : '◷ Akan Datang'}
                    </span>
                  </div>

                  {/* Sesi diambil-alih pengawas susulan (ditugaskan admin) */}
                  {diambilAlih && j.diambil_alih_pengawas && (
                    <div className="relative overflow-hidden rounded-2xl mb-4 bg-gradient-to-br from-purple-600 via-violet-600 to-indigo-700 p-6 text-center shadow-lg">
                      <div className="absolute inset-0 opacity-20 pointer-events-none" style={{ backgroundImage: 'radial-gradient(circle at 20% 20%, white 0%, transparent 35%), radial-gradient(circle at 80% 80%, white 0%, transparent 30%)' }} />
                      <div className="relative flex flex-col items-center gap-2">
                        <div className="w-12 h-12 rounded-2xl bg-white/15 backdrop-blur flex items-center justify-center mb-1">
                          <Shield className="w-6 h-6 text-white" />
                        </div>
                        <div className="text-[11px] font-bold uppercase tracking-widest text-white/70">Sesi Susulan Aktif</div>
                        <h4 className="text-lg font-bold text-white leading-snug">
                          Sesi ini sedang aktif dengan pengawas<br className="hidden sm:block" />
                          <span className="text-amber-300">{j.diambil_alih_pengawas.nama}</span>
                        </h4>
                        <p className="text-xs text-white/70 max-w-sm mt-1">
                          Ujian susulan untuk jadwal ini ditugaskan oleh admin kepada guru lain.
                          Anda tidak perlu melakukan apa pun — pantauan &amp; kontrol sesi ditangani oleh pengawas yang bertugas.
                        </p>
                      </div>
                    </div>
                  )}

                  {/* Kode sesi + statistik */}
                  {isRunning && j.sesi_ujian && (
                    <div className="bg-slate-50 border border-slate-100 rounded-2xl mb-4">
                      <KodeSesiDisplay kode={j.sesi_ujian.kode_sesi} />
                      <div className="border-t border-slate-100 px-4 py-2.5 flex items-center flex-wrap gap-3 text-xs text-slate-500">
                        <span>Mulai: <strong className="text-slate-700">{new Date(j.sesi_ujian.waktu_mulai).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}</strong></span>
                        <span className="px-2 py-0.5 bg-emerald-50 text-emerald-700 rounded-lg font-semibold">{aktifCount} sedang ujian</span>
                        {selesaiCount > 0 && <span className="px-2 py-0.5 bg-blue-50 text-blue-700 rounded-lg font-semibold">{selesaiCount} selesai</span>}
                        {resetCount > 0 && <span className="px-2 py-0.5 bg-amber-50 text-amber-700 rounded-lg font-semibold">{resetCount} menunggu kode</span>}
                        {terkunciCount > 0 && <span className="px-2 py-0.5 bg-red-50 text-red-700 rounded-lg font-semibold">{terkunciCount} terkunci</span>}
                        {pelList.length > 0 && (
                          <span className="px-2 py-0.5 bg-red-100 text-red-700 rounded-lg font-bold flex items-center gap-1">
                            <ShieldAlert className="w-3 h-3" />{pelList.length} pelanggaran
                          </span>
                        )}
                        {sesiId && (
                          <button
                            onClick={() => setExpandedSesi(prev => { const n = new Set(prev); isExpanded ? n.delete(sesiId) : n.add(sesiId); return n })}
                            className="ml-auto flex items-center gap-1 text-slate-500 hover:text-slate-700 font-medium"
                          >
                            {isExpanded ? <><ChevronUp className="w-3.5 h-3.5" />Sembunyikan</> : <><ChevronDown className="w-3.5 h-3.5" />Daftar Siswa</>}
                          </button>
                        )}
                      </div>

                      {/* Daftar siswa (expandable) */}
                      {isExpanded && sesiId && (
                        <div className="border-t border-slate-100 p-4 space-y-4">
                          {/* Siswa list */}
                          {siswaList.length === 0 ? (
                            <div className="flex items-center gap-2 text-sm text-slate-400 py-2">
                              <Eye className="w-4 h-4" /> Belum ada siswa yang masuk ujian
                            </div>
                          ) : (
                            <div>
                              <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Peserta Ujian</div>
                              <div className="space-y-1.5 max-h-72 overflow-y-auto">
                                {siswaList.map(sw => (
                                  <div key={sw.nis} className={`flex items-center gap-2 flex-wrap px-3 py-2 rounded-xl text-sm ${sw.status === 'TERKUNCI' ? 'bg-red-50 border border-red-100' : sw.status === 'RESET' ? 'bg-amber-50 border border-amber-100' : sw.status === 'SELESAI' ? 'bg-slate-50' : 'bg-white border border-slate-100'}`}>
                                    <div className="flex-1 min-w-0 basis-32">
                                      <div className="font-medium text-slate-800 truncate">{sw.nama}</div>
                                      <div className="text-xs text-slate-400 font-mono">{sw.nis}</div>
                                    </div>
                                    <div className="flex items-center gap-2 flex-wrap">
                                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full flex-shrink-0 ${sw.status === 'AKTIF' ? 'bg-emerald-100 text-emerald-700' : sw.status === 'SELESAI' ? 'bg-blue-100 text-blue-700' : sw.status === 'RESET' ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700'}`}>
                                      {sw.status === 'AKTIF' ? '● Ujian' : sw.status === 'SELESAI' ? '✓ Selesai' : sw.status === 'RESET' ? '⏳ Tunggu Kode' : '🔒 Terkunci'}
                                    </span>
                                    {sw.jumlah_pelanggaran > 0 && (
                                      <span className={`text-xs font-bold px-2 py-0.5 rounded-full flex-shrink-0 ${sw.jumlah_pelanggaran >= 3 ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}`}>
                                        {sw.jumlah_pelanggaran}× langgar
                                      </span>
                                    )}
                                    {(sw.status === 'RESET' || (sw.status === 'AKTIF' && sw.jumlah_pelanggaran > 0)) && (
                                      <button
                                        onClick={() => setResetTarget({ sesiId, nis: sw.nis, nama: sw.nama })}
                                        className="flex-shrink-0 flex items-center gap-1 text-xs px-2 py-1 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 font-medium text-slate-600"
                                      >
                                        <RotateCcw className="w-3 h-3" /> Reset
                                      </button>
                                    )}
                                    {sw.status === 'RESET' && sw.kode_reset && (
                                      <div className="flex-shrink-0 flex items-center gap-1 text-xs px-2 py-1 bg-amber-50 border border-amber-200 rounded-lg font-mono font-bold text-amber-700">
                                        <KeyRound className="w-3 h-3" />{sw.kode_reset}
                                      </div>
                                    )}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}

                          {/* Pelanggaran */}
                          {pelList.length > 0 && (
                            <div>
                              <div className="text-xs font-semibold text-red-500 uppercase tracking-wide mb-2 flex items-center gap-1">
                                <ShieldAlert className="w-3.5 h-3.5" /> Log Pelanggaran
                              </div>
                              <div className="space-y-1 max-h-48 overflow-y-auto">
                                {pelList.map(p => (
                                  <div key={p.id} className="flex items-start gap-2 flex-wrap px-3 py-2 bg-red-50 rounded-xl text-xs">
                                    <div className="flex-1 min-w-0 basis-28">
                                      <span className="font-semibold text-slate-800 break-words">{p.nama_siswa}</span>
                                      <span className="text-slate-400 font-mono ml-1">{p.nis}</span>
                                    </div>
                                    <div className="flex items-center gap-2 flex-wrap">
                                    <span className="bg-red-100 text-red-700 font-bold px-2 py-0.5 rounded-full">{terjemahJenis(p.jenis)}</span>
                                    <span className="text-slate-400">{new Date(p.created_at).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}</span>
                                    <button
                                      onClick={() => setResetTarget({ sesiId, nis: p.nis, nama: p.nama_siswa })}
                                      className="flex items-center gap-1 px-2 py-1 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 font-medium text-slate-600"
                                    >
                                      <RotateCcw className="w-3 h-3" /> Reset
                                    </button>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Done info */}
                  {isDone && !diambilAlih && (
                    <div className="flex items-center gap-2 text-sm text-emerald-600 bg-emerald-50 px-4 py-3 rounded-xl mb-4">
                      <CheckCircle className="w-4 h-4 flex-shrink-0" />
                      Ujian telah selesai dilaksanakan.
                    </div>
                  )}

                  {/* Action buttons */}
                  {!isDone && !diambilAlih && (
                    <div className="flex items-center justify-between gap-3 flex-wrap">
                      {!isRunning && !boleh && <CountdownTimer jamMulai={j.jam_mulai} />}
                      {!isRunning && boleh && soalSiap && (
                        <div className="flex items-center gap-1.5 text-xs text-emerald-600 bg-emerald-50 px-3 py-1.5 rounded-lg font-medium">
                          <Unlock className="w-3.5 h-3.5" /> Siap dimulai
                        </div>
                      )}
                      {!isRunning && boleh && !soalSiap && (
                        <div
                          className="flex items-center gap-1.5 text-xs text-slate-500 bg-slate-50 px-3 py-1.5 rounded-lg font-medium max-w-md"
                          title={pesanStatusSoal(j.status_soal, j.status_soal_guru)}
                        >
                          <AlertTriangle className="w-3.5 h-3.5 text-amber-400 flex-shrink-0" />
                          {pesanStatusSoal(j.status_soal, j.status_soal_guru)}
                        </div>
                      )}
                      {isRunning && <div className="flex-1" />}
                      <div className="flex items-center gap-2">
                        {!isRunning && (
                          <button
                            onClick={() => handleMulai(j)}
                            disabled={!boleh || !soalSiap || starting === j.id}
                            title={!soalSiap ? pesanStatusSoal(j.status_soal, j.status_soal_guru) : undefined}
                            className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold transition-all shadow-sm ${boleh && soalSiap ? 'bg-emerald-600 hover:bg-emerald-700 text-white' : 'bg-slate-100 text-slate-400 cursor-not-allowed'}`}
                          >
                            {starting === j.id ? <RefreshCw className="w-4 h-4 animate-spin" /> : (boleh && soalSiap) ? <Play className="w-4 h-4" /> : <Lock className="w-4 h-4" />}
                            {starting === j.id ? 'Memulai...' : 'Mulai Ujian'}
                          </button>
                        )}
                        {isRunning && (
                          <button
                            onClick={() => setConfirmTutup(j)}
                            disabled={stopping === j.id}
                            className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold bg-red-600 hover:bg-red-700 text-white transition-all shadow-sm"
                          >
                            {stopping === j.id ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Square className="w-4 h-4" />}
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
      )}

      {/* Confirm Tutup Dialog */}
      {confirmTutup && (() => {
        const sesiIdTutup = confirmTutup.sesi_ujian?.id
        const siswaTutupList = sesiIdTutup ? (siswaMap[sesiIdTutup] ?? []) : []
        const siswaMasihAktif = siswaTutupList.filter(s => s.status === 'AKTIF')
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
            <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6 animate-fade-in">
              <div className="w-12 h-12 rounded-full bg-red-100 flex items-center justify-center mx-auto mb-4">
                <AlertTriangle className="w-6 h-6 text-red-600" />
              </div>
              <h3 className="text-lg font-bold text-slate-900 text-center mb-2">Tutup Sesi Ujian?</h3>
              <p className="text-sm text-slate-500 text-center mb-1"><strong>{confirmTutup.nama_mapel}</strong> — Kelas {confirmTutup.nama_kelas}</p>

              {/* Daftar siswa yang sedang mengerjakan di sesi ini, supaya pengawas
                  tahu siapa yang akan terdampak sebelum benar-benar menutup sesi. */}
              {siswaMasihAktif.length > 0 ? (
                <div className="mt-3 mb-4">
                  <div className="text-xs font-semibold text-red-500 uppercase tracking-wide mb-2 text-center">
                    {siswaMasihAktif.length} Siswa Masih Mengerjakan
                  </div>
                  <div className="space-y-1 max-h-40 overflow-y-auto bg-red-50 rounded-xl p-2">
                    {siswaMasihAktif.map(sw => (
                      <div key={sw.nis} className="flex items-center gap-2 px-2 py-1.5 bg-white rounded-lg text-sm">
                        <span className="font-medium text-slate-800 truncate flex-1">{sw.nama}</span>
                        <span className="text-xs text-slate-400 font-mono">{sw.nis}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <p className="text-xs text-slate-400 text-center mb-3">Tidak ada siswa yang sedang mengerjakan saat ini.</p>
              )}

              <p className="text-xs text-slate-400 text-center mb-6">
                {siswaMasihAktif.length > 0
                  ? 'Siswa di atas akan otomatis dianggap selesai dengan jawaban terakhir yang tersimpan. Tindakan ini tidak dapat dibatalkan.'
                  : 'Tindakan ini tidak dapat dibatalkan.'}
              </p>
              <div className="flex gap-3">
                <button onClick={() => setConfirmTutup(null)} className="flex-1 px-4 py-2.5 rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50 text-sm font-medium">Batal</button>
                <button onClick={() => handleTutup(confirmTutup)} disabled={stopping === confirmTutup.id} className="flex-1 px-4 py-2.5 rounded-xl bg-red-600 hover:bg-red-700 text-white text-sm font-semibold">
                  {stopping === confirmTutup.id ? 'Menutup...' : 'Ya, Tutup'}
                </button>
              </div>
            </div>
          </div>
        )
      })()}

      {/* Confirm Reset Dialog */}
      {resetTarget && !resetResult && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl max-w-sm w-full p-6 animate-fade-in">
            <div className="w-12 h-12 rounded-full bg-amber-100 flex items-center justify-center mx-auto mb-4">
              <RotateCcw className="w-6 h-6 text-amber-600" />
            </div>
            <h3 className="text-lg font-bold text-slate-900 text-center mb-2">Reset Siswa?</h3>
            <p className="text-sm text-slate-500 text-center mb-6">
              Siswa <strong>{resetTarget.nama}</strong> akan di-reset dan harus memasukkan kode 7 digit baru. Jawaban tidak akan hilang. Jika ini reset ke-3, siswa akan dikunci permanen dan nilai menjadi 0.
            </p>
            <div className="flex gap-3">
              <button onClick={() => setResetTarget(null)} className="flex-1 px-4 py-2.5 rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50 text-sm font-medium">Batal</button>
              <button onClick={handleReset} disabled={resetting} className="flex-1 px-4 py-2.5 rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-sm font-semibold flex items-center justify-center gap-2">
                {resetting ? <Spinner size="sm" /> : 'Ya, Reset'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Hasil Reset — tampilkan kode */}
      {resetResult && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl max-w-sm w-full p-6 animate-fade-in text-center">
            {resetResult.dikunci_permanen ? (
              <>
                <div className="w-12 h-12 rounded-full bg-red-100 flex items-center justify-center mx-auto mb-4"><Lock className="w-6 h-6 text-red-600" /></div>
                <h3 className="text-lg font-bold text-slate-900 mb-2">Siswa Dikunci Permanen</h3>
                <p className="text-sm text-slate-500 mb-6">{resetResult.message}</p>
              </>
            ) : (
              <>
                <div className="w-12 h-12 rounded-full bg-emerald-100 flex items-center justify-center mx-auto mb-4"><KeyRound className="w-6 h-6 text-emerald-600" /></div>
                <h3 className="text-lg font-bold text-slate-900 mb-2">Kode Reset Siswa</h3>
                <p className="text-sm text-slate-500 mb-3">Berikan kode ini kepada <strong>{resetResult.nama_siswa}</strong>:</p>
                <div className="flex items-center justify-center gap-1.5 mb-3">
                  {resetResult.kode_reset?.split('').map((c, i) => (
                    <div key={i} className="w-10 h-12 rounded-xl bg-gradient-to-b from-amber-500 to-amber-600 flex items-center justify-center text-white text-xl font-black shadow">{c}</div>
                  ))}
                </div>
                <p className="text-xs text-amber-600 mb-4">⚠ Kode hanya berlaku satu kali pakai untuk siswa ini.</p>
                {resetResult.reset_ke === 3 && <p className="text-xs text-red-500 font-semibold mb-4">🚨 Ini adalah reset terakhir. Pelanggaran lagi = dikunci permanen.</p>}
              </>
            )}
            <button onClick={() => { setResetResult(null); setResetTarget(null) }} className="w-full px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-900 text-white text-sm font-semibold">Tutup</button>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className={`fixed bottom-6 right-6 z-50 flex items-center gap-3 px-4 py-3 rounded-2xl shadow-lg text-sm font-medium animate-fade-in ${toast.type === 'success' ? 'bg-emerald-600 text-white' : 'bg-red-600 text-white'}`}>
          {toast.type === 'success' ? <CheckCircle className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />}
          {toast.msg}
        </div>
      )}
    </div>
  )
}
