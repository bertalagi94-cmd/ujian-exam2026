'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { BookOpen, Clock, AlertTriangle, CheckCircle, ChevronLeft, ChevronRight, Send, Maximize, KeyRound, LogOut } from 'lucide-react'
import { apiRequest } from '@/lib/utils'
import { Soal } from '@/types'
import { Confirm, Spinner } from '@/components/ui'

type Phase = 'KODE' | 'UJIAN' | 'SELESAI' | 'RESET_KODE'

interface SesiInfo {
  sesiId: string
  mapelId: string
  namaMapel: string
  kelas: string
  durasi: number
  soalList: SoalUjian[]
}

interface SoalUjian extends Soal {
  nomor: number
}

interface JawabanMap { [soalId: string]: string }

// ── Fullscreen helpers ────────────────────────────────────────────────────────
function requestFullscreen(el: Element) {
  if (el.requestFullscreen) return el.requestFullscreen()
  const anyEl = el as unknown as Record<string, () => Promise<void>>
  if (anyEl.webkitRequestFullscreen) return anyEl.webkitRequestFullscreen()
  if (anyEl.mozRequestFullScreen) return anyEl.mozRequestFullScreen()
  if (anyEl.msRequestFullscreen) return anyEl.msRequestFullscreen()
  return Promise.resolve()
}

function exitFullscreen() {
  if (document.exitFullscreen) return document.exitFullscreen()
  const anyDoc = document as unknown as Record<string, () => Promise<void>>
  if (anyDoc.webkitExitFullscreen) return anyDoc.webkitExitFullscreen()
  if (anyDoc.mozCancelFullScreen) return anyDoc.mozCancelFullScreen()
  if (anyDoc.msExitFullscreen) return anyDoc.msExitFullscreen()
  return Promise.resolve()
}

function isFullscreen() {
  const anyDoc = document as unknown as Record<string, Element | null>
  return !!(
    document.fullscreenElement ||
    anyDoc.webkitFullscreenElement ||
    anyDoc.mozFullScreenElement ||
    anyDoc.msFullscreenElement
  )
}

export default function SiswaUjianPage() {
  const [phase, setPhase] = useState<Phase>('KODE')
  const [kode, setKode] = useState('')
  const [sesiInfo, setSesiInfo] = useState<SesiInfo | null>(null)
  const [jawaban, setJawaban] = useState<JawabanMap>({})
  const [currentIdx, setCurrentIdx] = useState(0)
  const [sisaWaktu, setSisaWaktu] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [confirmSelesai, setConfirmSelesai] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [hasilNilai, setHasilNilai] = useState<{ nilai: number; benar: number; total: number; grade: string; lulus: boolean } | null>(null)

  // Fullscreen & anti-cheat state
  const [isFS, setIsFS] = useState(false)
  const [warningMsg, setWarningMsg] = useState('')
  const [showWarningOverlay, setShowWarningOverlay] = useState(false)

  // Reset kode state (siswa harus masukkan kode dari pengawas)
  const [kodeReset, setKodeReset] = useState('')
  const [kodeResetError, setKodeResetError] = useState('')
  const [kodeResetLoading, setKodeResetLoading] = useState(false)
  const [pendingResetSesiId, setPendingResetSesiId] = useState<string | null>(null)

  // Logout paksa karena pelanggaran 3x
  const [dikeluarkan, setDikeluarkan] = useState(false)

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const syncRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const sesiPollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const pelanggRef = useRef(0)
  const pelanggaranActiveRef = useRef(false)
  const jawabanRef = useRef<JawabanMap>({})
  const sesiInfoRef = useRef<SesiInfo | null>(null)
  const phaseRef = useRef<Phase>('KODE')

  useEffect(() => { jawabanRef.current = jawaban }, [jawaban])
  useEffect(() => { sesiInfoRef.current = sesiInfo }, [sesiInfo])
  useEffect(() => { phaseRef.current = phase }, [phase])

  // ── Minta izin blokir notifikasi saat ujian dimulai ───────────────────────
  useEffect(() => {
    if (phase !== 'UJIAN') return
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission()
    }
  }, [phase])

  // ── Masuk fullscreen saat phase UJIAN ─────────────────────────────────────
  useEffect(() => {
    if (phase !== 'UJIAN') return
    const el = document.documentElement
    requestFullscreen(el).catch(() => {})

    function onFSChange() {
      setIsFS(isFullscreen())
    }
    document.addEventListener('fullscreenchange', onFSChange)
    document.addEventListener('webkitfullscreenchange', onFSChange)
    document.addEventListener('mozfullscreenchange', onFSChange)
    document.addEventListener('MSFullscreenChange', onFSChange)
    return () => {
      document.removeEventListener('fullscreenchange', onFSChange)
      document.removeEventListener('webkitfullscreenchange', onFSChange)
      document.removeEventListener('mozfullscreenchange', onFSChange)
      document.removeEventListener('MSFullscreenChange', onFSChange)
    }
  }, [phase])

  // ── Deteksi keluar fullscreen saat ujian ─────────────────────────────────
  useEffect(() => {
    if (phase !== 'UJIAN') return

    function onFSChange() {
      if (!isFullscreen()) {
        if (pelanggaranActiveRef.current) return
        pelanggaranActiveRef.current = true
        pelanggRef.current++
        laporPelanggaran('EXIT_FULLSCREEN', `Keluar fullscreen ke-${pelanggRef.current}`)
        setWarningMsg('⚠ Anda keluar dari mode fullscreen!')
        setShowWarningOverlay(true)
      }
    }

    document.addEventListener('fullscreenchange', onFSChange)
    document.addEventListener('webkitfullscreenchange', onFSChange)
    document.addEventListener('mozfullscreenchange', onFSChange)
    document.addEventListener('MSFullscreenChange', onFSChange)
    return () => {
      document.removeEventListener('fullscreenchange', onFSChange)
      document.removeEventListener('webkitfullscreenchange', onFSChange)
      document.removeEventListener('mozfullscreenchange', onFSChange)
      document.removeEventListener('MSFullscreenChange', onFSChange)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase])

  // ── Anti-cheat: tab switch / visibilitychange ─────────────────────────────
  useEffect(() => {
    if (phase !== 'UJIAN') return
    function onVisibilityChange() {
      if (document.hidden) {
        if (pelanggaranActiveRef.current) return
        pelanggaranActiveRef.current = true
        pelanggRef.current++
        laporPelanggaran('TAB_SWITCH', `Perpindahan tab ke-${pelanggRef.current}`)
        setWarningMsg('⚠ Perpindahan tab/aplikasi terdeteksi!')
        setShowWarningOverlay(true)
      }
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => document.removeEventListener('visibilitychange', onVisibilityChange)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase])

  // ── Anti-cheat: blokir klik kanan ────────────────────────────────────────
  useEffect(() => {
    if (phase !== 'UJIAN') return
    function block(e: MouseEvent) { e.preventDefault() }
    document.addEventListener('contextmenu', block)
    return () => document.removeEventListener('contextmenu', block)
  }, [phase])

  // ── Anti-cheat: blokir shortcut keyboard berbahaya ───────────────────────
  useEffect(() => {
    if (phase !== 'UJIAN') return
    function onKeyDown(e: KeyboardEvent) {
      const blockedKeys = [
        e.ctrlKey && e.key === 'c',
        e.ctrlKey && e.key === 'v',
        e.ctrlKey && e.key === 'a',
        e.ctrlKey && e.key === 'u',
        e.ctrlKey && e.key === 'p',
        e.ctrlKey && e.shiftKey && e.key === 'I',
        e.ctrlKey && e.shiftKey && e.key === 'J',
        e.ctrlKey && e.shiftKey && e.key === 'C',
        e.key === 'F12',
        e.key === 'PrintScreen',
        e.altKey && e.key === 'Tab',
        e.metaKey,
      ]
      if (blockedKeys.some(Boolean)) {
        e.preventDefault()
        e.stopPropagation()
      }
    }
    document.addEventListener('keydown', onKeyDown, true)
    return () => document.removeEventListener('keydown', onKeyDown, true)
  }, [phase])

  // ── Anti-cheat: blokir copy/paste/cut ────────────────────────────────────
  useEffect(() => {
    if (phase !== 'UJIAN') return
    function block(e: ClipboardEvent) { e.preventDefault() }
    document.addEventListener('copy', block)
    document.addEventListener('cut', block)
    document.addEventListener('paste', block)
    return () => {
      document.removeEventListener('copy', block)
      document.removeEventListener('cut', block)
      document.removeEventListener('paste', block)
    }
  }, [phase])

  // ── Anti-cheat: blokir drag & drop ───────────────────────────────────────
  useEffect(() => {
    if (phase !== 'UJIAN') return
    function block(e: DragEvent) { e.preventDefault() }
    document.addEventListener('dragstart', block)
    document.addEventListener('drop', block)
    return () => {
      document.removeEventListener('dragstart', block)
      document.removeEventListener('drop', block)
    }
  }, [phase])

  // ── Anti-cheat: blokir window blur (pindah aplikasi di HP) ───────────────
  useEffect(() => {
    if (phase !== 'UJIAN') return
    function onBlur() {
      if (pelanggaranActiveRef.current) return
      pelanggaranActiveRef.current = true
      pelanggRef.current++
      laporPelanggaran('WINDOW_BLUR', `Keluar aplikasi ke-${pelanggRef.current}`)
      setWarningMsg('⚠ Anda keluar dari aplikasi ujian!')
      setShowWarningOverlay(true)
    }
    window.addEventListener('blur', onBlur)
    return () => window.removeEventListener('blur', onBlur)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase])

  // ── Keluar fullscreen saat ujian selesai ──────────────────────────────────
  useEffect(() => {
    if ((phase === 'SELESAI' || phase === 'RESET_KODE') && isFullscreen()) {
      exitFullscreen().catch(() => {})
    }
  }, [phase])

  // ── Polling status sesi setiap 10 detik — jika SELESAI, paksa submit ─────
  const cekStatusSesi = useCallback(async () => {
    const currentSesi = sesiInfoRef.current
    const currentPhase = phaseRef.current
    if (!currentSesi || currentPhase !== 'UJIAN') return
    try {
      const res = await apiRequest<{ status?: string; sesi_status?: string } | null>(
        `/api/siswa/ujian/cek-sesi?sesiId=${currentSesi.sesiId}`
      )
      if (res && (res as { sesi_status?: string }).sesi_status === 'SELESAI') {
        // Sesi ditutup pengawas → paksa selesai
        clearInterval(timerRef.current!)
        clearInterval(syncRef.current!)
        clearInterval(sesiPollRef.current!)
        await handleSelesai(true)
      }
    } catch { /* silent */ }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (phase !== 'UJIAN') return
    sesiPollRef.current = setInterval(cekStatusSesi, 10000)
    return () => clearInterval(sesiPollRef.current!)
  }, [phase, cekStatusSesi])

  // ── Timer ─────────────────────────────────────────────────────────────────
  const sisaWaktuRef = useRef(0)
  useEffect(() => { sisaWaktuRef.current = sisaWaktu }, [sisaWaktu])

  useEffect(() => {
    if (phase !== 'UJIAN') return
    timerRef.current = setInterval(() => {
      setSisaWaktu(prev => {
        if (prev <= 1) {
          clearInterval(timerRef.current!)
          setTimeout(() => handleSelesai(true), 0)
          return 0
        }
        return prev - 1
      })
    }, 1000)
    return () => clearInterval(timerRef.current!)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase])

  // ── Auto sync ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (phase !== 'UJIAN') return
    syncRef.current = setInterval(() => syncJawaban(), 30000)
    return () => clearInterval(syncRef.current!)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase])

  const syncJawaban = useCallback(async () => {
    const currentSesi = sesiInfoRef.current
    const currentJawaban = jawabanRef.current
    if (!currentSesi || Object.keys(currentJawaban).length === 0) return
    try {
      await apiRequest('/api/siswa/ujian/sync', {
        method: 'POST',
        body: JSON.stringify({
          sesiId: currentSesi.sesiId,
          jawaban: Object.entries(currentJawaban).map(([soal_id, jwb]) => ({ soal_id, jawaban: jwb })),
        }),
      })
    } catch (e) { console.warn('Sync failed:', e) }
  }, [])

  async function laporPelanggaran(jenis: string, detail: string) {
    const currentSesi = sesiInfoRef.current
    if (!currentSesi) return
    try {
      const res = await apiRequest<{ perlu_reset?: boolean; level?: number }>('/api/siswa/ujian/pelanggaran', {
        method: 'POST',
        body: JSON.stringify({ sesiId: currentSesi.sesiId, jenis, detail }),
      })
      // Setelah lapor pelanggaran, tampilkan overlay (sudah dihandle)
      // Pengawas yang akan memberikan kode reset
      if (res?.perlu_reset) {
        // Overlay warning sudah ditampilkan di event handler masing-masing
        // Tidak perlu action tambahan di sini — pengawas akan reset via dashboard
      }
    } catch (e) { console.warn(e) }
  }

  async function handleMasukUjian() {
    if (!kode.trim()) { setError('Masukkan kode sesi terlebih dahulu'); return }
    setLoading(true); setError('')
    try {
      const user = JSON.parse(localStorage.getItem('user') ?? '{}')
      const res = await apiRequest<{ 
        valid: boolean
        message?: string
        perlu_kode_reset?: boolean
        sesiId?: string
      } & SesiInfo>('/api/siswa/ujian/validasi', {
        method: 'POST',
        body: JSON.stringify({ kodeSesi: kode.trim().toUpperCase(), nis: user.nis }),
      })

      // Siswa dalam status RESET — perlu kode 7 digit dari pengawas
      if (!res.valid && res.perlu_kode_reset && res.sesiId) {
        setPendingResetSesiId(res.sesiId)
        setPhase('RESET_KODE')
        return
      }

      if (!res.valid) { setError(res.message ?? 'Kode tidak valid'); return }
      setSesiInfo(res)
      setSisaWaktu(res.durasi * 60)
      setPhase('UJIAN')
      setTimeout(() => {
        requestFullscreen(document.documentElement).catch(() => {})
      }, 100)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Gagal memvalidasi kode')
    } finally { setLoading(false) }
  }

  async function handleVerifikasiReset() {
    if (!kodeReset.trim()) { setKodeResetError('Masukkan kode reset dari pengawas'); return }
    if (!pendingResetSesiId) return
    setKodeResetLoading(true); setKodeResetError('')
    try {
      const res = await apiRequest<{ valid: boolean; message?: string }>('/api/siswa/ujian/verifikasi-reset', {
        method: 'POST',
        body: JSON.stringify({ sesiId: pendingResetSesiId, kodeReset: kodeReset.trim().toUpperCase() }),
      })
      if (!res.valid) { setKodeResetError(res.message ?? 'Kode tidak valid'); return }
      
      // Kode valid — lanjutkan ujian dengan kode sesi yang sama
      // Ambil soal lagi menggunakan kode sesi asli
      setKodeReset('')
      setPhase('KODE')
      setKode(kode) // kode sesi yang sudah dimasukkan sebelumnya
      // Langsung trigger masuk ujian
      setLoading(true)
      try {
        const user = JSON.parse(localStorage.getItem('user') ?? '{}')
        const sesiRes = await apiRequest<{ valid: boolean; message?: string } & SesiInfo>('/api/siswa/ujian/validasi', {
          method: 'POST',
          body: JSON.stringify({ kodeSesi: kode.trim().toUpperCase(), nis: user.nis }),
        })
        if (!sesiRes.valid) { setError(sesiRes.message ?? 'Gagal masuk ujian'); setPhase('KODE'); return }
        setSesiInfo(sesiRes)
        setSisaWaktu(sesiRes.durasi * 60)
        setPhase('UJIAN')
        setTimeout(() => requestFullscreen(document.documentElement).catch(() => {}), 100)
      } finally { setLoading(false) }
    } catch (err: unknown) {
      setKodeResetError(err instanceof Error ? err.message : 'Gagal memverifikasi kode')
    } finally { setKodeResetLoading(false) }
  }

  async function handleSelesai(isTimeout = false) {
    if (submitting) return
    setConfirmSelesai(false)
    setSubmitting(true)
    clearInterval(timerRef.current!)
    clearInterval(syncRef.current!)
    clearInterval(sesiPollRef.current!)

    try {
      await syncJawaban()
      const user = JSON.parse(localStorage.getItem('user') ?? '{}')
      const currentSesi = sesiInfoRef.current
      const res = await apiRequest<{ nilai: number; benar: number; total: number; grade: string; lulus: boolean }>('/api/siswa/ujian/selesai', {
        method: 'POST',
        body: JSON.stringify({
          sesiId: currentSesi!.sesiId,
          nis: user.nis,
          isTimeout,
        }),
      })
      setHasilNilai(res)
      setPhase('SELESAI')
    } catch (err: unknown) {
      console.error(err)
    } finally { setSubmitting(false) }
  }

  function handleKembaliFullscreen() {
    // Tidak lagi dipakai langsung — digantikan handleVerifikasiResetDariOverlay
    requestFullscreen(document.documentElement).catch(() => {})
    setShowWarningOverlay(false)
    setWarningMsg('')
  }

  async function handleVerifikasiResetDariOverlay() {
    if (!kodeReset.trim()) { setKodeResetError('Masukkan kode reset dari pengawas'); return }
    const currentSesi = sesiInfoRef.current
    if (!currentSesi) return
    setKodeResetLoading(true); setKodeResetError('')
    try {
      const res = await apiRequest<{ valid: boolean; message?: string }>('/api/siswa/ujian/verifikasi-reset', {
        method: 'POST',
        body: JSON.stringify({ sesiId: currentSesi.sesiId, kodeReset: kodeReset.trim().toUpperCase() }),
      })
      if (!res.valid) { setKodeResetError(res.message ?? 'Kode tidak valid'); return }
      setKodeReset('')
      setKodeResetError('')
      setShowWarningOverlay(false)
      setWarningMsg('')
      pelanggaranActiveRef.current = false
      requestFullscreen(document.documentElement).catch(() => {})
    } catch (err: unknown) {
      setKodeResetError(err instanceof Error ? err.message : 'Gagal memverifikasi kode')
    } finally { setKodeResetLoading(false) }
  }

  const formatWaktu = (detik: number) => {
    const m = Math.floor(detik / 60)
    const s = detik % 60
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  }

  const soalList = sesiInfo?.soalList ?? []
  const soalCurrent = soalList[currentIdx]
  const totalDijawab = Object.values(jawaban).filter(Boolean).length
  const opsiLabels = ['A', 'B', 'C', 'D', 'E']

  // ── Phase: KODE ──────────────────────────────────────────────────────────
  if (phase === 'KODE') {
    return (
      <div className="max-w-md mx-auto animate-fade-in">
        <div className="card text-center">
          <div className="w-16 h-16 bg-brand-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <BookOpen className="w-8 h-8 text-brand-600" />
          </div>
          <h1 className="text-xl font-bold text-slate-900 mb-2">Masuk Ujian</h1>
          <p className="text-sm text-slate-500 mb-6">Masukkan kode sesi yang diberikan pengawas</p>

          {error && (
            <div className="alert-error mb-4 text-left">
              <AlertTriangle className="w-4 h-4 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <input
            type="text"
            className="input text-center text-2xl font-mono tracking-widest uppercase mb-4"
            placeholder="XXXXXXX"
            maxLength={7}
            value={kode}
            onChange={e => setKode(e.target.value.toUpperCase())}
            onKeyDown={e => e.key === 'Enter' && handleMasukUjian()}
            autoFocus
          />

          <button onClick={handleMasukUjian} disabled={loading} className="btn-primary w-full justify-center py-3">
            {loading ? <Spinner size="sm" /> : 'Masuk Ujian'}
          </button>

          <div className="mt-4 text-xs text-slate-400 space-y-1">
            <p>• Pastikan koneksi internet stabil sebelum memulai</p>
            <p>• Layar akan otomatis masuk mode fullscreen saat ujian dimulai</p>
            <p>• Jangan berpindah tab/aplikasi saat ujian berlangsung</p>
            <p>• Jawaban tersimpan otomatis setiap 30 detik</p>
          </div>
        </div>
      </div>
    )
  }

  // ── Phase: RESET_KODE — siswa harus masukkan kode 7 digit dari pengawas ──
  if (phase === 'RESET_KODE') {
    return (
      <div className="max-w-md mx-auto animate-fade-in">
        <div className="card text-center">
          <div className="w-16 h-16 bg-amber-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <KeyRound className="w-8 h-8 text-amber-600" />
          </div>
          <h1 className="text-xl font-bold text-slate-900 mb-2">Akun Di-Reset Pengawas</h1>
          <p className="text-sm text-slate-500 mb-2">
            Akun Anda di-reset oleh pengawas karena terdeteksi pelanggaran.
          </p>
          <p className="text-sm font-semibold text-amber-700 mb-6">
            Minta kode 7 digit kepada pengawas untuk melanjutkan ujian.
          </p>

          {kodeResetError && (
            <div className="alert-error mb-4 text-left">
              <AlertTriangle className="w-4 h-4 flex-shrink-0" />
              <span>{kodeResetError}</span>
            </div>
          )}

          <input
            type="text"
            className="input text-center text-2xl font-mono tracking-widest uppercase mb-4"
            placeholder="XXXXXXX"
            maxLength={7}
            value={kodeReset}
            onChange={e => setKodeReset(e.target.value.toUpperCase())}
            onKeyDown={e => e.key === 'Enter' && handleVerifikasiReset()}
            autoFocus
          />

          <button onClick={handleVerifikasiReset} disabled={kodeResetLoading} className="btn-primary w-full justify-center py-3">
            {kodeResetLoading ? <Spinner size="sm" /> : 'Lanjutkan Ujian'}
          </button>

          <p className="mt-4 text-xs text-slate-400">
            Hubungi pengawas di ruangan untuk mendapatkan kode reset.
          </p>
        </div>
      </div>
    )
  }

  // ── Phase: DIKELUARKAN (3x pelanggaran → nilai 0) ─────────────────────────
  if (dikeluarkan) {
    return (
      <div className="max-w-md mx-auto animate-fade-in">
        <div className="card text-center">
          <div className="w-20 h-20 bg-red-100 rounded-3xl flex items-center justify-center mx-auto mb-4">
            <LogOut className="w-10 h-10 text-red-600" />
          </div>
          <h2 className="text-xl font-bold text-slate-900 mb-2">Ujian Dihentikan</h2>
          <p className="text-sm text-slate-500 mb-4">
            Anda telah melanggar aturan ujian sebanyak 3 kali. Sistem secara otomatis menghentikan ujian Anda.
          </p>
          <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 mb-6">
            <p className="text-sm font-semibold text-red-700">Nilai Anda: 0</p>
            <p className="text-xs text-red-500 mt-1">Hubungi pengawas atau guru untuk informasi lebih lanjut.</p>
          </div>
          <button onClick={() => window.location.href = '/siswa'} className="btn-secondary w-full justify-center">
            Kembali ke Beranda
          </button>
        </div>
      </div>
    )
  }

  // ── Phase: SELESAI ────────────────────────────────────────────────────────
  if (phase === 'SELESAI' && hasilNilai) {
    return (
      <div className="max-w-md mx-auto animate-fade-in">
        <div className="card text-center">
          <div className={`w-20 h-20 rounded-3xl flex items-center justify-center mx-auto mb-4 ${
            hasilNilai.lulus ? 'bg-emerald-100' : 'bg-red-100'
          }`}>
            {hasilNilai.lulus
              ? <CheckCircle className="w-10 h-10 text-emerald-600" />
              : <AlertTriangle className="w-10 h-10 text-red-500" />
            }
          </div>
          <h2 className="text-xl font-bold text-slate-900 mb-1">
            {hasilNilai.lulus ? 'Selamat! Anda Lulus' : 'Ujian Selesai'}
          </h2>
          <p className="text-sm text-slate-500 mb-6">{sesiInfo?.namaMapel}</p>

          <div className="grid grid-cols-3 gap-4 mb-6">
            <div className="bg-slate-50 rounded-xl p-4">
              <div className="text-3xl font-bold text-slate-900">{hasilNilai.nilai}</div>
              <div className="text-xs text-slate-400 mt-1">Nilai</div>
            </div>
            <div className={`rounded-xl p-4 ${
              hasilNilai.grade === 'A' ? 'bg-emerald-50' :
              hasilNilai.grade === 'B' ? 'bg-blue-50' :
              hasilNilai.grade === 'C' ? 'bg-yellow-50' :
              'bg-red-50'
            }`}>
              <div className={`text-3xl font-bold ${
                hasilNilai.grade === 'A' ? 'text-emerald-700' :
                hasilNilai.grade === 'B' ? 'text-blue-700' :
                hasilNilai.grade === 'C' ? 'text-yellow-700' :
                'text-red-700'
              }`}>{hasilNilai.grade}</div>
              <div className="text-xs text-slate-400 mt-1">Grade</div>
            </div>
            <div className="bg-slate-50 rounded-xl p-4">
              <div className="text-3xl font-bold text-slate-900">{hasilNilai.benar}/{hasilNilai.total}</div>
              <div className="text-xs text-slate-400 mt-1">Benar</div>
            </div>
          </div>

          <button onClick={() => window.location.href = '/siswa'} className="btn-primary w-full justify-center">
            Kembali ke Beranda
          </button>
        </div>
      </div>
    )
  }

  // ── Phase: UJIAN ──────────────────────────────────────────────────────────
  if (!soalCurrent) return <div className="flex justify-center py-20"><Spinner size="lg" /></div>

  const opsiUjian = opsiLabels.slice(0, soalCurrent.jumlah_opsi)

  return (
    <>
      {/* Overlay peringatan saat keluar fullscreen / pindah tab */}
      {showWarningOverlay && (
        <div
          className="fixed inset-0 z-[9999] flex flex-col items-center justify-center"
          style={{ background: 'rgba(15,23,42,0.97)' }}
        >
          <div className="max-w-sm w-full mx-4 bg-white rounded-2xl p-8 text-center shadow-2xl">
            <div className="w-16 h-16 bg-red-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <AlertTriangle className="w-8 h-8 text-red-600" />
            </div>
            <h2 className="text-lg font-bold text-slate-900 mb-2">Pelanggaran Terdeteksi!</h2>
            <p className="text-sm text-slate-600 mb-1">{warningMsg}</p>
            <p className="text-xs text-red-500 font-medium mb-4">
              Pelanggaran ke-{pelanggRef.current} — Aktivitas ini dilaporkan ke pengawas
            </p>
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-4 text-left">
              <p className="text-xs text-amber-700 font-semibold mb-1">⚠ Diperlukan Kode dari Pengawas</p>
              <p className="text-xs text-amber-600">Hubungi pengawas dan minta kode 7 digit untuk melanjutkan ujian.</p>
            </div>
            {kodeResetError && (
              <div className="alert-error mb-3 text-left text-xs flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                <span>{kodeResetError}</span>
              </div>
            )}
            <input
              type="text"
              className="input text-center text-xl font-mono tracking-widest uppercase mb-3"
              placeholder="KODE RESET"
              maxLength={7}
              value={kodeReset}
              onChange={e => { setKodeReset(e.target.value.toUpperCase()); setKodeResetError('') }}
              onKeyDown={e => e.key === 'Enter' && handleVerifikasiResetDariOverlay()}
              autoFocus
            />
            <button
              onClick={handleVerifikasiResetDariOverlay}
              disabled={kodeResetLoading}
              className="btn-primary w-full justify-center py-3 text-base"
            >
              {kodeResetLoading ? <Spinner size="sm" /> : (
                <>
                  <KeyRound className="w-4 h-4" />
                  Masukkan Kode &amp; Lanjutkan Ujian
                </>
              )}
            </button>
          </div>
        </div>
      )}

      <div className="max-w-3xl mx-auto space-y-4 animate-fade-in select-none">
        {/* Header */}
        <div className="card py-3 flex items-center justify-between gap-4">
          <div>
            <div className="font-semibold text-slate-900 text-sm">{sesiInfo?.namaMapel}</div>
            <div className="text-xs text-slate-400">{totalDijawab}/{soalList.length} terjawab</div>
          </div>
          <div className={`flex items-center gap-2 px-4 py-2 rounded-xl font-mono font-bold text-lg ${
            sisaWaktu < 300 ? 'bg-red-50 text-red-600' :
            sisaWaktu < 600 ? 'bg-amber-50 text-amber-600' :
            'bg-brand-50 text-brand-700'
          }`}>
            <Clock className="w-4 h-4" />
            {formatWaktu(sisaWaktu)}
          </div>
          <button
            onClick={() => setConfirmSelesai(true)}
            className="btn-success btn-sm"
            disabled={submitting}
          >
            <Send className="w-3.5 h-3.5" />
            {submitting ? 'Menyimpan...' : 'Selesai'}
          </button>
        </div>

        {/* Navigator */}
        <div className="card py-3">
          <div className="flex flex-wrap gap-1.5">
            {soalList.map((s, i) => (
              <button
                key={s.id}
                onClick={() => setCurrentIdx(i)}
                className={`w-8 h-8 rounded-lg text-xs font-medium transition-all ${
                  i === currentIdx
                    ? 'bg-brand-600 text-white shadow-sm'
                    : jawaban[s.id]
                    ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                {i + 1}
              </button>
            ))}
          </div>
        </div>

        {/* Soal */}
        <div className="card">
          <div className="flex items-center gap-2 mb-4">
            <span className="badge-blue font-semibold">Soal {currentIdx + 1}</span>
            <span className="text-slate-400 text-xs">dari {soalList.length}</span>
          </div>
          <p className="text-slate-800 text-base leading-relaxed mb-6">{soalCurrent.teks}</p>

          <div className="space-y-2">
            {opsiUjian.map(label => {
              const opsiText = soalCurrent[`opsi_${label.toLowerCase()}` as keyof Soal] as string
              const isSelected = jawaban[soalCurrent.id] === label
              return (
                <button
                  key={label}
                  onClick={() => setJawaban(prev => ({ ...prev, [soalCurrent.id]: label }))}
                  className={`soal-opsi w-full text-left ${isSelected ? 'soal-opsi-selected' : 'soal-opsi-default'}`}
                >
                  <span className={`w-7 h-7 rounded-lg text-xs font-bold flex items-center justify-center flex-shrink-0 transition-colors ${
                    isSelected ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-600'
                  }`}>
                    {label}
                  </span>
                  <span className="text-slate-800">{opsiText}</span>
                </button>
              )
            })}
          </div>

          {/* Navigation */}
          <div className="flex items-center justify-between mt-6 pt-4 border-t border-slate-100">
            <button
              onClick={() => setCurrentIdx(prev => Math.max(0, prev - 1))}
              disabled={currentIdx === 0}
              className="btn-secondary btn-sm disabled:opacity-40"
            >
              <ChevronLeft className="w-4 h-4" /> Sebelumnya
            </button>
            <span className="text-sm text-slate-400">{currentIdx + 1} / {soalList.length}</span>
            <button
              onClick={() => setCurrentIdx(prev => Math.min(soalList.length - 1, prev + 1))}
              disabled={currentIdx === soalList.length - 1}
              className="btn-secondary btn-sm disabled:opacity-40"
            >
              Berikutnya <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>

        <Confirm
          open={confirmSelesai}
          onClose={() => setConfirmSelesai(false)}
          onConfirm={() => handleSelesai(false)}
          title="Selesaikan Ujian?"
          message={`Anda baru menjawab ${totalDijawab} dari ${soalList.length} soal. Pastikan semua soal sudah dijawab. Ujian tidak bisa diulang setelah diselesaikan.`}
          confirmLabel="Ya, Selesaikan"
          variant="primary"
          loading={submitting}
        />
      </div>
    </>
  )
}
