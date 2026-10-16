'use client'
import { useState, useEffect, useCallback } from 'react'
import { Radio, CheckCircle, XCircle, Ban, RefreshCw, ExternalLink } from 'lucide-react'
import { Spinner, EmptyState, Toast, Badge } from '@/components/ui'
import { apiRequest, formatDateTime } from '@/lib/utils'

type Status = 'MENUNGGU' | 'DISETUJUI' | 'DITOLAK' | 'DICABUT'

interface Izin {
  id: string
  username: string
  nama: string | null
  status: Status
  aktif: boolean
  diminta_pada: string
  diputuskan_oleh: string | null
  diputuskan_pada: string | null
  berlaku_sampai: string | null
}

const VARIAN: Record<Status, 'yellow' | 'green' | 'red' | 'slate'> = {
  MENUNGGU: 'yellow', DISETUJUI: 'green', DITOLAK: 'red', DICABUT: 'slate',
}

export default function AdminLayarPantauIzinPage() {
  const [items, setItems] = useState<Izin[]>([])
  const [loading, setLoading] = useState(true)
  const [prosesId, setProsesId] = useState<string | null>(null)
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null)

  const muat = useCallback(async (senyap = false) => {
    if (!senyap) setLoading(true)
    try {
      const res = await apiRequest<{ items: Izin[] }>('/api/admin/layar-pantau-izin')
      setItems(res.items)
    } catch {
      if (!senyap) setToast({ msg: 'Gagal memuat data izin.', type: 'error' })
    } finally {
      if (!senyap) setLoading(false)
    }
  }, [])

  // Muat awal + segarkan tiap 5 detik (hanya saat tab terlihat) supaya
  // permintaan baru dari guru langsung muncul.
  useEffect(() => {
    muat()
    const id = setInterval(() => { if (!document.hidden) muat(true) }, 5000)
    return () => clearInterval(id)
  }, [muat])

  async function putuskan(item: Izin, aksi: 'setujui' | 'tolak' | 'cabut') {
    setProsesId(item.id)
    try {
      await apiRequest('/api/admin/layar-pantau-izin', {
        method: 'PATCH',
        body: JSON.stringify({ id: item.id, aksi }),
      })
      setToast({
        msg: aksi === 'setujui' ? `Izin ${item.nama ?? item.username} disetujui.`
          : aksi === 'tolak' ? 'Permintaan ditolak.' : 'Izin dicabut.',
        type: 'success',
      })
      window.dispatchEvent(new Event('notif-changed'))
      await muat(true)
    } catch (e) {
      setToast({ msg: e instanceof Error ? e.message : 'Gagal menyimpan keputusan.', type: 'error' })
    } finally {
      setProsesId(null)
    }
  }

  const menunggu = items.filter(i => i.status === 'MENUNGGU')
  const riwayat = items.filter(i => i.status !== 'MENUNGGU')

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <Radio className="w-6 h-6 text-brand-600" /> Izin Layar Pantau
          </h1>
          <p className="text-slate-500 text-sm mt-1">
            Guru harus disetujui di sini sebelum bisa membuka Layar Pantau. Izin berlaku 10 jam sejak disetujui.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <a href="/layar-pantau" target="_blank" rel="noopener noreferrer" className="btn-secondary flex items-center gap-1.5 text-sm">
            <ExternalLink className="w-4 h-4" /> Buka Layar Pantau
          </a>
          <button onClick={() => muat()} className="btn-secondary flex items-center gap-1.5 text-sm">
            <RefreshCw className="w-4 h-4" /> Segarkan
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><Spinner size="lg" /></div>
      ) : (
        <>
          <section className="card p-5">
            <h2 className="font-semibold text-slate-800 mb-3">
              Menunggu persetujuan {menunggu.length > 0 && <Badge variant="yellow">{menunggu.length}</Badge>}
            </h2>
            {menunggu.length === 0 ? (
              <EmptyState message="Tidak ada permintaan yang menunggu." icon={Radio} />
            ) : (
              <ul className="divide-y divide-slate-100">
                {menunggu.map(i => (
                  <li key={i.id} className="py-3 flex items-center justify-between gap-3 flex-wrap">
                    <div>
                      <p className="font-semibold text-slate-900">{i.nama ?? i.username}</p>
                      <p className="text-xs text-slate-500">@{i.username} · diminta {formatDateTime(i.diminta_pada)}</p>
                    </div>
                    <div className="flex gap-2">
                      <button disabled={prosesId === i.id} onClick={() => putuskan(i, 'tolak')}
                        className="btn-secondary flex items-center gap-1.5 text-sm text-red-600">
                        <XCircle className="w-4 h-4" /> Tolak
                      </button>
                      <button disabled={prosesId === i.id} onClick={() => putuskan(i, 'setujui')}
                        className="btn-primary flex items-center gap-1.5 text-sm">
                        <CheckCircle className="w-4 h-4" /> Setujui
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="card p-5">
            <h2 className="font-semibold text-slate-800 mb-3">Riwayat</h2>
            {riwayat.length === 0 ? (
              <p className="text-sm text-slate-400">Belum ada riwayat.</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {riwayat.map(i => (
                  <li key={i.id} className="py-3 flex items-center justify-between gap-3 flex-wrap">
                    <div>
                      <p className="font-medium text-slate-800 flex items-center gap-2">
                        {i.nama ?? i.username}
                        <Badge variant={i.status === 'DISETUJUI' && !i.aktif ? 'slate' : VARIAN[i.status]}>
                          {i.status === 'DISETUJUI' ? (i.aktif ? 'Aktif' : 'Habis masa berlaku') : i.status === 'DITOLAK' ? 'Ditolak' : 'Dicabut'}
                        </Badge>
                      </p>
                      <p className="text-xs text-slate-500">
                        Diminta {formatDateTime(i.diminta_pada)}
                        {i.diputuskan_oleh && <> · oleh {i.diputuskan_oleh}</>}
                        {i.aktif && i.berlaku_sampai && <> · berlaku sampai {formatDateTime(i.berlaku_sampai)}</>}
                      </p>
                    </div>
                    {i.aktif && (
                      <button disabled={prosesId === i.id} onClick={() => putuskan(i, 'cabut')}
                        className="btn-secondary flex items-center gap-1.5 text-sm text-red-600">
                        <Ban className="w-4 h-4" /> Cabut izin
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}

      {toast && <Toast message={toast.msg} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  )
}
