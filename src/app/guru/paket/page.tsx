'use client'

import { useState, useEffect, useCallback } from 'react'
import { Plus, Send, RotateCcw, Eye, ChevronDown, ChevronUp } from 'lucide-react'
import { Modal, Confirm, StatusBadge, EmptyState, Spinner, Toast, Badge } from '@/components/ui'
import { apiRequest, formatDateTime } from '@/lib/utils'
import { PaketSoal, Mapel, Kelas } from '@/types'

export default function GuruPaketPage() {
  const [pakets, setPakets] = useState<PaketSoal[]>([])
  const [mapelList, setMapelList] = useState<Mapel[]>([])
  const [kelasList, setKelasList] = useState<Kelas[]>([])
  const [loading, setLoading] = useState(true)
  const [modalOpen, setModalOpen] = useState(false)
  const [kirimId, setKirimId] = useState<string | null>(null)
  const [tarikId, setTarikId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const showToast = (msg: string, type: 'success' | 'error' = 'success') =>
    setToast({ msg, type })

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await apiRequest<{ data: PaketSoal[] }>('/api/guru/paket')
      setPakets(res.data)
    } finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])
  useEffect(() => {
    Promise.all([
      apiRequest<{ data: Mapel[] }>('/api/admin/mapel'),
      apiRequest<{ data: Kelas[] }>('/api/admin/kelas'),
    ]).then(([m, k]) => { setMapelList(m.data); setKelasList(k.data) })
  }, [])

  async function handleCreate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    setSaving(true)
    try {
      await apiRequest('/api/guru/paket', { method: 'POST', body: JSON.stringify(Object.fromEntries(fd)) })
      showToast('Paket berhasil dibuat')
      setModalOpen(false)
      load()
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Gagal membuat paket', 'error')
    } finally { setSaving(false) }
  }

  async function handleKirim() {
    if (!kirimId) return
    setSaving(true)
    try {
      await apiRequest(`/api/guru/paket/${kirimId}/kirim`, { method: 'POST' })
      showToast('Paket berhasil dikirim untuk validasi')
      setKirimId(null)
      load()
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Gagal mengirim', 'error')
    } finally { setSaving(false) }
  }

  async function handleTarik() {
    if (!tarikId) return
    setSaving(true)
    try {
      await apiRequest(`/api/guru/paket/${tarikId}/tarik`, { method: 'POST' })
      showToast('Paket berhasil ditarik')
      setTarikId(null)
      load()
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Gagal menarik', 'error')
    } finally { setSaving(false) }
  }

  const statusActions: Record<string, React.ReactNode> = {
    DRAFT: null,
    MENUNGGU: null,
    DITOLAK: null,
    DISETUJUI: null,
  }

  return (
    <div className="space-y-6 animate-fade-in">
      {toast && <Toast message={toast.msg} type={toast.type} onClose={() => setToast(null)} />}

      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="page-title">Paket Soal</h1>
          <p className="page-subtitle">Kelompokkan soal menjadi paket untuk dikirim ke admin</p>
        </div>
        <button onClick={() => setModalOpen(true)} className="btn-primary btn-sm">
          <Plus className="w-4 h-4" /> Buat Paket
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-20"><Spinner size="lg" /></div>
      ) : pakets.length === 0 ? (
        <div className="card">
          <EmptyState message="Belum ada paket soal. Buat paket baru untuk mengelompokkan soal Anda." />
        </div>
      ) : (
        <div className="space-y-3">
          {pakets.map(p => (
            <div key={p.id} className="card p-0 overflow-hidden">
              <div className="flex items-center gap-4 p-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-slate-900">{p.nama_mapel}</span>
                    <span className="text-slate-400 text-xs">·</span>
                    <span className="text-sm text-slate-600">Kelas {p.nama_kelas}</span>
                    <StatusBadge status={p.status} />
                  </div>
                  <div className="text-xs text-slate-400 mt-1">
                    {p.jumlah_soal} soal · Dibuat {formatDateTime(p.tanggal)}
                  </div>
                  {p.catatan && (
                    <div className="mt-2 text-xs text-amber-700 bg-amber-50 rounded-lg px-3 py-2 border border-amber-100">
                      📝 Catatan Admin: {p.catatan}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  {p.status === 'DRAFT' && (
                    <button onClick={() => setKirimId(p.id)} className="btn-primary btn-sm">
                      <Send className="w-3.5 h-3.5" /> Kirim
                    </button>
                  )}
                  {p.status === 'MENUNGGU' && (
                    <button onClick={() => setTarikId(p.id)} className="btn-secondary btn-sm">
                      <RotateCcw className="w-3.5 h-3.5" /> Tarik
                    </button>
                  )}
                  {p.status === 'DITOLAK' && (
                    <button onClick={() => setKirimId(p.id)} className="btn-primary btn-sm">
                      <Send className="w-3.5 h-3.5" /> Kirim Ulang
                    </button>
                  )}
                  <button
                    onClick={() => setExpandedId(expandedId === p.id ? null : p.id)}
                    className="btn-ghost btn-icon btn-sm"
                  >
                    {expandedId === p.id ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {expandedId === p.id && (
                <div className="border-t border-slate-100 p-4 bg-slate-50">
                  <p className="text-xs text-slate-500 text-center py-4">
                    Klik "Tambah Soal" di halaman Bank Soal dan pilih paket ini, atau buka halaman detail paket untuk melihat soal.
                  </p>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Create Modal */}
      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="Buat Paket Soal Baru"
        footer={
          <>
            <button onClick={() => setModalOpen(false)} className="btn-secondary" disabled={saving}>Batal</button>
            <button form="paket-form" type="submit" className="btn-primary" disabled={saving}>
              {saving ? <Spinner size="sm" /> : 'Buat Paket'}
            </button>
          </>
        }
      >
        <form id="paket-form" onSubmit={handleCreate} className="space-y-4">
          <div>
            <label className="label">Mata Pelajaran *</label>
            <select name="mapel_id" className="select" required>
              <option value="">Pilih Mapel</option>
              {mapelList.map(m => <option key={m.id} value={m.id}>{m.nama}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Kelas *</label>
            <select name="kelas_id" className="select" required>
              <option value="">Pilih Kelas</option>
              {kelasList.map(k => <option key={k.id} value={k.id}>{k.nama}</option>)}
            </select>
          </div>
          <div className="alert-info text-xs">
            Setelah paket dibuat, tambahkan soal ke paket ini melalui halaman Bank Soal.
            Paket yang sudah siap kirim ke admin untuk divalidasi.
          </div>
        </form>
      </Modal>

      <Confirm open={!!kirimId} onClose={() => setKirimId(null)} onConfirm={handleKirim}
        title="Kirim Paket untuk Validasi"
        message="Paket akan dikirim ke admin untuk divalidasi. Soal tidak bisa diedit setelah dikirim. Lanjutkan?"
        confirmLabel="Ya, Kirim" variant="primary" loading={saving} />

      <Confirm open={!!tarikId} onClose={() => setTarikId(null)} onConfirm={handleTarik}
        title="Tarik Paket"
        message="Paket akan ditarik kembali ke status DRAFT dan bisa diedit. Lanjutkan?"
        confirmLabel="Ya, Tarik" variant="primary" loading={saving} />
    </div>
  )
}
