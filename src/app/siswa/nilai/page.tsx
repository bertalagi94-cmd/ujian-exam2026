'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { BarChart3, TrendingUp, Trophy, BookOpen, ChevronRight, RefreshCw, Sparkles, CheckCircle2, SearchX, AlertCircle } from 'lucide-react'
import { PageLoader, EmptyState, Modal } from '@/components/ui'
import { apiRequest, formatDateTime, nilaiColor } from '@/lib/utils'
import { Nilai } from '@/types'

interface NilaiStats { totalUjian: number; rataRata: number; nilaiTertinggi: number; nilaiTerendah: number }

// FITUR (Cek nilai terbaru): siswa bisa memicu pengecekan manual ke server
// tanpa reload halaman. Kita bandingkan "sidik jari" tiap baris nilai dari
// hasil fetch sebelumnya vs yang baru — kalau ada yang beda (nilai PG diubah
// guru, essay baru dirilis, dll), mapel itu dianggap "baru diperbarui" dan
// ditampilkan namanya di popup hasil.
function buatSidikJari(list: Nilai[]): Map<string, string> {
  const map = new Map<string, string>()
  for (const n of list) {
    map.set(n.id, JSON.stringify([
      n.nilai, n.nilai_total, n.nilai_essay, n.dirilis, n.grade,
      n.lulus, n.essay_belum_dirilis, n.kkm, n.benar, n.total,
    ]))
  }
  return map
}

type HasilCek =
  | { status: 'ada'; mapel: string[] }
  | { status: 'kosong' }
  | { status: 'error' }

export default function SiswaNilaiPage() {
  const router = useRouter()
  const [nilaiList, setNilaiList] = useState<Nilai[]>([])
  const [stats, setStats] = useState<NilaiStats | null>(null)
  const [loading, setLoading] = useState(true)

  // ── State untuk "Cek nilai terbaru" ──────────────────────────────────
  const [showCekModal, setShowCekModal] = useState(false)
  const [mengecek, setMengecek] = useState(false)
  const [hasilCek, setHasilCek] = useState<HasilCek | null>(null)
  const sidikJariRef = useRef<Map<string, string>>(new Map())

  const load = useCallback(async () => {
    try {
      const res = await apiRequest<{ data: Nilai[]; stats: NilaiStats }>('/api/siswa/nilai')
      setNilaiList(res.data)
      setStats(res.stats)
      sidikJariRef.current = buatSidikJari(res.data)
    } finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  const cekNilaiTerbaru = useCallback(async () => {
    setShowCekModal(true)
    setMengecek(true)
    setHasilCek(null)
    const mulai = Date.now()

    try {
      const res = await apiRequest<{ data: Nilai[]; stats: NilaiStats }>('/api/siswa/nilai')

      const sidikLama = sidikJariRef.current
      const sidikBaru = buatSidikJari(res.data)
      const mapelBerubah = new Set<string>()
      for (const n of res.data) {
        if (sidikLama.get(n.id) !== sidikBaru.get(n.id)) {
          mapelBerubah.add(n.nama_mapel || n.mapel_id)
        }
      }

      // Kasih jeda minimum supaya animasi "mengambil nilai" kelihatan,
      // bukan cuma kedip sekilas kalau respons server sangat cepat.
      const jedaMinimum = 1500
      const berlalu = Date.now() - mulai
      if (berlalu < jedaMinimum) await new Promise(r => setTimeout(r, jedaMinimum - berlalu))

      setNilaiList(res.data)
      setStats(res.stats)
      sidikJariRef.current = sidikBaru

      setHasilCek(mapelBerubah.size > 0
        ? { status: 'ada', mapel: Array.from(mapelBerubah) }
        : { status: 'kosong' })
    } catch {
      const jedaMinimum = 1000
      const berlalu = Date.now() - mulai
      if (berlalu < jedaMinimum) await new Promise(r => setTimeout(r, jedaMinimum - berlalu))
      setHasilCek({ status: 'error' })
    } finally {
      setMengecek(false)
    }
  }, [])

  if (loading) return <PageLoader />

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="page-title">Nilai Saya</h1>
          <p className="page-subtitle">Riwayat semua hasil ujian</p>
        </div>
        <button
          onClick={cekNilaiTerbaru}
          disabled={mengecek}
          className="btn-primary shrink-0 disabled:opacity-70 disabled:cursor-not-allowed"
        >
          <RefreshCw className={`w-4 h-4 ${mengecek ? 'animate-spin' : ''}`} />
          Cek nilai terbaru
        </button>
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
                  // FIX (kolom "Nilai PG Anda" & "Status nilai PG" ikut
                  // berubah saat essay dirilis): sebelumnya kolom ini
                  // memakai n.nilai_total begitu essay dirilis — padahal
                  // kolomnya khusus untuk skor PG saja, bukan gabungan.
                  // PENTING: n.lulus JUGA tidak bisa dipakai untuk status PG
                  // murni, karena begitu guru menilai essay, backend
                  // (koreksi-essay/route.ts) MENIMPA kolom `lulus` di
                  // database dengan status kelulusan GABUNGAN (PG+Essay vs
                  // KKM) — bukan status PG saja lagi. Makanya status PG
                  // murni harus dihitung ulang di sini dari n.nilai vs
                  // n.kkm, tidak boleh mengandalkan n.lulus.
                  const essayDirilis = n.dirilis === true && n.nilai_total != null
                  const pgLulus = n.nilai >= n.kkm
                  const hasilAkhirLulus = essayDirilis ? n.nilai_total! >= n.kkm : n.lulus
                  const essayTertunda = n.essay_belum_dirilis === true

                  return (
                  <tr key={n.id} onClick={() => router.push(`/siswa/nilai/${n.id}`)} className="cursor-pointer hover:bg-slate-50">
                    <td className="text-slate-400 text-xs">{i + 1}</td>
                    <td className="font-medium text-slate-800">{n.nama_mapel}</td>
                    <td>
                      <span className={`text-lg font-bold ${nilaiColor(n.nilai)}`}>{n.nilai}</span>
                    </td>
                    <td>
                      <span className={`badge font-bold ${
                        n.grade === 'A' ? 'badge-green' :
                        n.grade === 'B' ? 'badge-blue' :
                        n.grade === 'C' ? 'badge-yellow' :
                        'badge-red'
                      }`}>{n.grade}</span>
                    </td>
                    <td>
                      <span className={`badge ${pgLulus ? 'badge-green' : 'badge-red'}`}>
                        {pgLulus ? '✓ Lulus' : '✗ Tidak Lulus'}
                      </span>
                    </td>
                    <td className="text-slate-600">{n.benar}/{n.total}</td>
                    <td className="text-slate-500">{n.kkm}</td>
                    <td>
                      {essayTertunda ? (
                        <span className="text-[11px] text-amber-600">Menunggu rilis nilai essay dari guru</span>
                      ) : (
                        <>
                          <span className={`badge ${hasilAkhirLulus ? 'badge-green' : 'badge-red'}`}>
                            {hasilAkhirLulus ? '✓ Lulus' : '✗ Tidak Lulus'}
                          </span>
                          {essayDirilis && (
                            <div className="text-[11px] text-slate-400 mt-0.5">
                              PG {n.nilai} + Essay {n.nilai_essay} = {n.nilai_total}
                            </div>
                          )}
                        </>
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

      {/* Popup "Cek nilai terbaru" */}
      <Modal
        open={showCekModal}
        onClose={() => { if (!mengecek) setShowCekModal(false) }}
        title="Cek Nilai Terbaru"
        size="sm"
        footer={!mengecek && (
          <>
            <button className="btn-secondary" onClick={() => setShowCekModal(false)}>Tutup</button>
            <button
              className="btn-primary"
              onClick={() => { setShowCekModal(false) }}
            >
              Lihat Halaman Nilai
            </button>
          </>
        )}
      >
        {mengecek ? (
          <div className="flex flex-col items-center justify-center gap-5 py-6">
            <div className="relative w-20 h-20">
              <div className="absolute inset-0 rounded-full bg-brand-400/25 animate-ping" />
              <div className="absolute inset-1.5 rounded-full bg-brand-400/20 animate-pulse-soft" />
              <div className="relative w-20 h-20 rounded-full bg-gradient-to-br from-brand-500 to-brand-700 flex items-center justify-center shadow-glow-blue">
                <RefreshCw className="w-8 h-8 text-white animate-spin" style={{ animationDuration: '1.1s' }} />
              </div>
            </div>
            <div className="text-center">
              <p className="font-semibold text-slate-800">Mengambil nilai terbaru dari guru...</p>
              <p className="text-xs text-slate-400 mt-1">Mohon tunggu sebentar</p>
            </div>
            <div className="flex gap-1.5">
              {[0, 1, 2].map(i => (
                <span
                  key={i}
                  className="w-2 h-2 rounded-full bg-brand-500 animate-bounce"
                  style={{ animationDelay: `${i * 0.15}s` }}
                />
              ))}
            </div>
          </div>
        ) : hasilCek?.status === 'ada' ? (
          <div className="space-y-3 animate-fade-in">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-full bg-emerald-100 flex items-center justify-center flex-shrink-0">
                <Sparkles className="w-5 h-5 text-emerald-600" />
              </div>
              <div>
                <p className="font-semibold text-slate-900">Ada nilai terbaru!</p>
                <p className="text-xs text-slate-500">Mapel berikut baru saja diperbarui oleh guru</p>
              </div>
            </div>
            <ul className="space-y-1.5">
              {hasilCek.mapel.map(m => (
                <li key={m} className="flex items-center gap-2 text-sm text-slate-700 bg-emerald-50 ring-1 ring-emerald-200/70 rounded-lg px-3 py-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 flex-shrink-0" />
                  <span className="font-medium">{m}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : hasilCek?.status === 'error' ? (
          <div className="flex flex-col items-center text-center py-4 gap-2 animate-fade-in">
            <div className="w-14 h-14 rounded-full bg-red-50 flex items-center justify-center">
              <AlertCircle className="w-6 h-6 text-red-500" />
            </div>
            <p className="font-medium text-slate-700">Gagal mengambil nilai</p>
            <p className="text-sm text-slate-500">Periksa koneksi internet kamu lalu coba lagi.</p>
          </div>
        ) : (
          <div className="flex flex-col items-center text-center py-4 gap-2 animate-fade-in">
            <div className="w-14 h-14 rounded-full bg-slate-100 flex items-center justify-center">
              <SearchX className="w-6 h-6 text-slate-400" />
            </div>
            <p className="font-medium text-slate-700">Belum ada nilai terbaru</p>
            <p className="text-sm text-slate-500">Nilai kamu masih sama seperti sebelumnya.</p>
          </div>
        )}
      </Modal>
    </div>
  )
}
