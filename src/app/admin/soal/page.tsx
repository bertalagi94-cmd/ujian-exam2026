'use client'

import { useState, useEffect, useCallback } from 'react'
import { CheckCircle, XCircle, Eye, BookOpen, RotateCcw } from 'lucide-react'
import { Modal, StatusBadge, EmptyState, Spinner, Toast, Badge } from '@/components/ui'
import { apiRequest, formatDateTime } from '@/lib/utils'
import { PaketSoal, Soal, PaketEssay, SoalEssay } from '@/types'

type CombinedPaket = PaketSoal | PaketEssay
type CombinedSoal = Soal | SoalEssay

export default function AdminSoalPage() {
  const [jenisSoal, setJenisSoal] = useState<'PG' | 'ESSAY'>('PG')
  const [pakets, setPakets] = useState<CombinedPaket[]>([])
  const [activeTab, setActiveTab] = useState<'MENUNGGU' | 'DISETUJUI' | 'DITOLAK'>('MENUNGGU')
  const [loading, setLoading] = useState(true)
  const [previewPaket, setPreviewPaket] = useState<CombinedPaket | null>(null)
  const [soalPreview, setSoalPreview] = useState<CombinedSoal[]>([])
  const [loadingSoal, setLoadingSoal] = useState(false)
  const [catatanTolak, setCatatanTolak] = useState('')
  const [actionId, setActionId] = useState<string | null>(null)
  const [actionType, setActionType] = useState<'SETUJUI' | 'TOLAK' | 'BATAL_SETUJUI' | null>(null)
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null)

  // FIX (tidak ada notif per tab): sebelumnya admin harus buka tab "Soal PG"
  // dan "Soal Essay" satu-satu untuk tahu mana yang ada paket menunggu —
  // badge sidebar juga sebelumnya tidak menghitung Essay sama sekali (lihat
  // FIX di src/app/api/notif/route.ts). Sekarang kedua jumlah ini diambil
  // sekali dari /api/notif (endpoint yang sama dipakai badge sidebar) dan
  // ditampilkan sebagai badge kecil di toggle "Soal PG" / "Soal Essay" —
  // supaya admin langsung tahu, tanpa perlu klik-klik, tab mana yang perlu
  // ditinjau.
  const [pendingCounts, setPendingCounts] = useState<{ PG: number; ESSAY: number }>({ PG: 0, ESSAY: 0 })

  const showToast = (msg: string, type: 'success' | 'error' = 'success') => setToast({ msg, type })

  const loadPendingCounts = useCallback(async () => {
    try {
      const res = await apiRequest<{ validasiSoalPg?: number; validasiSoalEssay?: number }>('/api/notif')
      setPendingCounts({ PG: res.validasiSoalPg ?? 0, ESSAY: res.validasiSoalEssay ?? 0 })
    } catch { /* badge opsional — biarkan diam kalau gagal, tidak menghalangi halaman utama */ }
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      if (jenisSoal === 'ESSAY') {
        const res = await apiRequest<{ data: PaketEssay[] }>(`/api/admin/soal-essay?status=${activeTab}`)
        setPakets(res.data)
      } else {
        const res = await apiRequest<{ data: PaketSoal[] }>(`/api/admin/soal?status=${activeTab}`)
        setPakets(res.data)
      }
    } finally { setLoading(false) }
  }, [activeTab, jenisSoal])

  useEffect(() => { load() }, [load])
  useEffect(() => { loadPendingCounts() }, [loadPendingCounts])

  async function openPreview(p: CombinedPaket) {
    setPreviewPaket(p)
    setLoadingSoal(true)
    try {
      if (jenisSoal === 'ESSAY') {
        const res = await apiRequest<{ data: SoalEssay[] }>(`/api/admin/soal-essay/${p.id}/soal`)
        setSoalPreview(res.data)
      } else {
        const res = await apiRequest<{ data: Soal[] }>(`/api/admin/soal/${p.id}/soal`)
        setSoalPreview(res.data)
      }
    } finally { setLoadingSoal(false) }
  }

  async function handleAction() {
    if (!actionId || !actionType) return
    setSaving(true)
    try {
      await apiRequest(jenisSoal === 'ESSAY' ? '/api/admin/soal-essay' : '/api/admin/soal', {
        method: 'POST',
        body: JSON.stringify({ paket_id: actionId, action: actionType, catatan: catatanTolak }),
      })
      showToast(
        actionType === 'SETUJUI'
          ? 'Paket berhasil disetujui'
          : actionType === 'TOLAK'
          ? 'Paket berhasil ditolak'
          : 'Persetujuan berhasil dibatalkan'
      )
      setActionId(null)
      setActionType(null)
      setCatatanTolak('')
      load()
      loadPendingCounts()
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Gagal memproses', 'error')
    } finally { setSaving(false) }
  }

  // FIX (tidak ada opsi setujui massal): sebelumnya kalau ada banyak paket
  // menunggu (mis. semua guru mengumpulkan paket menjelang tenggat), admin
  // harus klik "Setujui" satu per satu untuk tiap paket. Tombol ini hanya
  // muncul di tab "Menunggu Validasi" saat ada LEBIH DARI 1 paket, dan
  // memproses tiap paket LEWAT endpoint approve yang SAMA persis dengan
  // tombol "Setujui" individual (satu per satu, berurutan — bukan paralel)
  // supaya aturan yang sudah ada di server (mis. auto-mengembalikan paket
  // lain yang DISETUJUI untuk mapel+kelas yang sama ke DRAFT — lihat FIX BUG
  // KRITIS di src/app/api/admin/soal/route.ts) tetap berjalan dengan urutan
  // yang bisa diprediksi, bukan race condition antar request paralel.
  const [bulkConfirmOpen, setBulkConfirmOpen] = useState(false)
  const [bulkSaving, setBulkSaving] = useState(false)
  const [bulkProgress, setBulkProgress] = useState({ done: 0, total: 0 })

  async function handleSetujuiSemua() {
    setBulkSaving(true)
    const target = [...pakets]
    setBulkProgress({ done: 0, total: target.length })
    let sukses = 0
    let gagal = 0
    for (const p of target) {
      try {
        await apiRequest(jenisSoal === 'ESSAY' ? '/api/admin/soal-essay' : '/api/admin/soal', {
          method: 'POST',
          body: JSON.stringify({ paket_id: p.id, action: 'SETUJUI' }),
        })
        sukses++
      } catch {
        gagal++
      }
      setBulkProgress(prog => ({ ...prog, done: prog.done + 1 }))
    }
    setBulkSaving(false)
    setBulkConfirmOpen(false)
    if (gagal === 0) {
      showToast(`${sukses} paket berhasil disetujui sekaligus`)
    } else {
      showToast(`${sukses} paket disetujui, ${gagal} gagal — coba lagi satu per satu untuk yang gagal`, 'error')
    }
    load()
    loadPendingCounts()
  }

  // Kombinasi mapel+kelas yang muncul lebih dari sekali di antara paket yang
  // sedang ditampilkan — dipakai untuk memberi peringatan eksplisit di modal
  // konfirmasi "Setujui Semua", karena SERVER hanya mengizinkan SATU paket
  // DISETUJUI per kombinasi mapel+kelas (paket lain otomatis dikembalikan ke
  // draft). Tanpa peringatan ini, admin bisa kaget kenapa sebagian paket yang
  // baru "disetujui semua" balik lagi ke status Draft.
  const mapelKelasDuplikat = (() => {
    const seen = new Map<string, number>()
    for (const p of pakets) {
      const kunci = `${p.mapel_id}__${p.kelas_id}`
      seen.set(kunci, (seen.get(kunci) ?? 0) + 1)
    }
    return [...seen.values()].some(v => v > 1)
  })()

  const tabs: Array<{ key: typeof activeTab; label: string; color: string }> = [
    { key: 'MENUNGGU', label: 'Menunggu Validasi', color: 'text-amber-600' },
    { key: 'DISETUJUI', label: 'Disetujui', color: 'text-emerald-600' },
    { key: 'DITOLAK', label: 'Ditolak', color: 'text-red-600' },
  ]

  return (
    <div className="space-y-6 animate-fade-in">
      {toast && <Toast message={toast.msg} type={toast.type} onClose={() => setToast(null)} />}

      <div>
        <h1 className="page-title">Validasi Soal</h1>
        <p className="page-subtitle">Tinjau dan setujui paket soal dari guru</p>
      </div>

      {/* Toggle jenis soal — FIX: masing-masing tombol sekarang punya badge
          kecil berisi jumlah paket berstatus MENUNGGU untuk jenis itu, jadi
          admin langsung tahu tab mana yang perlu ditinjau tanpa harus klik
          bolak-balik. Badge sengaja tetap tampil walau tab yang sedang aktif
          BUKAN "Menunggu Validasi", supaya info ini tidak hilang begitu saja
          hanya karena admin sedang melihat tab Disetujui/Ditolak. */}
      <div className="flex gap-1 bg-slate-100 p-1 rounded-xl w-fit">
        <button
          onClick={() => setJenisSoal('PG')}
          className={`relative px-4 py-2 rounded-lg text-sm font-medium transition-all ${
            jenisSoal === 'PG' ? 'bg-white shadow-card text-slate-900' : 'text-slate-500 hover:text-slate-700'
          }`}
        >
          Soal PG
          {pendingCounts.PG > 0 && (
            <span className="ml-1.5 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-amber-500 text-white text-[10px] font-bold align-middle">
              {pendingCounts.PG > 99 ? '99+' : pendingCounts.PG}
            </span>
          )}
        </button>
        <button
          onClick={() => setJenisSoal('ESSAY')}
          className={`relative px-4 py-2 rounded-lg text-sm font-medium transition-all ${
            jenisSoal === 'ESSAY' ? 'bg-white shadow-card text-slate-900' : 'text-slate-500 hover:text-slate-700'
          }`}
        >
          Soal Essay
          {pendingCounts.ESSAY > 0 && (
            <span className="ml-1.5 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-amber-500 text-white text-[10px] font-bold align-middle">
              {pendingCounts.ESSAY > 99 ? '99+' : pendingCounts.ESSAY}
            </span>
          )}
        </button>
      </div>

      {/* Tabs — FIX: badge jumlah juga ditambahkan khusus di tab "Menunggu
          Validasi" untuk jenis soal yang sedang aktif, sebagai penegasan
          angka yang sama dengan badge toggle di atas. */}
      <div className="flex gap-1 bg-slate-100 p-1 rounded-xl w-fit">
        {tabs.map(t => (
          <button key={t.key}
            onClick={() => setActiveTab(t.key)}
            className={`relative px-4 py-2 rounded-lg text-sm font-medium transition-all ${
              activeTab === t.key
                ? 'bg-white shadow-card text-slate-900'
                : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            {t.label}
            {t.key === 'MENUNGGU' && pendingCounts[jenisSoal] > 0 && (
              <span className="ml-1.5 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-amber-500 text-white text-[10px] font-bold align-middle">
                {pendingCounts[jenisSoal] > 99 ? '99+' : pendingCounts[jenisSoal]}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Tombol Setujui Semua — FIX: sebelumnya tidak ada opsi setujui
          massal, admin harus klik "Setujui" satu-satu kalau ada banyak
          paket menunggu. Hanya muncul di tab Menunggu Validasi saat ada
          LEBIH DARI 1 paket. */}
      {activeTab === 'MENUNGGU' && pakets.length > 1 && (
        <div className="flex justify-end">
          <button
            onClick={() => setBulkConfirmOpen(true)}
            className="btn-success btn-sm"
            disabled={saving}
          >
            <CheckCircle className="w-3.5 h-3.5" /> Setujui Semua ({pakets.length})
          </button>
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-20"><Spinner size="lg" /></div>
      ) : pakets.length === 0 ? (
        <div className="card">
          <EmptyState message={`Tidak ada paket dengan status ${activeTab}`} icon={BookOpen} />
        </div>
      ) : (
        <div className="space-y-3">
          {pakets.map(p => (
            <div key={p.id} className="card">
              <div className="flex items-start gap-4 flex-wrap">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <span className="font-semibold text-slate-900">{p.nama_mapel}</span>
                    <span className="badge-blue text-xs">Kelas {p.nama_kelas}</span>
                    <StatusBadge status={p.status} />
                  </div>
                  <div className="text-sm text-slate-500">
                    Guru: <span className="font-medium text-slate-700">{p.nama_guru}</span>
                    &nbsp;· {p.jumlah_soal} soal
                    &nbsp;· Mode {p.mode_jawaban === 'KERTAS' ? 'Kertas' : 'Digital'}
                    &nbsp;· Dikirim {formatDateTime(p.tanggal)}
                  </div>
                  {p.catatan && (
                    <div className="mt-2 text-xs text-slate-600 bg-slate-50 rounded-lg px-3 py-2">
                      Catatan: {p.catatan}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <button onClick={() => openPreview(p)}
                    className="btn-secondary btn-sm">
                    <Eye className="w-3.5 h-3.5" /> Preview
                  </button>
                  {activeTab === 'MENUNGGU' && (
                    <>
                      <button
                        onClick={() => { setActionId(p.id); setActionType('SETUJUI') }}
                        className="btn-success btn-sm"
                        disabled={saving}
                      >
                        <CheckCircle className="w-3.5 h-3.5" /> Setujui
                      </button>
                      <button
                        onClick={() => { setActionId(p.id); setActionType('TOLAK') }}
                        className="btn-danger btn-sm"
                        disabled={saving}
                      >
                        <XCircle className="w-3.5 h-3.5" /> Tolak
                      </button>
                    </>
                  )}
                  {activeTab === 'DISETUJUI' && (
                    <button
                      onClick={() => { setActionId(p.id); setActionType('BATAL_SETUJUI'); setCatatanTolak('') }}
                      className="btn-sm border border-amber-400 text-amber-700 bg-amber-50 hover:bg-amber-100 transition-colors flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium"
                      disabled={saving}
                    >
                      <RotateCcw className="w-3.5 h-3.5" /> Batalkan Persetujuan
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Preview soal modal */}
      <Modal open={!!previewPaket} onClose={() => { setPreviewPaket(null); setSoalPreview([]) }}
        title={`Preview Soal — ${previewPaket?.nama_mapel}`} size="xl">
        {loadingSoal ? (
          <div className="flex justify-center py-10"><Spinner size="lg" /></div>
        ) : (
          <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-1">
            {jenisSoal === 'ESSAY' ? (
              (soalPreview as SoalEssay[]).map((s, i) => (
                <div key={s.id} className="border border-slate-100 rounded-xl p-4">
                  <div className="flex items-start gap-2 mb-3">
                    <span className="badge-blue font-bold flex-shrink-0">{i + 1}</span>
                    <p className="text-sm text-slate-800 leading-relaxed">{s.teks}</p>
                  </div>
                  <div className="pl-6 space-y-2">
                    {s.gambar_url && (
                      <img src={s.gambar_url} alt="Gambar soal" className="max-h-40 rounded-lg border border-slate-200" />
                    )}
                    <p className="text-xs text-slate-500">Bobot Maksimal: <span className="font-medium text-slate-700">{s.bobot_maks}</span></p>
                  </div>
                </div>
              ))
            ) : (
              (soalPreview as Soal[]).map((s, i) => (
                <div key={s.id} className="border border-slate-100 rounded-xl p-4">
                  <div className="flex items-start gap-2 mb-3">
                    <span className="badge-blue font-bold flex-shrink-0">{i + 1}</span>
                    <p className="text-sm text-slate-800 leading-relaxed">{s.teks}</p>
                  </div>
                  <div className="space-y-1.5 pl-6">
                    {['a', 'b', 'c', 'd', 'e'].slice(0, s.jumlah_opsi).map(l => {
                      const opsiText = s[`opsi_${l}` as keyof Soal] as string
                      const isKunci = s.kunci === l.toUpperCase()
                      return (
                        <div key={l} className={`flex items-center gap-2 text-xs px-3 py-2 rounded-lg ${
                          isKunci ? 'bg-emerald-50 text-emerald-800 font-medium' : 'text-slate-600'
                        }`}>
                          <span className={`w-5 h-5 rounded flex items-center justify-center text-[10px] font-bold flex-shrink-0 ${
                            isKunci ? 'bg-emerald-500 text-white' : 'bg-slate-100 text-slate-500'
                          }`}>{l.toUpperCase()}</span>
                          {opsiText}
                          {isKunci && <span className="ml-auto text-emerald-600 text-[10px]">✓ Kunci</span>}
                        </div>
                      )
                    })}
                  </div>
                </div>
              ))
            )}
            {soalPreview.length === 0 && (
              <EmptyState message="Tidak ada soal dalam paket ini" />
            )}
          </div>
        )}
      </Modal>

      {/* Konfirmasi action */}
      <Modal
        open={!!actionId && !!actionType}
        onClose={() => { setActionId(null); setActionType(null) }}
        title={
          actionType === 'SETUJUI'
            ? 'Setujui Paket Soal'
            : actionType === 'TOLAK'
            ? 'Tolak Paket Soal'
            : 'Batalkan Persetujuan'
        }
        size="sm"
        footer={
          <>
            <button onClick={() => { setActionId(null); setActionType(null) }}
              className="btn-secondary" disabled={saving}>Batal</button>
            <button
              onClick={handleAction}
              className={
                actionType === 'SETUJUI'
                  ? 'btn-success'
                  : actionType === 'TOLAK'
                  ? 'btn-danger'
                  : 'border border-amber-400 text-amber-700 bg-amber-50 hover:bg-amber-100 transition-colors rounded-lg px-4 py-2 text-sm font-medium'
              }
              disabled={saving}
            >
              {saving ? <Spinner size="sm" /> : (
                actionType === 'SETUJUI'
                  ? 'Ya, Setujui'
                  : actionType === 'TOLAK'
                  ? 'Ya, Tolak'
                  : 'Ya, Batalkan'
              )}
            </button>
          </>
        }
      >
        {actionType === 'TOLAK' ? (
          <div className="space-y-3">
            <p className="text-sm text-slate-600">Berikan alasan penolakan untuk guru:</p>
            <textarea
              className="textarea"
              rows={3}
              placeholder="Alasan penolakan..."
              value={catatanTolak}
              onChange={e => setCatatanTolak(e.target.value)}
            />
          </div>
        ) : actionType === 'BATAL_SETUJUI' ? (
          <div className="space-y-3">
            <p className="text-sm text-slate-600">
              Paket soal ini akan dikembalikan ke status <span className="font-semibold text-slate-600">Draft</span>. Berikan alasan pembatalan:
            </p>
            <textarea
              className="textarea"
              rows={3}
              placeholder="Alasan pembatalan persetujuan..."
              value={catatanTolak}
              onChange={e => setCatatanTolak(e.target.value)}
            />
            <p className="text-xs text-slate-400">Alasan ini akan dikirimkan sebagai catatan ke guru.</p>
          </div>
        ) : (
          <p className="text-sm text-slate-600">
            Semua soal dalam paket ini akan disetujui dan bisa digunakan dalam ujian. Lanjutkan?
          </p>
        )}
      </Modal>

      {/* Konfirmasi Setujui Semua */}
      <Modal
        open={bulkConfirmOpen}
        onClose={() => { if (!bulkSaving) setBulkConfirmOpen(false) }}
        title={`Setujui Semua Paket (${pakets.length})`}
        size="sm"
        footer={
          <>
            <button onClick={() => setBulkConfirmOpen(false)} className="btn-secondary" disabled={bulkSaving}>
              Batal
            </button>
            <button onClick={handleSetujuiSemua} className="btn-success" disabled={bulkSaving}>
              {bulkSaving ? <Spinner size="sm" /> : 'Ya, Setujui Semua'}
            </button>
          </>
        }
      >
        <div className="space-y-3">
          <p className="text-sm text-slate-600">
            {pakets.length} paket {jenisSoal === 'ESSAY' ? 'Soal Essay' : 'Soal PG'} yang sedang menunggu akan
            disetujui satu per satu secara berurutan. Semua soal di dalamnya langsung bisa dipakai untuk ujian.
          </p>
          {mapelKelasDuplikat && (
            <div className="flex items-start gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              <span>
                ⚠️ Ada lebih dari satu paket untuk kombinasi mata pelajaran + kelas yang sama dalam daftar ini.
                Sistem hanya mengizinkan <span className="font-semibold">satu</span> paket disetujui per
                mapel+kelas — paket yang disetujui lebih dulu akan otomatis dikembalikan ke status Draft begitu
                paket lain untuk mapel+kelas yang sama ikut disetujui setelahnya.
              </span>
            </div>
          )}
          {bulkSaving && (
            <div className="space-y-1.5">
              <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                <div
                  className="h-full bg-emerald-500 transition-all"
                  style={{ width: `${bulkProgress.total ? (bulkProgress.done / bulkProgress.total) * 100 : 0}%` }}
                />
              </div>
              <p className="text-xs text-slate-400 text-center">
                Memproses {bulkProgress.done} dari {bulkProgress.total} paket...
              </p>
            </div>
          )}
        </div>
      </Modal>
    </div>
  )
}
