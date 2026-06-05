'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { Play, Square, Clock, Copy, CheckCircle, RefreshCw, AlertTriangle, ShieldAlert, Eye, Users, RotateCcw, LogOut } from 'lucide-react'
import { PageLoader, StatusBadge, Spinner, Toast, Confirm, Modal } from '@/components/ui'
import { apiRequest, formatDate, generateKodeSesi } from '@/lib/utils'
import { Jadwal, SesiUjian, Siswa } from '@/types'

interface SusulanResult {
  bisa: boolean
  message: string
  sesiBaruId?: string
  kodeSesi?: string
  siswa?: Pick<Siswa, 'nis' | 'nama'>[]
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

interface SiswaAktif {
  nis: string
  nama: string
  kelas: string
  status: string
  waktu_daftar: string
  waktu_selesai?: string
  jumlah_pelanggaran: number
  kode_reset?: string | null
}

interface ResetResult {
  dikunci_permanen: boolean
  kode_reset?: string
  nama_siswa?: string
  reset_ke?: number
  message: string
}

const JENIS_LABEL: Record<string, { label: string; color: string; icon: string }> = {
  TAB_SWITCH:      { label: 'Pindah Tab',       color: 'bg-orange-100 text-orange-700 border-orange-200', icon: '🔀' },
  EXIT_FULLSCREEN: { label: 'Keluar Fullscreen', color: 'bg-red-100 text-red-700 border-red-200',         icon: '⛶' },
  WINDOW_BLUR:     { label: 'Keluar Aplikasi',   color: 'bg-rose-100 text-rose-700 border-rose-200',      icon: '📵' },
  COPY_PASTE:      { label: 'Copy/Paste',        color: 'bg-yellow-100 text-yellow-700 border-yellow-200',icon: '📋' },
}

function jenisInfo(jenis: string) {
  return JENIS_LABEL[jenis] ?? { label: jenis, color: 'bg-slate-100 text-slate-600 border-slate-200', icon: '⚠' }
}

function formatWaktuSingkat(iso: string) {
  const d = new Date(iso)
  return d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

export default function PengawasDashboard() {
  const [jadwal, setJadwal] = useState<Jadwal[]>([])
  const [sesiAktif, setSesiAktif] = useState<SesiUjian[]>([])
  const [loading, setLoading] = useState(true)
  const [mulaiId, setMulaiId] = useState<string | null>(null)
  const [tutupId, setTutupId] = useState<string | null>(null)
  const [susulanSesiId, setSusulanSesiId] = useState<string | null>(null)
  const [susulanResult, setSusulanResult] = useState<SusulanResult | null>(null)
  const [saving, setSaving] = useState(false)
  const [copied, setCopied] = useState<string | null>(null)
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null)
  const [sesiSelesai, setSesiSelesai] = useState<SesiUjian[]>([])

  // Pelanggaran
  const [pelanggaran, setPelanggaran] = useState<Pelanggaran[]>([])
  const [newPelIds, setNewPelIds] = useState<Set<string>>(new Set())
  const [suara, setSuara] = useState(true)
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const seenIdsRef = useRef<Set<string>>(new Set())
  const audioCtxRef = useRef<AudioContext | null>(null)

  // Daftar siswa aktif per sesi
  const [siswaAktifMap, setSiswaAktifMap] = useState<Record<string, SiswaAktif[]>>({})
  const [expandedSesi, setExpandedSesi] = useState<Set<string>>(new Set())

  // Reset siswa
  const [resetTarget, setResetTarget] = useState<{ sesiId: string; nis: string; nama: string } | null>(null)
  const [resetResult, setResetResult] = useState<ResetResult | null>(null)
  const [resetting, setResetting] = useState(false)

  // Notif pelanggaran baru (popup)
  const [pelNotif, setPelNotif] = useState<Pelanggaran | null>(null)

  const showToast = (msg: string, type: 'success' | 'error' = 'success') => setToast({ msg, type })

  function playAlert() {
    try {
      if (!audioCtxRef.current) {
        audioCtxRef.current = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)()
      }
      const ctx = audioCtxRef.current
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.frequency.setValueAtTime(880, ctx.currentTime)
      osc.frequency.setValueAtTime(660, ctx.currentTime + 0.1)
      gain.gain.setValueAtTime(0.3, ctx.currentTime)
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4)
      osc.start(ctx.currentTime)
      osc.stop(ctx.currentTime + 0.4)
    } catch { /* browser mungkin blokir */ }
  }

  const fetchSiswaAktif = useCallback(async (sesiIds: string[]) => {
    if (!sesiIds.length) return
    try {
      const results = await Promise.all(
        sesiIds.map(id => apiRequest<{ data: SiswaAktif[] }>(`/api/pengawas/sesi/${id}/siswa`))
      )
      const map: Record<string, SiswaAktif[]> = {}
      sesiIds.forEach((id, i) => { map[id] = results[i].data ?? [] })
      setSiswaAktifMap(map)
    } catch { /* silent */ }
  }, [])

  const fetchPelanggaran = useCallback(async (sesiIds: string[]) => {
    if (!sesiIds.length) { setPelanggaran([]); return }
    try {
      const results = await Promise.all(
        sesiIds.map(id => apiRequest<{ data: Pelanggaran[] }>(`/api/pengawas/pelanggaran?sesiId=${id}`))
      )
      const all = results.flatMap(r => r.data ?? [])
      all.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())

      const incoming = new Set(all.map(p => p.id))
      const brandNew: string[] = []
      incoming.forEach(id => {
        if (!seenIdsRef.current.has(id)) brandNew.push(id)
      })

      if (brandNew.length > 0 && seenIdsRef.current.size > 0) {
        setNewPelIds(prev => new Set([...prev, ...brandNew]))
        if (suara) playAlert()

        // Tampilkan popup notif untuk pelanggaran terbaru
        const newest = all.find(p => brandNew.includes(p.id))
        if (newest) {
          setPelNotif(newest)
          setTimeout(() => setPelNotif(null), 8000)
        }

        setTimeout(() => {
          setNewPelIds(prev => {
            const next = new Set(prev)
            brandNew.forEach(id => next.delete(id))
            return next
          })
        }, 4000)
      }

      brandNew.forEach(id => seenIdsRef.current.add(id))
      setPelanggaran(all)
    } catch { /* silent */ }
  }, [suara])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [j, s] = await Promise.all([
        apiRequest<{ data: Jadwal[] }>('/api/pengawas/jadwal'),
        apiRequest<{ data: SesiUjian[] }>('/api/pengawas/sesi'),
      ])
      setJadwal(j.data)
      setSesiAktif(s.data)

      const res = await apiRequest<{ data: SesiUjian[] }>('/api/pengawas/sesi?status=SELESAI')
      setSesiSelesai(res.data ?? [])

      await fetchPelanggaran(s.data.map(x => x.id))
      await fetchSiswaAktif(s.data.map(x => x.id))
    } finally { setLoading(false) }
  }, [fetchPelanggaran, fetchSiswaAktif])

  useEffect(() => { load() }, [load])

  // Polling setiap 5 detik
  useEffect(() => {
    if (pollingRef.current) clearInterval(pollingRef.current)
    if (!sesiAktif.length) return
    const ids = sesiAktif.map(s => s.id)
    pollingRef.current = setInterval(async () => {
      await fetchPelanggaran(ids)
      await fetchSiswaAktif(ids)
    }, 5000)
    return () => { if (pollingRef.current) clearInterval(pollingRef.current) }
  }, [sesiAktif, fetchPelanggaran, fetchSiswaAktif])

  async function handleMulai() {
    if (!mulaiId) return
    setSaving(true)
    try {
      const kode = generateKodeSesi()
      await apiRequest('/api/pengawas/sesi', {
        method: 'POST',
        body: JSON.stringify({ jadwalId: mulaiId, kodeSesi: kode }),
      })
      showToast('Sesi ujian berhasil dibuka!')
      setMulaiId(null)
      load()
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Gagal membuka sesi', 'error')
    } finally { setSaving(false) }
  }

  async function handleTutup() {
    if (!tutupId) return
    setSaving(true)
    try {
      await apiRequest(`/api/pengawas/sesi/${tutupId}/tutup`, { method: 'POST' })
      showToast('Sesi ujian berhasil ditutup')
      setTutupId(null)
      load()
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Gagal menutup sesi', 'error')
    } finally { setSaving(false) }
  }

  async function handleSusulan() {
    if (!susulanSesiId) return
    setSaving(true)
    try {
      const res = await apiRequest<SusulanResult>(`/api/pengawas/sesi/${susulanSesiId}/susulan`, { method: 'POST' })
      setSusulanResult(res)
      if (res.bisa) load()
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Gagal membuka ujian susulan', 'error')
    } finally {
      setSaving(false)
      setSusulanSesiId(null)
    }
  }

  async function handleResetSiswa() {
    if (!resetTarget) return
    setResetting(true)
    try {
      const res = await apiRequest<ResetResult>(
        `/api/pengawas/sesi/${resetTarget.sesiId}/reset-siswa`,
        { method: 'POST', body: JSON.stringify({ nis: resetTarget.nis }) }
      )
      setResetResult(res)
      setResetTarget(null)
      // Refresh daftar siswa
      await fetchSiswaAktif(sesiAktif.map(x => x.id))
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Gagal mereset siswa', 'error')
      setResetTarget(null)
    } finally { setResetting(false) }
  }

  function copyKode(kode: string) {
    navigator.clipboard.writeText(kode)
    setCopied(kode)
    setTimeout(() => setCopied(null), 2000)
  }

  function toggleExpandSesi(sesiId: string) {
    setExpandedSesi(prev => {
      const next = new Set(prev)
      if (next.has(sesiId)) next.delete(sesiId)
      else next.add(sesiId)
      return next
    })
  }

  const today = new Date().toISOString().slice(0, 10)

  const ringkasanSiswa = pelanggaran.reduce<Record<string, { nama: string; jumlah: number; terakhir: string }>>((acc, p) => {
    if (!acc[p.nis]) acc[p.nis] = { nama: p.nama_siswa, jumlah: 0, terakhir: p.created_at }
    acc[p.nis].jumlah++
    if (p.created_at > acc[p.nis].terakhir) acc[p.nis].terakhir = p.created_at
    return acc
  }, {})

  if (loading) return <PageLoader />

  return (
    <div className="space-y-8 animate-fade-in">
      {toast && <Toast message={toast.msg} type={toast.type} onClose={() => setToast(null)} />}

      {/* Popup notif pelanggaran baru */}
      {pelNotif && (
        <div className="fixed top-4 right-4 z-[9998] w-80 bg-white rounded-2xl shadow-2xl border border-red-200 p-4 animate-fade-in">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 bg-red-100 rounded-xl flex items-center justify-center flex-shrink-0">
              <AlertTriangle className="w-5 h-5 text-red-600" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-bold text-slate-900 text-sm">⚠ Pelanggaran Baru!</p>
              <p className="text-sm font-semibold text-red-600 truncate">{pelNotif.nama_siswa}</p>
              <p className="text-xs text-slate-500 mt-0.5">
                {jenisInfo(pelNotif.jenis).icon} {jenisInfo(pelNotif.jenis).label} — Ke-{pelNotif.level}
              </p>
              <p className="text-xs text-slate-400 mt-1">{formatWaktuSingkat(pelNotif.created_at)}</p>
            </div>
            <button onClick={() => setPelNotif(null)} className="text-slate-300 hover:text-slate-500 text-lg leading-none">×</button>
          </div>
        </div>
      )}

      <div>
        <h1 className="page-title">Panel Pengawas</h1>
        <p className="page-subtitle">Kelola sesi ujian hari ini</p>
      </div>

      {/* ── Monitor Pelanggaran Real-Time ── */}
      {sesiAktif.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold text-slate-900 flex items-center gap-2">
              <ShieldAlert className={`w-4 h-4 ${pelanggaran.length > 0 ? 'text-red-500' : 'text-slate-400'}`} />
              Monitor Pelanggaran
              {pelanggaran.length > 0 && (
                <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-red-500 text-white">
                  {pelanggaran.length}
                </span>
              )}
            </h2>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setSuara(s => !s)}
                className={`text-xs px-2.5 py-1 rounded-lg border font-medium transition-colors ${
                  suara
                    ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                    : 'bg-slate-50 text-slate-400 border-slate-200'
                }`}
              >
                {suara ? '🔔 Suara On' : '🔕 Suara Off'}
              </button>
              <span className="text-xs text-slate-400 flex items-center gap-1">
                <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-pulse inline-block" />
                Refresh tiap 5 detik
              </span>
            </div>
          </div>

          {pelanggaran.length === 0 ? (
            <div className="card py-6 flex items-center justify-center gap-3 text-slate-400">
              <Eye className="w-5 h-5" />
              <span className="text-sm">Belum ada pelanggaran terdeteksi</span>
            </div>
          ) : (
            <div className="space-y-3">
              {/* Ringkasan per siswa */}
              {Object.keys(ringkasanSiswa).length > 0 && (
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2 mb-1">
                  {Object.entries(ringkasanSiswa)
                    .sort((a, b) => b[1].jumlah - a[1].jumlah)
                    .map(([nis, info]) => {
                      // Cari sesiId untuk siswa ini dari pelanggaran
                      const pel = pelanggaran.find(p => p.nis === nis)
                      const sesiId = pel?.sesi_id
                      return (
                        <div key={nis} className={`rounded-xl border px-3 py-2 text-sm ${
                          info.jumlah >= 3 ? 'bg-red-50 border-red-200' : 'bg-amber-50 border-amber-200'
                        }`}>
                          <div className="font-semibold text-slate-800 truncate">{info.nama}</div>
                          <div className={`text-xs font-bold ${info.jumlah >= 3 ? 'text-red-600' : 'text-amber-600'}`}>
                            {info.jumlah}× pelanggaran
                          </div>
                          {/* Tombol reset langsung dari ringkasan */}
                          {sesiId && (
                            <button
                              onClick={() => setResetTarget({ sesiId, nis, nama: info.nama })}
                              className="mt-1.5 w-full text-xs px-2 py-1 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 flex items-center gap-1 justify-center font-medium text-slate-600"
                            >
                              <RotateCcw className="w-3 h-3" /> Reset Siswa
                            </button>
                          )}
                        </div>
                      )
                    })}
                </div>
              )}

              {/* Log pelanggaran */}
              <div className="card p-0 overflow-hidden">
                <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-100 flex items-center gap-2 text-xs text-slate-500 font-medium">
                  <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
                  Log Aktivitas Mencurigakan (terbaru di atas)
                </div>
                <div className="divide-y divide-slate-50 max-h-72 overflow-y-auto">
                  {pelanggaran.map(p => {
                    const info = jenisInfo(p.jenis)
                    const isNew = newPelIds.has(p.id)
                    return (
                      <div
                        key={p.id}
                        className={`flex items-center gap-3 px-4 py-3 transition-colors duration-700 ${
                          isNew ? 'bg-red-50' : 'bg-white hover:bg-slate-50'
                        }`}
                      >
                        <div className="w-36 flex-shrink-0">
                          <div className="font-semibold text-slate-800 text-sm truncate">{p.nama_siswa}</div>
                          <div className="text-xs text-slate-400 font-mono">{p.nis}</div>
                        </div>

                        <span className={`flex-shrink-0 text-xs font-semibold px-2.5 py-1 rounded-full border ${info.color}`}>
                          {info.icon} {info.label}
                        </span>

                        <div className="flex-1 min-w-0 text-xs text-slate-500 truncate">{p.detail}</div>

                        <div className={`flex-shrink-0 text-xs font-bold px-2 py-0.5 rounded-lg ${
                          p.level >= 3 ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'
                        }`}>
                          Ke-{p.level}
                        </div>

                        <div className="flex-shrink-0 text-xs text-slate-400 font-mono">
                          {formatWaktuSingkat(p.created_at)}
                        </div>

                        {isNew && (
                          <span className="flex-shrink-0 w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Sesi Aktif ── */}
      {sesiAktif.length > 0 && (
        <div>
          <h2 className="font-semibold text-slate-900 mb-3 flex items-center gap-2">
            <span className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse" />
            Sesi Sedang Berjalan ({sesiAktif.length})
          </h2>
          <div className="space-y-3">
            {sesiAktif.map(s => {
              const siswaList = siswaAktifMap[s.id] ?? []
              const isExpanded = expandedSesi.has(s.id)
              const siswaAktifCount = siswaList.filter(sw => sw.status === 'AKTIF').length
              const siswaSelesaiCount = siswaList.filter(sw => sw.status === 'SELESAI').length
              const siswaResetCount = siswaList.filter(sw => sw.status === 'RESET').length
              const siswaTerkunciCount = siswaList.filter(sw => sw.status === 'TERKUNCI').length

              return (
                <div key={s.id} className="card border-l-4 border-emerald-500">
                  <div className="flex items-center justify-between gap-4 flex-wrap">
                    <div>
                      <div className="font-semibold text-slate-900">{s.nama_mapel}</div>
                      <div className="text-sm text-slate-500">Kelas {s.kelas} · {s.jumlah_peserta} peserta</div>
                    </div>
                    <div className="flex items-center gap-3 flex-wrap">
                      {/* Statistik siswa */}
                      <div className="flex items-center gap-2 text-xs">
                        <span className="px-2 py-0.5 bg-emerald-50 text-emerald-700 rounded-lg font-medium">{siswaAktifCount} aktif</span>
                        {siswaSelesaiCount > 0 && <span className="px-2 py-0.5 bg-blue-50 text-blue-700 rounded-lg font-medium">{siswaSelesaiCount} selesai</span>}
                        {siswaResetCount > 0 && <span className="px-2 py-0.5 bg-amber-50 text-amber-700 rounded-lg font-medium">{siswaResetCount} di-reset</span>}
                        {siswaTerkunciCount > 0 && <span className="px-2 py-0.5 bg-red-50 text-red-700 rounded-lg font-medium">{siswaTerkunciCount} terkunci</span>}
                      </div>
                      <div className="flex items-center gap-2 bg-slate-50 rounded-xl px-4 py-2">
                        <span className="font-mono text-2xl font-bold text-brand-700 tracking-widest">
                          {s.kode_sesi}
                        </span>
                        <button
                          onClick={() => copyKode(s.kode_sesi)}
                          className="btn-ghost btn-icon btn-sm"
                        >
                          {copied === s.kode_sesi
                            ? <CheckCircle className="w-4 h-4 text-emerald-500" />
                            : <Copy className="w-4 h-4 text-slate-400" />
                          }
                        </button>
                      </div>
                      <button
                        onClick={() => toggleExpandSesi(s.id)}
                        className="btn-secondary btn-sm"
                      >
                        <Users className="w-3.5 h-3.5" />
                        {isExpanded ? 'Sembunyikan' : 'Daftar Siswa'}
                      </button>
                      <button
                        onClick={() => setTutupId(s.id)}
                        className="btn-danger btn-sm"
                      >
                        <Square className="w-3.5 h-3.5" /> Tutup Sesi
                      </button>
                    </div>
                  </div>

                  {/* Daftar siswa (expandable) */}
                  {isExpanded && (
                    <div className="mt-4 border-t border-slate-100 pt-4">
                      <div className="flex items-center justify-between mb-3">
                        <h3 className="text-sm font-semibold text-slate-700">Daftar Siswa dalam Sesi</h3>
                        <span className="text-xs text-slate-400">{siswaList.length} siswa terdaftar</span>
                      </div>

                      {siswaList.length === 0 ? (
                        <p className="text-xs text-slate-400 text-center py-4">Belum ada siswa yang masuk</p>
                      ) : (
                        <div className="space-y-1.5 max-h-80 overflow-y-auto">
                          {siswaList.map(sw => (
                            <div key={sw.nis} className={`flex items-center gap-3 px-3 py-2 rounded-xl text-sm ${
                              sw.status === 'TERKUNCI' ? 'bg-red-50 border border-red-100' :
                              sw.status === 'RESET' ? 'bg-amber-50 border border-amber-100' :
                              sw.status === 'SELESAI' ? 'bg-slate-50' :
                              'bg-white border border-slate-100'
                            }`}>
                              {/* Nama */}
                              <div className="flex-1 min-w-0">
                                <div className="font-medium text-slate-800 truncate">{sw.nama}</div>
                                <div className="text-xs text-slate-400 font-mono">{sw.nis}</div>
                              </div>

                              {/* Status badge */}
                              <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                                sw.status === 'AKTIF' ? 'bg-emerald-100 text-emerald-700' :
                                sw.status === 'SELESAI' ? 'bg-blue-100 text-blue-700' :
                                sw.status === 'RESET' ? 'bg-amber-100 text-amber-700' :
                                'bg-red-100 text-red-700'
                              }`}>
                                {sw.status === 'AKTIF' ? '● Sedang Ujian' :
                                 sw.status === 'SELESAI' ? '✓ Selesai' :
                                 sw.status === 'RESET' ? '⏳ Menunggu Kode' :
                                 '🔒 Terkunci'}
                              </span>

                              {/* Jumlah pelanggaran */}
                              {sw.jumlah_pelanggaran > 0 && (
                                <span className={`text-xs font-bold px-2 py-0.5 rounded-lg ${
                                  sw.jumlah_pelanggaran >= 3 ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'
                                }`}>
                                  {sw.jumlah_pelanggaran}× langgar
                                </span>
                              )}

                              {/* Kode reset aktif */}
                              {sw.kode_reset && sw.status === 'RESET' && (
                                <div className="flex items-center gap-1.5 bg-amber-100 rounded-lg px-2 py-1">
                                  <span className="font-mono text-xs font-bold text-amber-800">{sw.kode_reset}</span>
                                  <button onClick={() => copyKode(sw.kode_reset!)} className="text-amber-600 hover:text-amber-800">
                                    {copied === sw.kode_reset ? <CheckCircle className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                                  </button>
                                </div>
                              )}

                              {/* Tombol reset (hanya untuk yang AKTIF atau sudah RESET) */}
                              {(sw.status === 'AKTIF' || sw.status === 'RESET') && (
                                <button
                                  onClick={() => setResetTarget({ sesiId: s.id, nis: sw.nis, nama: sw.nama })}
                                  className="flex-shrink-0 text-xs px-2.5 py-1.5 bg-white border border-slate-200 rounded-lg hover:bg-amber-50 hover:border-amber-200 flex items-center gap-1 font-medium text-slate-600 hover:text-amber-700 transition-colors"
                                >
                                  <RotateCcw className="w-3 h-3" /> Reset
                                </button>
                              )}

                              {/* Logout permanen jika sudah terkunci */}
                              {sw.status === 'TERKUNCI' && (
                                <div className="flex items-center gap-1 text-xs text-red-600 font-medium">
                                  <LogOut className="w-3 h-3" /> Di-logout
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* ── Jadwal Hari Ini ── */}
      <div>
        <h2 className="font-semibold text-slate-900 mb-3">Jadwal Hari Ini</h2>
        {jadwal.filter(j => j.tanggal === today).length === 0 ? (
          <div className="card">
            <div className="flex items-center gap-3 text-slate-400 py-4 justify-center">
              <Clock className="w-5 h-5" />
              <span className="text-sm">Tidak ada jadwal ujian hari ini</span>
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            {jadwal.filter(j => j.tanggal === today).map(j => {
              const alreadyRunning = sesiAktif.some(s => s.jadwal_id === j.id)
              return (
                <div key={j.id} className="card py-4 flex items-center gap-4">
                  <div className="w-10 h-10 bg-brand-50 rounded-xl flex items-center justify-center flex-shrink-0">
                    <Clock className="w-5 h-5 text-brand-600" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-slate-900">{j.nama_mapel}</div>
                    <div className="text-sm text-slate-500">
                      Kelas {j.kelas} · {j.jam_mulai}–{j.jam_selesai} · {j.durasi} menit
                    </div>
                  </div>
                  <StatusBadge status={j.status} />
                  {!alreadyRunning && j.status === 'AKTIF' && (
                    <button onClick={() => setMulaiId(j.id)} className="btn-success btn-sm flex-shrink-0">
                      <Play className="w-3.5 h-3.5" /> Buka Sesi
                    </button>
                  )}
                  {alreadyRunning && (
                    <span className="badge-green flex-shrink-0">Sedang berjalan</span>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* ── Ujian Susulan ── */}
      {sesiSelesai.length > 0 && (
        <div>
          <h2 className="font-semibold text-slate-900 mb-1">Ujian Susulan</h2>
          <p className="text-sm text-slate-400 mb-3">
            Buka kembali akses ujian untuk siswa yang belum hadir.
          </p>
          <div className="space-y-2">
            {sesiSelesai.map(s => (
              <div key={s.id} className="card py-3 flex items-center gap-4">
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-slate-800">{s.nama_mapel}</div>
                  <div className="text-xs text-slate-400">Kelas {s.kelas} · Selesai</div>
                </div>
                <button
                  onClick={() => setSusulanSesiId(s.id)}
                  className="btn-secondary btn-sm flex-shrink-0"
                >
                  <RefreshCw className="w-3.5 h-3.5" /> Buka Susulan
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Jadwal Mendatang ── */}
      <div>
        <h2 className="font-semibold text-slate-900 mb-3">Jadwal Mendatang</h2>
        {jadwal.filter(j => j.tanggal > today).length === 0 ? (
          <p className="text-sm text-slate-400">Tidak ada jadwal mendatang</p>
        ) : (
          <div className="space-y-2">
            {jadwal.filter(j => j.tanggal > today).slice(0, 5).map(j => (
              <div key={j.id} className="card py-3 flex items-center gap-4">
                <div className="w-10 text-center">
                  <div className="text-lg font-bold text-slate-700">{new Date(j.tanggal).getDate()}</div>
                  <div className="text-xs text-slate-400">{new Date(j.tanggal).toLocaleDateString('id-ID', { month: 'short' })}</div>
                </div>
                <div className="flex-1">
                  <div className="font-medium text-slate-800">{j.nama_mapel}</div>
                  <div className="text-xs text-slate-400">Kelas {j.kelas} · {j.jam_mulai}–{j.jam_selesai}</div>
                </div>
                <StatusBadge status={j.status} />
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Confirm dialogs */}
      <Confirm open={!!mulaiId} onClose={() => setMulaiId(null)} onConfirm={handleMulai}
        title="Buka Sesi Ujian"
        message="Sesi ujian akan dibuka dan kode akses akan digenerate. Siswa bisa mulai bergabung setelah sesi dibuka."
        confirmLabel="Buka Sesi" variant="primary" loading={saving} />

      <Confirm open={!!tutupId} onClose={() => setTutupId(null)} onConfirm={handleTutup}
        title="Tutup Sesi Ujian"
        message="Sesi ujian akan ditutup. Siswa yang belum menyelesaikan ujian akan otomatis disubmit. Lanjutkan?"
        confirmLabel="Tutup Sesi" variant="danger" loading={saving} />

      <Confirm open={!!susulanSesiId} onClose={() => setSusulanSesiId(null)} onConfirm={handleSusulan}
        title="Buka Ujian Susulan"
        message="Sistem akan memeriksa apakah ada siswa yang belum mengikuti ujian ini."
        confirmLabel="Cek & Buka" variant="primary" loading={saving} />

      {/* Confirm reset siswa */}
      <Confirm
        open={!!resetTarget}
        onClose={() => setResetTarget(null)}
        onConfirm={handleResetSiswa}
        title="Reset Siswa?"
        message={`Siswa ${resetTarget?.nama} akan di-reset dan harus memasukkan kode 7 digit baru untuk melanjutkan ujian. Jawaban yang sudah dijawab tidak akan hilang. Jika ini adalah reset ke-3, siswa akan di-logout permanen dan nilainya menjadi 0.`}
        confirmLabel="Reset Siswa"
        variant="danger"
        loading={resetting}
      />

      {/* Modal hasil reset */}
      {resetResult && (
        <Modal
          open={!!resetResult}
          onClose={() => setResetResult(null)}
          title={resetResult.dikunci_permanen ? '🔒 Siswa Di-logout Permanen' : '🔑 Kode Reset Siswa'}
          footer={<button onClick={() => setResetResult(null)} className="btn-primary">Tutup</button>}
        >
          <div className="space-y-4">
            <p className={`text-sm font-medium ${resetResult.dikunci_permanen ? 'text-red-700' : 'text-emerald-700'}`}>
              {resetResult.message}
            </p>
            {!resetResult.dikunci_permanen && resetResult.kode_reset && (
              <div>
                <p className="text-xs text-slate-500 mb-2">
                  Berikan kode ini kepada <strong>{resetResult.nama_siswa}</strong> untuk melanjutkan ujian:
                </p>
                <div className="bg-amber-50 border border-amber-200 rounded-xl px-5 py-4 flex items-center justify-between">
                  <div>
                    <span className="text-xs text-slate-500">Kode Reset (Reset ke-{resetResult.reset_ke})</span>
                    <div className="font-mono text-3xl font-bold text-amber-700 tracking-widest mt-1">
                      {resetResult.kode_reset}
                    </div>
                  </div>
                  <button
                    onClick={() => copyKode(resetResult.kode_reset!)}
                    className="btn-ghost btn-icon"
                  >
                    {copied === resetResult.kode_reset
                      ? <CheckCircle className="w-5 h-5 text-emerald-500" />
                      : <Copy className="w-5 h-5 text-slate-400" />
                    }
                  </button>
                </div>
                <p className="text-xs text-amber-600 mt-2 font-medium">
                  ⚠ Kode ini hanya berlaku untuk {resetResult.nama_siswa} dan hanya satu kali pakai.
                </p>
                {resetResult.reset_ke && resetResult.reset_ke >= 3 && (
                  <p className="text-xs text-red-600 mt-1 font-semibold">
                    🚨 Ini adalah reset terakhir. Jika terjadi pelanggaran lagi, siswa akan di-logout permanen.
                  </p>
                )}
              </div>
            )}
          </div>
        </Modal>
      )}

      {susulanResult && (
        <Modal open={!!susulanResult} onClose={() => setSusulanResult(null)}
          title={susulanResult.bisa ? 'Sesi Susulan Dibuka' : 'Ujian Susulan Tidak Diperlukan'}
          footer={<button onClick={() => setSusulanResult(null)} className="btn-primary">Tutup</button>}
        >
          <div className="space-y-3">
            <p className={`text-sm font-medium ${susulanResult.bisa ? 'text-emerald-700' : 'text-slate-600'}`}>
              {susulanResult.message}
            </p>
            {susulanResult.bisa && susulanResult.kodeSesi && (
              <div className="bg-brand-50 rounded-xl px-5 py-4 flex items-center justify-between">
                <span className="text-sm text-slate-600">Kode Sesi Susulan</span>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-2xl font-bold text-brand-700 tracking-widest">
                    {susulanResult.kodeSesi}
                  </span>
                  <button onClick={() => copyKode(susulanResult.kodeSesi!)} className="btn-ghost btn-icon btn-sm">
                    {copied === susulanResult.kodeSesi
                      ? <CheckCircle className="w-4 h-4 text-emerald-500" />
                      : <Copy className="w-4 h-4 text-slate-400" />}
                  </button>
                </div>
              </div>
            )}
            {susulanResult.bisa && susulanResult.siswa && susulanResult.siswa.length > 0 && (
              <div>
                <p className="text-xs text-slate-500 mb-2">Siswa yang bisa mengikuti ujian susulan:</p>
                <div className="space-y-1 max-h-48 overflow-y-auto">
                  {susulanResult.siswa.map(s => (
                    <div key={s.nis} className="flex items-center gap-2 text-sm py-1 border-b border-slate-50">
                      <span className="font-mono text-xs text-slate-400 w-24">{s.nis}</span>
                      <span className="text-slate-700">{s.nama}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </Modal>
      )}
    </div>
  )
}
