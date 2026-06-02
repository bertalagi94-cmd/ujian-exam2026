'use client'

import { useState, useEffect, useCallback } from 'react'
import { CheckCircle, XCircle, Eye, BookOpen } from 'lucide-react'
import { Modal, StatusBadge, EmptyState, Spinner, Toast, Badge } from '@/components/ui'
import { apiRequest, formatDateTime } from '@/lib/utils'
import { PaketSoal, Soal } from '@/types'

export default function AdminSoalPage() {
  const [pakets, setPakets] = useState<PaketSoal[]>([])
  const [activeTab, setActiveTab] = useState<'MENUNGGU' | 'DISETUJUI' | 'DITOLAK'>('MENUNGGU')
  const [loading, setLoading] = useState(true)
  const [previewPaket, setPreviewPaket] = useState<PaketSoal | null>(null)
  const [soalPreview, setSoalPreview] = useState<Soal[]>([])
  const [loadingSoal, setLoadingSoal] = useState(false)
  const [catatanTolak, setCatatanTolak] = useState('')
  const [actionId, setActionId] = useState<string | null>(null)
  const [actionType, setActionType] = useState<'SETUJUI' | 'TOLAK' | null>(null)
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null)

  const showToast = (msg: string, type: 'success' | 'error' = 'success') => setToast({ msg, type })

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await apiRequest<{ data: PaketSoal[] }>(`/api/admin/soal?status=${activeTab}`)
      setPakets(res.data)
    } finally { setLoading(false) }
  }, [activeTab])

  useEffect(() => { load() }, [load])

  async function openPreview(p: PaketSoal) {
    setPreviewPaket(p)
    setLoadingSoal(true)
    try {
      const res = await apiRequest<{ data: Soal[] }>(`/api/admin/soal/${p.id}/soal`)
      setSoalPreview(res.data)
    } finally { setLoadingSoal(false) }
  }

  async function handleAction() {
    if (!actionId || !actionType) return
    setSaving(true)
    try {
      await apiRequest('/api/admin/soal', {
        method: 'POST',
        body: JSON.stringify({ paket_id: actionId, action: actionType, catatan: catatanTolak }),
      })
      showToast(`Paket berhasil ${actionType === 'SETUJUI' ? 'disetujui' : 'ditolak'}`)
      setActionId(null)
      setActionType(null)
      setCatatanTolak('')
      load()
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Gagal memproses', 'error')
    } finally { setSaving(false) }
  }

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

      {/* Tabs */}
      <div className="flex gap-1 bg-slate-100 p-1 rounded-xl w-fit">
        {tabs.map(t => (
          <button key={t.key}
            onClick={() => setActiveTab(t.key)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
              activeTab === t.key
                ? 'bg-white shadow-card text-slate-900'
                : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

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
            {soalPreview.map((s, i) => (
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
            ))}
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
        title={actionType === 'SETUJUI' ? 'Setujui Paket Soal' : 'Tolak Paket Soal'}
        size="sm"
        footer={
          <>
            <button onClick={() => { setActionId(null); setActionType(null) }}
              className="btn-secondary" disabled={saving}>Batal</button>
            <button
              onClick={handleAction}
              className={actionType === 'SETUJUI' ? 'btn-success' : 'btn-danger'}
              disabled={saving}
            >
              {saving ? <Spinner size="sm" /> : (actionType === 'SETUJUI' ? 'Ya, Setujui' : 'Ya, Tolak')}
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
        ) : (
          <p className="text-sm text-slate-600">
            Semua soal dalam paket ini akan disetujui dan bisa digunakan dalam ujian. Lanjutkan?
          </p>
        )}
      </Modal>
    </div>
  )
}
