'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { BarChart3, TrendingUp, Trophy, BookOpen, ChevronRight } from 'lucide-react'
import { PageLoader, EmptyState, Badge } from '@/components/ui'
import { apiRequest, formatDateTime, nilaiColor, hitungGrade } from '@/lib/utils'
import { Nilai } from '@/types'

interface NilaiStats { totalUjian: number; rataRata: number; nilaiTertinggi: number; nilaiTerendah: number }

export default function SiswaNilaiPage() {
  const router = useRouter()
  const [nilaiList, setNilaiList] = useState<Nilai[]>([])
  const [stats, setStats] = useState<NilaiStats | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    try {
      const res = await apiRequest<{ data: Nilai[]; stats: NilaiStats }>('/api/siswa/nilai')
      setNilaiList(res.data)
      setStats(res.stats)
    } finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  if (loading) return <PageLoader />

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="page-title">Nilai Saya</h1>
        <p className="page-subtitle">Riwayat semua hasil ujian</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Total Ujian', value: stats?.totalUjian ?? 0, icon: BookOpen, color: 'bg-brand-500' },
          { label: 'Rata-rata', value: stats?.rataRata ?? 0, icon: BarChart3, color: 'bg-emerald-500' },
          { label: 'Tertinggi', value: stats?.nilaiTertinggi ?? 0, icon: Trophy, color: 'bg-amber-500' },
          { label: 'Terendah', value: stats?.nilaiTerendah ?? 0, icon: TrendingUp, color: 'bg-slate-500' },
        ].map(s => (
          <div key={s.label} className="stat-card">
            <div className={`stat-icon ${s.color}`}><s.icon className="w-5 h-5 text-white" /></div>
            <div>
              <div className="text-2xl font-bold text-slate-900">{s.value}</div>
              <div className="text-sm text-slate-500">{s.label}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Table */}
      <div className="card p-0 overflow-hidden">
        {nilaiList.length === 0 ? (
          <EmptyState message="Belum ada nilai ujian" icon={BarChart3} />
        ) : (
          <div className="table-wrapper">
            <table className="table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Mata Pelajaran</th>
                  <th>Nilai PG Anda</th>
                  <th>Kriteria</th>
                  <th>Status nilai PG</th>
                  <th>Benar/Total</th>
                  <th>KKM</th>
                  <th>Hasil akhir</th>
                  <th>Tanggal</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {nilaiList.map((n, i) => {
                  // FIX (bug nilai essay tidak tampil di siswa): sebelumnya
                  // baris ini SELALU pakai n.nilai/n.lulus (nilai PG saja),
                  // walau guru sudah merilis nilai_total gabungan PG+essay.
                  // Sekarang: kalau sudah dirilis (nilai_total terisi),
                  // tampilkan nilai_total sebagai "Nilai" & hitung ulang
                  // grade/status lulus dari situ; kalau belum, tetap
                  // tampilkan nilai PG apa adanya plus penanda "menunggu".
                  const essayDirilis = n.dirilis === true && n.nilai_total != null
                  const nilaiTampil = essayDirilis ? n.nilai_total! : n.nilai
                  const gradeTampil = essayDirilis ? hitungGrade(n.nilai_total!) : n.grade
                  const lulusTampil = essayDirilis ? n.nilai_total! >= n.kkm : n.lulus
                  const essayTertunda = n.essay_belum_dirilis === true

                  return (
                  <tr key={n.id} onClick={() => router.push(`/siswa/nilai/${n.id}`)} className="cursor-pointer hover:bg-slate-50">
                    <td className="text-slate-400 text-xs">{i + 1}</td>
                    <td className="font-medium text-slate-800">{n.nama_mapel}</td>
                    <td>
                      <span className={`text-lg font-bold ${nilaiColor(nilaiTampil)}`}>{nilaiTampil}</span>
                      {essayDirilis && (
                        <div className="text-[11px] text-slate-400">PG {n.nilai} + Essay {n.nilai_essay}</div>
                      )}
                    </td>
                    <td>
                      <span className={`badge font-bold ${
                        gradeTampil === 'A' ? 'badge-green' :
                        gradeTampil === 'B' ? 'badge-blue' :
                        gradeTampil === 'C' ? 'badge-yellow' :
                        'badge-red'
                      }`}>{gradeTampil}</span>
                    </td>
                    <td>
                      <span className={`badge ${n.lulus ? 'badge-green' : 'badge-red'}`}>
                        {n.lulus ? '✓ Lulus' : '✗ Tidak Lulus'}
                      </span>
                    </td>
                    <td className="text-slate-600">{n.benar}/{n.total}</td>
                    <td className="text-slate-500">{n.kkm}</td>
                    <td>
                      {essayTertunda ? (
                        <span className="text-[11px] text-amber-600">Menunggu rilis nilai essay dari guru</span>
                      ) : (
                        <span className={`badge ${lulusTampil ? 'badge-green' : 'badge-red'}`}>
                          {lulusTampil ? '✓ Lulus' : '✗ Tidak Lulus'}
                        </span>
                      )}
                    </td>
                    <td className="text-xs text-slate-400">{formatDateTime(n.timestamp)}</td>
                    <td className="text-right">
                      <span className="inline-flex items-center gap-1 text-xs font-medium text-brand-600">
                        Rincian <ChevronRight className="w-3.5 h-3.5" />
                      </span>
                    </td>
                  </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
