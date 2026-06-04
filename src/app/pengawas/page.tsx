'use client'

import { useState, useEffect, useCallback } from 'react'
import { Play, Square, Clock, Copy, CheckCircle, RefreshCw } from 'lucide-react'
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

  // Sesi selesai hari ini (untuk tombol susulan)
  const [sesiSelesai, setSesiSelesai] = useState<SesiUjian[]>([])

  const showToast = (msg: string, type: 'success' | 'error' = 'success') => setToast({ msg, type })

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [j, s] = await Promise.all([
        apiRequest<{ data: Jadwal[] }>('/api/pengawas/jadwal'),
        apiRequest<{ data: SesiUjian[] }>('/api/pengawas/sesi'),
      ])
      setJadwal(j.data)
      setSesiAktif(s.data)

      // Ambil sesi selesai hari ini untuk fitur susulan
      const res = await apiRequest<{ data: SesiUjian[] }>('/api/pengawas/sesi?status=SELESAI')
      setSesiSelesai(res.data ?? [])
    } finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

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

  if (loading) return <PageLoader />

  return (
    <div className="space-y-8 animate-fade-in">
      {toast && <Toast message={toast.msg} type={toast.type} onClose={() => setToast(null)} />}

      <div>
        <h1 className="page-title">Panel Pengawas</h1>
        <p className="page-subtitle">Kelola sesi ujian hari ini</p>
      </div>

      {/* Sesi Aktif */}
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

      {/* Jadwal Hari Ini */}
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

      {/* Ujian Susulan — sesi yang sudah selesai hari ini */}
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

      {/* Jadwal Mendatang */}
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

      {/* Confirm buka sesi */}
      <Confirm
        open={!!mulaiId}
        onClose={() => setMulaiId(null)}
        onConfirm={handleMulai}
        title="Buka Sesi Ujian"
        message="Sesi ujian akan dibuka dan kode akses akan digenerate. Siswa bisa mulai bergabung setelah sesi dibuka."
        confirmLabel="Buka Sesi"
        variant="primary"
        loading={saving}
      />

      {/* Confirm tutup sesi */}
      <Confirm
        open={!!tutupId}
        onClose={() => setTutupId(null)}
        onConfirm={handleTutup}
        title="Tutup Sesi Ujian"
        message="Sesi ujian akan ditutup. Siswa yang belum menyelesaikan ujian akan otomatis disubmit. Lanjutkan?"
        confirmLabel="Tutup Sesi"
        variant="danger"
        loading={saving}
      />

      {/* Confirm buka susulan */}
      <Confirm
        open={!!susulanSesiId}
        onClose={() => setSusulanSesiId(null)}
        onConfirm={handleSusulan}
        title="Buka Ujian Susulan"
        message="Sistem akan memeriksa apakah ada siswa yang belum mengikuti ujian ini. Jika semua sudah ujian, permintaan akan dibatalkan otomatis."
        confirmLabel="Cek & Buka"
        variant="primary"
        loading={saving}
      />

      {/* Modal hasil susulan */}
      {susulanResult && (
        <Modal
          open={!!susulanResult}
          onClose={() => setSusulanResult(null)}
          title={susulanResult.bisa ? 'Sesi Susulan Dibuka' : 'Ujian Susulan Tidak Diperlukan'}
          footer={
            <button onClick={() => setSusulanResult(null)} className="btn-primary">Tutup</button>
          }
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
                  <button
                    onClick={() => copyKode(susulanResult.kodeSesi!)}
                    className="btn-ghost btn-icon btn-sm"
                  >
                    {copied === susulanResult.kodeSesi
                      ? <CheckCircle className="w-4 h-4 text-emerald-500" />
                      : <Copy className="w-4 h-4 text-slate-400" />
                    }
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
