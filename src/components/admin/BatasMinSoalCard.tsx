'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { ListChecks, Plus, Save, Shield, ToggleLeft, ToggleRight, Trash2 } from 'lucide-react'
import { Spinner } from '@/components/ui'
import { apiRequest } from '@/lib/utils'
import type { BatasMinSoal, JenisSoal, KelompokBatas } from '@/lib/batas-soal'

type Props = { onToast: (msg: string, type?: 'success' | 'error') => void }

// Di UI angka disimpan sebagai string supaya kolom bisa dikosongkan saat mengetik.
type KelompokUI = { min: string; mapel: string[] }
type StateUI = { aktif: boolean; pg: KelompokUI[]; essay: KelompokUI[] }

const norm = (s: string) => s.trim().replace(/\s+/g, ' ').toUpperCase()
const keUI = (k: KelompokBatas[]): KelompokUI[] => k.map(x => ({ min: String(x.min), mapel: x.mapel }))

export default function BatasMinSoalCard({ onToast: onToastProp }: Props) {
  // showToast di halaman induk dibuat ulang tiap render; simpan di ref supaya
  // load() tidak ikut berubah dan memicu pemuatan ulang berulang-ulang.
  const toastRef = useRef(onToastProp)
  toastRef.current = onToastProp
  const onToast = useCallback((msg: string, type?: 'success' | 'error') => toastRef.current(msg, type), [])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [semuaMapel, setSemuaMapel] = useState<string[]>([])
  const [st, setSt] = useState<StateUI>({ aktif: false, pg: [], essay: [] })

  const load = useCallback(async () => {
    try {
      const res = await apiRequest<{ data: BatasMinSoal; mapel: string[] }>('/api/admin/pengaturan/batas-soal')
      setSemuaMapel(res.mapel)
      setSt({ aktif: res.data.aktif, pg: keUI(res.data.pg), essay: keUI(res.data.essay) })
    } catch (e) {
      onToast(e instanceof Error ? e.message : 'Gagal memuat batas minimal soal', 'error')
    } finally {
      setLoading(false)
    }
  }, [onToast])

  useEffect(() => { load() }, [load])

  async function simpan(next: StateUI) {
    setSaving(true)
    try {
      const body = {
        aktif: next.aktif,
        pg: next.pg.map(k => ({ min: Number(k.min), mapel: k.mapel })),
        essay: next.essay.map(k => ({ min: Number(k.min), mapel: k.mapel })),
      }
      const res = await apiRequest<{ message: string; data: BatasMinSoal }>('/api/admin/pengaturan/batas-soal', {
        method: 'PUT',
        body: JSON.stringify(body),
      })
      // Kelompok kosong dibuang server; sinkronkan tampilan dengan yang tersimpan.
      setSt({ aktif: res.data.aktif, pg: keUI(res.data.pg), essay: keUI(res.data.essay) })
      onToast(res.message)
    } catch (e) {
      onToast(e instanceof Error ? e.message : 'Gagal menyimpan', 'error')
    } finally {
      setSaving(false)
    }
  }

  function ubah(jenis: JenisSoal, fn: (arr: KelompokUI[]) => KelompokUI[]) {
    setSt(s => ({ ...s, [jenis]: fn(s[jenis]) }))
  }

  function toggleMapel(jenis: JenisSoal, idx: number, nama: string) {
    ubah(jenis, arr =>
      arr.map((k, i) => {
        if (i !== idx) return k
        const ada = k.mapel.some(m => norm(m) === norm(nama))
        return { ...k, mapel: ada ? k.mapel.filter(m => norm(m) !== norm(nama)) : [...k.mapel, nama] }
      })
    )
  }

  if (loading) {
    return (
      <div className="card flex justify-center py-8"><Spinner size="md" /></div>
    )
  }

  const renderJenis = (jenis: JenisSoal, judul: string) => {
    const daftar = st[jenis]
    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-medium text-slate-800">{judul}</h3>
          <button
            type="button"
            className="btn-secondary btn-sm"
            onClick={() => ubah(jenis, arr => [...arr, { min: '', mapel: [] }])}
          >
            <Plus className="w-4 h-4" /> Tambah kelompok
          </button>
        </div>

        {daftar.length === 0 && (
          <p className="text-sm text-slate-400">
            Belum ada kelompok. Semua mapel memakai aturan bawaan (minimal 1 soal).
          </p>
        )}

        {daftar.map((k, idx) => (
          <div key={idx} className="border border-slate-200 rounded-lg p-3 space-y-3">
            <div className="flex items-center gap-3 flex-wrap">
              <label className="text-sm text-slate-600">Minimal</label>
              <input
                type="number"
                min={1}
                max={500}
                className="input w-24"
                value={k.min}
                onChange={e => ubah(jenis, arr => arr.map((x, i) => (i === idx ? { ...x, min: e.target.value } : x)))}
                placeholder="30"
              />
              <span className="text-sm text-slate-600">soal</span>
              <span className="text-xs text-slate-400">{k.mapel.length} mapel dicentang</span>
              <button
                type="button"
                className="ml-auto text-red-500 hover:text-red-700"
                title="Hapus kelompok"
                onClick={() => ubah(jenis, arr => arr.filter((_, i) => i !== idx))}
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-4 gap-y-1">
              {semuaMapel.map(nama => {
                const dicentangDiSini = k.mapel.some(m => norm(m) === norm(nama))
                const dikelompokLain = daftar.findIndex(
                  (x, i) => i !== idx && x.mapel.some(m => norm(m) === norm(nama))
                )
                return (
                  <label
                    key={nama}
                    className={`flex items-center gap-2 text-sm py-0.5 ${
                      dikelompokLain >= 0 ? 'text-slate-300' : 'text-slate-700 cursor-pointer'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={dicentangDiSini}
                      disabled={dikelompokLain >= 0}
                      onChange={() => toggleMapel(jenis, idx, nama)}
                    />
                    <span>{nama}</span>
                    {dikelompokLain >= 0 && (
                      <span className="text-xs">(kelompok {dikelompokLain + 1})</span>
                    )}
                  </label>
                )
              })}
              {semuaMapel.length === 0 && (
                <p className="text-sm text-slate-400">Belum ada mapel. Tambahkan mapel dulu di menu Mapel.</p>
              )}
            </div>
          </div>
        ))}
      </div>
    )
  }

  return (
    <div className="card space-y-5">
      <div className="flex items-center justify-between gap-3 pb-3 border-b border-slate-100">
        <div className="flex items-center gap-2">
          <ListChecks className="w-4 h-4 text-brand-600" />
          <h2 className="font-semibold text-slate-900">Batas Minimal Jumlah Soal</h2>
          <span className={`badge ${st.aktif ? 'badge-green' : ''}`}>{st.aktif ? 'Aktif' : 'Nonaktif'}</span>
        </div>
        <button
          type="button"
          disabled={saving}
          onClick={() => simpan({ ...st, aktif: !st.aktif })}
          className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
            st.aktif ? 'bg-brand-100 text-brand-700 hover:bg-brand-200' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
          }`}
        >
          {saving ? <Spinner size="sm" /> : st.aktif
            ? <><ToggleRight className="w-4 h-4" /> Nonaktifkan</>
            : <><ToggleLeft className="w-4 h-4" /> Aktifkan</>}
        </button>
      </div>

      <p className="text-sm text-slate-500">
        Opsional. Buat kelompok batas (misalnya 30 soal dan 35 soal), lalu centang mapel yang masuk tiap kelompok.
        Guru tidak bisa mengirim paket untuk validasi bila jumlah soalnya kurang dari batas mapelnya. Mapel yang tidak
        dicentang tetap memakai aturan bawaan (minimal 1 soal). Paket yang sudah dikirim atau disetujui tidak terpengaruh.
      </p>

      {renderJenis('pg', 'Soal Pilihan Ganda (PG)')}
      <div className="border-t border-slate-100" />
      {renderJenis('essay', 'Soal Essay')}

      <div className="flex items-center gap-3 flex-wrap">
        <button type="button" className="btn-primary btn-sm" disabled={saving} onClick={() => simpan(st)}>
          {saving ? <Spinner size="sm" /> : <><Save className="w-4 h-4" /> Simpan Batas Soal</>}
        </button>
        {!st.aktif && (
          <span className="text-xs text-slate-400 flex items-center gap-1">
            <Shield className="w-3 h-3" /> Tersimpan tetapi belum berlaku sampai diaktifkan.
          </span>
        )}
      </div>
    </div>
  )
}
