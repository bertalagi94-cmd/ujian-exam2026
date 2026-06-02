'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { BookOpen, Clock, AlertTriangle, CheckCircle, ChevronLeft, ChevronRight, Send } from 'lucide-react'
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
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const syncRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const pelanggRef = useRef(0)

  // Anti-cheat: detect tab switch
  useEffect(() => {
    if (phase !== 'UJIAN') return
    function onVisibilityChange() {
      if (document.hidden) {
        pelanggRef.current++
        laporPelanggaran('TAB_SWITCH', `Perpindahan tab ke-${pelanggRef.current}`)
      }
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => document.removeEventListener('visibilitychange', onVisibilityChange)
  }, [phase])

  // Timer countdown
  useEffect(() => {
    if (phase !== 'UJIAN' || sisaWaktu <= 0) return
    timerRef.current = setInterval(() => {
      setSisaWaktu(prev => {
        if (prev <= 1) {
          clearInterval(timerRef.current!)
          handleSelesai(true)
          return 0
        }
        return prev - 1
      })
    }, 1000)
    return () => clearInterval(timerRef.current!)
  }, [phase, sisaWaktu])

  // Auto sync jawaban every 30s
  useEffect(() => {
    if (phase !== 'UJIAN') return
    syncRef.current = setInterval(() => syncJawaban(), 30000)
    return () => clearInterval(syncRef.current!)
  }, [phase, jawaban])

  async function syncJawaban() {
    if (!sesiInfo || Object.keys(jawaban).length === 0) return
    try {
      await apiRequest('/api/siswa/ujian/sync', {
        method: 'POST',
        body: JSON.stringify({
          sesiId: sesiInfo.sesiId,
          jawaban: Object.entries(jawaban).map(([soal_id, jwb]) => ({ soal_id, jawaban: jwb })),
        }),
      })
    } catch (e) { console.warn('Sync failed:', e) }
  }

  async function laporPelanggaran(jenis: string, detail: string) {
    if (!sesiInfo) return
    try {
      await apiRequest('/api/siswa/ujian/pelanggaran', {
        method: 'POST',
        body: JSON.stringify({ sesiId: sesiInfo.sesiId, jenis, detail }),
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
      const res = await apiRequest<{ nilai: number; benar: number; total: number; grade: string; lulus: boolean }>('/api/siswa/ujian/selesai', {
        method: 'POST',
        body: JSON.stringify({
          sesiId: sesiInfo!.sesiId,
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

  const formatWaktu = (detik: number) => {
    const m = Math.floor(detik / 60)
    const s = detik % 60
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  }

  const soalList = sesiInfo?.soalList ?? []
  const soalCurrent = soalList[currentIdx]
  const totalDijawab = Object.values(jawaban).filter(Boolean).length
  const opsiLabels = ['A', 'B', 'C', 'D', 'E']

  // ── Phase: KODE ──
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
            placeholder="XXXXXX"
            maxLength={6}
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
            <p>• Jangan berpindah tab/aplikasi saat ujian berlangsung</p>
            <p>• Jawaban tersimpan otomatis setiap 30 detik</p>
          </div>
        </div>
      </div>
    )
  }

  // ── Phase: SELESAI ──
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

  // ── Phase: UJIAN ──
  if (!soalCurrent) return <div className="flex justify-center py-20"><Spinner size="lg" /></div>

  const opsiUjian = opsiLabels.slice(0, soalCurrent.jumlah_opsi)

  return (
    <div className="max-w-3xl mx-auto space-y-4 animate-fade-in">
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
  )
}
