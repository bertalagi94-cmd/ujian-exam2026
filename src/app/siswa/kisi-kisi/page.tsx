'use client'

import { useState, useEffect, useCallback } from 'react'
import { FileText, BookOpen, ChevronRight, X, Clock } from 'lucide-react'
import { apiRequest, formatDateTime } from '@/lib/utils'

interface KisiKisiSiswa {
  id: string
  mapel_id: string
  nama_mapel: string
  nama_guru: string
  konten: string
  updated_at: string
}

export default function SiswaKisiKisiPage() {
  const [kisiList, setKisiList] = useState<KisiKisiSiswa[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<KisiKisiSiswa | null>(null)
  const [error, setError] = useState('')

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const res = await apiRequest<{ data: KisiKisiSiswa[] }>('/api/siswa/kisi-kisi')
      setKisiList(res.data ?? [])
    } catch {
      setError('Gagal memuat kisi-kisi')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  if (selected) {
    return (
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center gap-3 mb-6">
          <button
            onClick={() => setSelected(null)}
            className="btn-ghost btn-sm flex items-center gap-1.5"
          >
            <X className="w-4 h-4" /> Kembali
          </button>
          <div className="flex-1">
            <h1 className="text-lg font-bold text-slate-800">{selected.nama_mapel}</h1>
            <p className="text-sm text-slate-500">Oleh: {selected.nama_guru}</p>
          </div>
        </div>
        <div className="card p-6">
          <pre className="whitespace-pre-wrap font-sans text-sm text-slate-700 leading-relaxed">
            {selected.konten}
          </pre>
          <div className="mt-4 pt-4 border-t border-slate-100 text-xs text-slate-400 flex items-center gap-1">
            <Clock className="w-3 h-3" />
            Terakhir diperbarui: {formatDateTime(selected.updated_at)}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-3xl mx-auto">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-slate-800 flex items-center gap-2">
          <FileText className="w-5 h-5 text-cyan-600" /> Kisi-kisi Ujian
        </h1>
        <p className="text-sm text-slate-500 mt-0.5">Kisi-kisi mata pelajaran untuk kelasmu</p>
      </div>

      {error && (
        <div className="mb-4 p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm">{error}</div>
      )}

      {loading ? (
        <div className="text-center py-16 text-slate-400">Memuat kisi-kisi...</div>
      ) : kisiList.length === 0 ? (
        <div className="card p-12 text-center">
          <FileText className="w-10 h-10 text-slate-300 mx-auto mb-3" />
          <p className="text-slate-500 font-medium">Belum ada kisi-kisi</p>
          <p className="text-slate-400 text-sm mt-1">Kisi-kisi akan muncul di sini ketika guru sudah mengirimnya</p>
        </div>
      ) : (
        <div className="space-y-3">
          {kisiList.map(k => (
            <button
              key={k.id}
              onClick={() => setSelected(k)}
              className="card p-4 w-full text-left flex items-center gap-4 hover:shadow-card-md transition-all hover:border-cyan-200 group"
            >
              <div className="w-10 h-10 rounded-xl bg-cyan-50 flex items-center justify-center flex-shrink-0 group-hover:bg-cyan-100 transition-colors">
                <BookOpen className="w-5 h-5 text-cyan-600" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-slate-800 text-sm">{k.nama_mapel}</p>
                <p className="text-xs text-slate-400 mt-0.5 flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  {formatDateTime(k.updated_at)} · {k.nama_guru}
                </p>
              </div>
              <ChevronRight className="w-4 h-4 text-slate-400 group-hover:text-cyan-500 transition-colors flex-shrink-0" />
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
