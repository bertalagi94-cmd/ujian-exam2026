'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { Play, Square, Clock, Copy, CheckCircle, RefreshCw, AlertTriangle, ShieldAlert, Eye } from 'lucide-react'
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

  const showToast = (msg: string, type: 'success' | 'error' = 'success') => setToast({ msg, type })

  // Bunyi notif ringan saat ada pelanggaran baru
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

  const fetchPelanggaran = useCallback(async (sesiIds: string[]) => {
    if (!sesiIds.length) { setPelanggaran([]); return }
    try {
      // Ambil pelanggaran untuk semua sesi aktif
      const results = await Promise.all(
        sesiIds.map(id => apiRequest<{ data: Pelanggaran[] }>(`/api/pengawas/pelanggaran?sesiId=${id}`))
      )
      const all = results.flatMap(r => r.data ?? [])
      // Sort terbaru di atas
      all.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())

      // Deteksi yang baru masuk
      const incoming = new Set(all.map(p => p.id))
      const brandNew: string[] = []
      incoming.forEach(id => {
        if (!seenIdsRef.current.has(id)) brandNew.push(id)
      })

      if (brandNew.length > 0 && seenIdsRef.current.size > 0) {
        // Ada pelanggaran baru (bukan load pertama)
        setNewPelIds(prev => new Set([...prev, ...brandNew]))
        if (suara) playAlert()
        // Hapus highlight setelah 4 detik
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

      // Fetch pelanggaran pertama kali
      await fetchPelanggaran(s.data.map(x => x.id))
    } finally { setLoading(false) }
  }, [fetchPelanggaran])

  useEffect(() => { load() }, [load])

  // Polling pelanggaran setiap 5 detik saat ada sesi aktif
  useEffect(() => {
    if (pollingRef.current) clearInterval(pollingRef.current)
    if (!sesiAktif.length) return
    const ids = sesiAktif.map(s => s.id)
    pollingRef.current = setInterval(() => fetchPelanggaran(ids), 5000)
    return () => { if (pollingRef.current) clearInterval(pollingRef.current) }
  }, [sesiAktif, fetchPelanggaran])

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

  function copyKode(kode: string) {
    navigator.clipboard.writeText(kode)
    setCopied(kode)
    setTimeout(() => setCopied(null), 2000)
  }

  const today = new Date().toISOString().slice(0, 10)

  // Kelompokkan pelanggaran per siswa untuk ringkasan
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
              {/* Toggle suara */}
              <button
                onClick={() => setSuara(s => !s)}
                className={`text-xs px-2.5 py-1 rounded-lg border font-medium transition-colors ${
                  suara
                    ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                    : 'bg-slate-50 text-slate-400 border-slate-200'
                }`}
                title={suara ? 'Matikan suara notif' : 'Aktifkan suara notif'}
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
              {Object.keys(ringkasanSiswa).length > 1 && (
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2 mb-1">
                  {Object.entries(ringkasanSiswa)
                    .sort((a, b) => b[1].jumlah - a[1].jumlah)
                    .map(([nis, info]) => (
                      <div key={nis} className={`rounded-xl border px-3 py-2 text-sm ${
                        info.jumlah >= 3 ? 'bg-red-50 border-red-200' : 'bg-amber-50 border-amber-200'
                      }`}>
                        <div className="font-semibold text-slate-800 truncate">{info.nama}</div>
                        <div className={`text-xs font-bold ${info.jumlah >= 3 ? 'text-red-600' : 'text-amber-600'}`}>
                          {info.jumlah}× pelanggaran
                        </div>
                      </div>
                    ))}
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
                        {/* Nama siswa */}
                        <div className="w-36 flex-shrink-0">
                          <div className="font-semibold text-slate-800 text-sm truncate">{p.nama_siswa}</div>
                          <div className="text-xs text-slate-400 font-mono">{p.nis}</div>
                        </div>

                        {/* Badge jenis */}
                        <span className={`flex-shrink-0 text-xs font-semibold px-2.5 py-1 rounded-full border ${info.color}`}>
                          {info.icon} {info.label}
                        </span>

                        {/* Detail */}
                        <div className="flex-1 min-w-0 text-xs text-slate-500 truncate">{p.detail}</div>

                        {/* Level */}
                        <div className={`flex-shrink-0 text-xs font-bold px-2 py-0.5 rounded-lg ${
                          p.level >= 3 ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'
                        }`}>
                          Ke-{p.level}
                        </div>

                        {/* Waktu */}
                        <div className="flex-shrink-0 text-xs text-slate-400 font-mono">
                          {formatWaktuSingkat(p.created_at)}
                        </div>

                        {/* Indikator baru */}
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
            {sesiAktif.map(s => (
              <div key={s.id} className="card border-l-4 border-emerald-500">
                <div className="flex items-center justify-between gap-4 flex-wrap">
                  <div>
                    <div className="font-semibold text-slate-900">{s.nama_mapel}</div>
                    <div className="text-sm text-slate-500">Kelas {s.kelas} · {s.jumlah_peserta} peserta</div>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="flex items-center gap-2 bg-slate-50 rounded-xl px-4 py-2">
                      <span className="font-mono text-2xl font-bold text-brand-700 tracking-widest">
                        {s.kode_sesi}
                      </span>
                      <button
                        onClick={() => copyKode(s.kode_sesi)}
                        className="btn-ghost btn-icon btn-sm"
                        title="Salin kode"
                      >
                        {copied === s.kode_sesi
                          ? <CheckCircle className="w-4 h-4 text-emerald-500" />
                          : <Copy className="w-4 h-4 text-slate-400" />
                        }
                      </button>
                    </div>
                    <button
                      onClick={() => setTutupId(s.id)}
                      className="btn-danger btn-sm"
                    >
                      <Square className="w-3.5 h-3.5" /> Tutup Sesi
                    </button>
                  </div>
                </div>
              </div>
            ))}
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
            Buka kembali akses ujian untuk siswa yang belum hadir. Sistem akan otomatis memeriksa ketersediaan siswa.
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
