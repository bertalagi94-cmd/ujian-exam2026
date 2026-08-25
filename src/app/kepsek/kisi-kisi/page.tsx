'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { FileText, Eye, Clock, Users, GraduationCap, ChevronDown } from 'lucide-react'
import { PageLoader, EmptyState, SearchInput, Modal, ScopeWarningBanner } from '@/components/ui'
import { apiRequest, formatDateTime } from '@/lib/utils'

interface KisiKisi {
  id: string
  mapel_id: string
  kelas_id: string
  guru_id: string
  konten: string
  status: 'DRAFT' | 'TERKIRIM'
  created_at: string
  updated_at: string
  nama_mapel: string
  nama_kelas: string
  nama_guru: string
}

export default function KepsekKisiKisiPage() {
  const [kisiList, setKisiList] = useState<KisiKisi[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [scopeWarning, setScopeWarning] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [filterKelas, setFilterKelas] = useState('')
  const [filterStatus, setFilterStatus] = useState<'' | 'DRAFT' | 'TERKIRIM'>('')
  const [preview, setPreview] = useState<KisiKisi | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await apiRequest<{ data: KisiKisi[]; scopeWarning?: string }>('/api/kepsek/kisi-kisi')
      setKisiList(res.data ?? [])
      setScopeWarning(res.scopeWarning ?? null)
    } catch {
      setError('Gagal memuat data kisi-kisi')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const uniqueKelasNames = useMemo(
    () => [...new Set(kisiList.map(k => k.nama_kelas))].sort(),
    [kisiList]
  )

  const filtered = kisiList.filter(k => {
    if (filterKelas && k.nama_kelas !== filterKelas) return false
    if (filterStatus && k.status !== filterStatus) return false
    if (search) {
      const q = search.toLowerCase()
      const cocok =
        k.nama_mapel.toLowerCase().includes(q) ||
        k.nama_kelas.toLowerCase().includes(q) ||
        k.nama_guru.toLowerCase().includes(q)
      if (!cocok) return false
    }
    return true
  })

  const totalTerkirim = kisiList.filter(k => k.status === 'TERKIRIM').length
  const totalDraft = kisiList.filter(k => k.status === 'DRAFT').length

  if (loading) return <PageLoader />

  return (
    <div className="max-w-5xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-xl font-bold text-slate-800 flex items-center gap-2">
          <FileText className="w-5 h-5 text-purple-600" /> Kisi-kisi
        </h1>
        <p className="text-sm text-slate-500 mt-0.5">
          Pantau kisi-kisi yang dibuat dan dikirim guru ke siswa, dari semua mapel dan kelas di jenjang Anda.
        </p>
      </div>

      {error && (
        <div className="mb-4 p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm">{error}</div>
      )}

      {scopeWarning && <ScopeWarningBanner message={scopeWarning} />}

      {/* Ringkasan */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-5">
        <div className="card p-4">
          <p className="text-xs text-slate-400 font-medium uppercase tracking-wide">Total Kisi-kisi</p>
          <p className="text-2xl font-bold text-slate-800 mt-1">{kisiList.length}</p>
        </div>
        <div className="card p-4">
          <p className="text-xs text-slate-400 font-medium uppercase tracking-wide">Terkirim ke Siswa</p>
          <p className="text-2xl font-bold text-emerald-600 mt-1">{totalTerkirim}</p>
        </div>
        <div className="card p-4">
          <p className="text-xs text-slate-400 font-medium uppercase tracking-wide">Masih Draft</p>
          <p className="text-2xl font-bold text-amber-600 mt-1">{totalDraft}</p>
        </div>
      </div>

      {/* Filter */}
      <div className="flex flex-col sm:flex-row gap-3 mb-5">
        <SearchInput value={search} onChange={setSearch} placeholder="Cari mapel, kelas, atau nama guru..." className="flex-1" />
        <div className="relative">
          <select
            value={filterKelas}
            onChange={e => setFilterKelas(e.target.value)}
            className="input-field appearance-none pr-9 cursor-pointer min-w-[160px]"
          >
            <option value="">Semua Kelas</option>
            {uniqueKelasNames.map(nama => (
              <option key={nama} value={nama}>{nama}</option>
            ))}
          </select>
          <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
        </div>
        <div className="relative">
          <select
            value={filterStatus}
            onChange={e => setFilterStatus(e.target.value as '' | 'DRAFT' | 'TERKIRIM')}
            className="input-field appearance-none pr-9 cursor-pointer min-w-[140px]"
          >
            <option value="">Semua Status</option>
            <option value="TERKIRIM">Terkirim</option>
            <option value="DRAFT">Draft</option>
          </select>
          <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
        </div>
      </div>

      {/* List */}
      {filtered.length === 0 ? (
        <EmptyState
          icon={FileText}
          title={kisiList.length === 0 ? 'Belum ada kisi-kisi' : 'Tidak ada yang cocok'}
          description={
            kisiList.length === 0
              ? 'Kisi-kisi yang dibuat guru akan muncul di sini.'
              : 'Coba ubah kata kunci atau filter.'
          }
        />
      ) : (
        <div className="space-y-2">
          {filtered.map(k => (
            <div key={k.id} className="card p-4 flex items-center gap-4 hover:shadow-card-md transition-shadow">
              <div className="w-10 h-10 rounded-xl bg-purple-50 flex items-center justify-center flex-shrink-0">
                <FileText className="w-5 h-5 text-purple-600" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold text-slate-800 text-sm">{k.nama_mapel}</span>
                  <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-slate-100 text-slate-600 flex items-center gap-1">
                    <GraduationCap className="w-3 h-3" /> {k.nama_kelas}
                  </span>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                    k.status === 'TERKIRIM' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'
                  }`}>
                    {k.status === 'TERKIRIM' ? 'Terkirim' : 'Draft'}
                  </span>
                </div>
                <div className="flex items-center gap-3 mt-0.5 text-xs text-slate-400">
                  <span className="flex items-center gap-1"><Users className="w-3 h-3" />{k.nama_guru}</span>
                  <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{formatDateTime(k.updated_at)}</span>
                </div>
              </div>
              <button onClick={() => setPreview(k)} className="btn-ghost btn-icon btn-sm flex-shrink-0" title="Lihat isi">
                <Eye className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Preview modal */}
      <Modal open={!!preview} onClose={() => setPreview(null)} title={preview?.nama_mapel ?? ''} size="lg">
        {preview && (
          <div>
            <div className="flex items-center gap-2 flex-wrap mb-4 text-sm text-slate-500">
              <span className="flex items-center gap-1"><GraduationCap className="w-3.5 h-3.5" />{preview.nama_kelas}</span>
              <span className="flex items-center gap-1"><Users className="w-3.5 h-3.5" />{preview.nama_guru}</span>
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                preview.status === 'TERKIRIM' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'
              }`}>
                {preview.status === 'TERKIRIM' ? 'Terkirim ke Siswa' : 'Draft (belum terlihat siswa)'}
              </span>
            </div>
            <pre className="whitespace-pre-wrap font-sans text-sm text-slate-700 leading-relaxed w-full bg-slate-50 rounded-xl p-4 border border-slate-100">
              {preview.konten}
            </pre>
            <div className="mt-4 pt-3 border-t border-slate-100 text-xs text-slate-400 flex items-center gap-1.5">
              <Clock className="w-3 h-3" />
              Terakhir diperbarui: {formatDateTime(preview.updated_at)}
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
