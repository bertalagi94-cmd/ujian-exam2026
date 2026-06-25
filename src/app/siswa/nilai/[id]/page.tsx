'use client'

import { useState, useEffect, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { ChevronLeft, CheckCircle2, XCircle } from 'lucide-react'
import { PageLoader, EmptyState, Badge } from '@/components/ui'
import { apiRequest, formatDateTime, nilaiColor } from '@/lib/utils'

interface RincianSoal {
  no: number
  teks: string
  jumlah_opsi: number
  opsi_a?: string; opsi_b?: string; opsi_c?: string; opsi_d?: string; opsi_e?: string
  gambar_pertanyaan?: string | null
  gambar_opsi_a?: string | null; gambar_opsi_b?: string | null; gambar_opsi_c?: string | null
  gambar_opsi_d?: string | null; gambar_opsi_e?: string | null
  benar: boolean
}

interface NilaiDetail {
  id: string; nama_mapel: string; nilai: number; grade: string
  benar: number; total: number; lulus: boolean; kkm: number; timestamp: string
}

const LABELS = ['A', 'B', 'C', 'D', 'E'] as const

export default function RincianNilaiPage() {
  const router = useRouter()
  const params = useParams<{ id: string }>()
  const [nilai, setNilai] = useState<NilaiDetail | null>(null)
  const [rincian, setRincian] = useState<RincianSoal[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await apiRequest<{ nilai: NilaiDetail; rincian: RincianSoal[] }>(`/api/siswa/nilai/${params.id}`)
      setNilai(res.nilai)
      setRincian(res.rincian)
    } catch (e: any) {
      setError(e?.message ?? 'Gagal memuat rincian nilai')
    } finally {
      setLoading(false)
    }
  }, [params.id])

  useEffect(() => { load() }, [load])

  if (loading) return <PageLoader />

  if (error || !nilai) {
    return <EmptyState message={error ?? 'Data tidak ditemukan'} icon={XCircle} />
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <button onClick={() => router.back()} className="btn-secondary btn-sm">
        <ChevronLeft className="w-4 h-4" /> Kembali
      </button>

      <div>
        <h1 className="page-title">{nilai.nama_mapel}</h1>
        <p className="page-subtitle">Rincian hasil ujian per nomor soal</p>
      </div>

      {/* Ringkasan */}
      <div className="card flex flex-wrap items-center gap-6">
        <div>
          <div className="text-xs text-slate-500">Nilai</div>
          <div className={`text-3xl font-bold ${nilaiColor(nilai.nilai)}`}>{nilai.nilai}</div>
        </div>
        <div>
          <div className="text-xs text-slate-500">Grade</div>
          <span className={`badge font-bold ${
            nilai.grade === 'A' ? 'badge-green' :
            nilai.grade === 'B' ? 'badge-blue' :
            nilai.grade === 'C' ? 'badge-yellow' : 'badge-red'
          }`}>{nilai.grade}</span>
        </div>
        <div>
          <div className="text-xs text-slate-500">Benar/Total</div>
          <div className="text-slate-700 font-medium">{nilai.benar}/{nilai.total}</div>
        </div>
        <div>
          <div className="text-xs text-slate-500">Status</div>
          <span className={`badge ${nilai.lulus ? 'badge-green' : 'badge-red'}`}>
            {nilai.lulus ? '✓ Lulus' : '✗ Tidak Lulus'}
          </span>
        </div>
        <div>
          <div className="text-xs text-slate-500">Tanggal</div>
          <div className="text-sm text-slate-500">{formatDateTime(nilai.timestamp)}</div>
        </div>
      </div>

      {/* Daftar soal */}
      <div className="space-y-4">
        {rincian.map(s => (
          <div key={s.no} className="card">
            <div className="flex items-center justify-between gap-2 mb-4">
              <span className="badge-blue font-semibold">Soal {s.no}</span>
              {s.benar ? (
                <span className="badge badge-green flex items-center gap-1">
                  <CheckCircle2 className="w-3.5 h-3.5" /> Benar
                </span>
              ) : (
                <span className="badge badge-red flex items-center gap-1">
                  <XCircle className="w-3.5 h-3.5" /> Salah
                </span>
              )}
            </div>

            <p className="text-slate-800 text-base leading-relaxed mb-4">{s.teks}</p>
            {s.gambar_pertanyaan && (
              <div className="mb-6">
                <img
                  src={s.gambar_pertanyaan}
                  alt="Gambar soal"
                  className="w-full max-w-lg mx-auto rounded-lg border border-slate-200 object-contain block"
                  style={{ maxHeight: '320px' }}
                />
              </div>
            )}

            <div className="space-y-2">
              {LABELS.slice(0, s.jumlah_opsi || 4).map(label => {
                const opsiText = s[`opsi_${label.toLowerCase()}` as keyof RincianSoal] as string | undefined
                const opsiGambar = s[`gambar_opsi_${label.toLowerCase()}` as keyof RincianSoal] as string | null | undefined
                if (!opsiText) return null
                return (
                  <div key={label} className="soal-opsi soal-opsi-default w-full text-left cursor-default">
                    <span className="w-7 h-7 rounded-lg text-xs font-bold flex items-center justify-center flex-shrink-0 bg-slate-100 text-slate-600">
                      {label}
                    </span>
                    <span className="text-slate-800 flex flex-col gap-1">
                      {opsiText}
                      {opsiGambar && (
                        <img
                          src={opsiGambar}
                          alt={`Gambar opsi ${label}`}
                          className="w-full max-w-xs rounded-lg border border-slate-200 mt-1 object-contain"
                          style={{ maxHeight: '160px' }}
                        />
                      )}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
