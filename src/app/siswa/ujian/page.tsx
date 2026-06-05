'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { BookOpen, Clock, AlertTriangle, CheckCircle, ChevronLeft, ChevronRight, Send, Maximize } from 'lucide-react'
import { apiRequest } from '@/lib/utils'
import { Soal } from '@/types'
import { Confirm, Spinner } from '@/components/ui'

type Phase = 'KODE' | 'UJIAN' | 'SELESAI'

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

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const syncRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const pelanggRef = useRef(0)
  const jawabanRef = useRef<JawabanMap>({})
  const sesiInfoRef = useRef<SesiInfo | null>(null)

  useEffect(() => { jawabanRef.current = jawaban }, [jawaban])
  useEffect(() => { sesiInfoRef.current = sesiInfo }, [sesiInfo])

  // ── Minta izin blokir notifikasi saat ujian dimulai ───────────────────────
  useEffect(() => {
    if (phase !== 'UJIAN') return
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission() // minta permission → user deny = notif tidak muncul
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

  // ── Jika user keluar fullscreen → tampil overlay peringatan ──────────────
  useEffect(() => {
    if (phase !== 'UJIAN') return
    if (!isFS) {
      // Baru masuk ujian, FS belum aktif → tidak perlu warning
      return
    }
  }, [isFS, phase])

  // ── Deteksi keluar fullscreen saat ujian ─────────────────────────────────
  useEffect(() => {
    if (phase !== 'UJIAN') return

    function onFSChange() {
      if (!isFullscreen()) {
        pelanggRef.current++
        laporPelanggaran('EXIT_FULLSCREEN', `Keluar fullscreen ke-${pelanggRef.current}`)
        setWarningMsg('⚠ Anda keluar dari mode fullscreen! Klik tombol di bawah untuk kembali.')
        setShowWarningOverlay(true)
      } else {
        setShowWarningOverlay(false)
        setWarningMsg('')
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
        pelanggRef.current++
        laporPelanggaran('TAB_SWITCH', `Perpindahan tab ke-${pelanggRef.current}`)
        setWarningMsg(`⚠ Perpindahan tab/aplikasi terdeteksi! (${pelanggRef.current}x)`)
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
        e.ctrlKey && e.key === 'c',   // copy
        e.ctrlKey && e.key === 'v',   // paste
        e.ctrlKey && e.key === 'a',   // select all
        e.ctrlKey && e.key === 'u',   // view source
        e.ctrlKey && e.key === 'p',   // print
        e.ctrlKey && e.shiftKey && e.key === 'I', // devtools
        e.ctrlKey && e.shiftKey && e.key === 'J', // console
        e.ctrlKey && e.shiftKey && e.key === 'C', // inspector
        e.key === 'F12',              // devtools
        e.key === 'PrintScreen',      // screenshot
        e.altKey && e.key === 'Tab',  // alt tab
        e.metaKey,                    // Windows/Mac key
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
      pelanggRef.current++
      laporPelanggaran('WINDOW_BLUR', `Keluar aplikasi ke-${pelanggRef.current}`)
    }
    window.addEventListener('blur', onBlur)
    return () => window.removeEventListener('blur', onBlur)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase])

  // ── Keluar fullscreen saat ujian selesai ──────────────────────────────────
  useEffect(() => {
    if (phase === 'SELESAI' && isFullscreen()) {
      exitFullscreen().catch(() => {})
    }
  }, [phase])

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
    if (!sesiInfoRef.current) return
    try {
      await apiRequest('/api/siswa/ujian/pelanggaran', {
        method: 'POST',
        body: JSON.stringify({ sesiId: sesiInfoRef.current.sesiId, jenis, detail }),
      })
    } catch (e) { console.warn(e) }
  }

  async function handleMasukUjian() {
    if (!kode.trim()) { setError('Masukkan kode sesi terlebih dahulu'); return }
    setLoading(true); setError('')
    try {
      const user = JSON.parse(localStorage.getItem('user') ?? '{}')
      const res = await apiRequest<{ valid: boolean; message?: string } & SesiInfo>('/api/siswa/ujian/validasi', {
        method: 'POST',
        body: JSON.stringify({ kodeSesi: kode.trim().toUpperCase(), nis: user.nis }),
      })
      if (!res.valid) { setError(res.message ?? 'Kode tidak valid'); return }
      setSesiInfo(res)
      setSisaWaktu(res.durasi * 60)
      setPhase('UJIAN')
      // Langsung request fullscreen
      setTimeout(() => {
        requestFullscreen(document.documentElement).catch(() => {})
      }, 100)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Gagal memvalidasi kode')
    } finally { setLoading(false) }
  }

  async function handleSelesai(isTimeout = false) {
    if (submitting) return
    setConfirmSelesai(false)
    setSubmitting(true)
    clearInterval(timerRef.current!)
    clearInterval(syncRef.current!)

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
    requestFullscreen(document.documentElement).catch(() => {})
    setShowWarningOverlay(false)
    setWarningMsg('')
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
            <p className="text-xs text-red-500 font-medium mb-6">
              Pelanggaran ke-{pelanggRef.current} — Aktivitas ini dilaporkan ke pengawas
            </p>
            <button
              onClick={handleKembaliFullscreen}
              className="btn-primary w-full justify-center py-3 text-base"
            >
              <Maximize className="w-4 h-4" />
              Kembali ke Ujian (Fullscreen)
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
