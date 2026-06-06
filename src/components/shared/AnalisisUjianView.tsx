'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  BarChart3, Users, CheckCircle, AlertTriangle, ChevronDown, ChevronUp,
  Search, BookOpen, X
} from 'lucide-react'
import { PageLoader, EmptyState, StatCard, Modal } from '@/components/ui'
import { apiRequest, formatDateTime } from '@/lib/utils'

interface SiswaItem { nis: string; nama: string }

interface AnalisisSoal {
  nomor: number
  id: string
  teks: string
  kunci: string
  tingkat: string
  opsi: Record<string, string | null>
  opsiList: string[]
  totalDijawab: number
  totalSiswa: number
  benar: number
  salah: number
  persenBenar: number
  persenSalah: number
  distribusiJumlah: Record<string, number>
  distribusiSiswa: Record<string, SiswaItem[]>
  tidakMenjawab: SiswaItem[]
}

interface SesiItem {
  id: string
  mapel_id: string
  nama_mapel: string
  kelas: string
  waktu_mulai: string
  waktu_selesai: string
  jumlah_peserta: number
}

interface MapelItem { id: string; nama: string }

interface Ringkasan {
  totalSoal: number
  totalSiswa: number
  rataPersenBenar: number
  soalMudah: number
  soalSedang: number
  soalSulit: number
}

interface ModalSiswaState {
  open: boolean
  soalTeks: string
  opsi: string
  opsiTeks: string
  siswaList: SiswaItem[]
  isKunci: boolean
}

// ── Distribusi Bar per opsi ────────────────────────────
function DistribusiOpsi({
  opsi, teksOpsi, jumlah, total, isKunci, siswa, onLihat
}: {
  opsi: string
  teksOpsi: string | null
  jumlah: number
  total: number
  isKunci: boolean
  siswa: SiswaItem[]
  onLihat: () => void
}) {
  const pct = total > 0 ? Math.round((jumlah / total) * 100) : 0

  return (
    <div className={`flex items-center gap-3 py-2 px-3 rounded-lg transition-colors ${
      isKunci ? 'bg-emerald-50 border border-emerald-200' : 'bg-slate-50 border border-slate-100'
    }`}>
      <div className={`w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold flex-shrink-0 ${
        isKunci ? 'bg-emerald-500 text-white' : 'bg-slate-200 text-slate-600'
      }`}>
        {opsi}
      </div>

      <div className="flex-1 min-w-0">
        {teksOpsi && (
          <p className="text-xs text-slate-600 truncate mb-1">{teksOpsi}</p>
        )}
        <div className="flex items-center gap-2">
          <div className="flex-1 h-2 bg-slate-200 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${isKunci ? 'bg-emerald-500' : 'bg-slate-400'}`}
              style={{ width: `${pct}%` }}
            />
          </div>
          <span className={`text-xs font-semibold w-8 text-right ${isKunci ? 'text-emerald-700' : 'text-slate-600'}`}>
            {pct}%
          </span>
        </div>
      </div>

      <div className="flex items-center gap-2 flex-shrink-0">
        <span className={`text-sm font-bold ${isKunci ? 'text-emerald-700' : 'text-slate-700'}`}>
          {jumlah}
        </span>
        {jumlah > 0 && (
          <button
            onClick={onLihat}
            className="text-xs px-2 py-0.5 rounded-md bg-white border border-slate-200 text-slate-600 hover:bg-brand-50 hover:border-brand-300 hover:text-brand-700 transition-colors"
          >
            Lihat
          </button>
        )}
      </div>
    </div>
  )
}

// ── Kartu per soal ─────────────────────────────────────
function SoalCard({
  soal, rank, onLihatSiswa
}: {
  soal: AnalisisSoal
  rank: number
  onLihatSiswa: (opsi: string) => void
}) {
  const [expanded, setExpanded] = useState(false)

  const rankColor =
    rank === 1 ? 'bg-red-500' :
    rank === 2 ? 'bg-orange-500' :
    rank === 3 ? 'bg-amber-500' :
    'bg-slate-400'

  return (
    <div className="card overflow-hidden">
      <div
        className="flex items-start gap-3 cursor-pointer select-none"
        onClick={() => setExpanded(e => !e)}
      >
        <div className={`w-8 h-8 rounded-lg ${rankColor} text-white text-xs font-bold flex items-center justify-center flex-shrink-0 mt-0.5`}>
          {rank}
        </div>

        <div className="flex-1 min-w-0">
          <p className="text-sm text-slate-800 leading-relaxed line-clamp-2">{soal.teks}</p>

          <div className="flex flex-wrap gap-3 mt-2">
            <div className="flex items-center gap-1.5">
              <div className="h-2 w-16 bg-slate-200 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full ${
                    soal.persenSalah >= 60 ? 'bg-red-500' :
                    soal.persenSalah >= 30 ? 'bg-amber-400' : 'bg-emerald-500'
                  }`}
                  style={{ width: `${soal.persenSalah}%` }}
                />
              </div>
              <span className={`text-xs font-semibold ${
                soal.persenSalah >= 60 ? 'text-red-600' :
                soal.persenSalah >= 30 ? 'text-amber-600' : 'text-emerald-600'
              }`}>
                {soal.persenSalah}% salah
              </span>
            </div>

            <span className="text-xs text-slate-400">|</span>
            <span className="text-xs text-emerald-600 font-medium">{soal.persenBenar}% benar</span>
            <span className="text-xs text-slate-400">|</span>
            <span className="text-xs text-slate-500">
              Kunci: <span className="font-bold text-emerald-700">{soal.kunci}</span>
            </span>
            <span className="text-xs text-slate-400">|</span>
            <span className="text-xs text-slate-500">{soal.totalDijawab}/{soal.totalSiswa} siswa menjawab</span>
          </div>
        </div>

        <button className="p-1 text-slate-400 flex-shrink-0 mt-0.5">
          {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </button>
      </div>

      {expanded && (
        <div className="mt-4 pt-4 border-t border-slate-100 space-y-2">
          <p className="text-xs text-slate-400 mb-3">
            Distribusi jawaban siswa — klik <span className="font-medium text-brand-600">Lihat</span> untuk melihat nama siswa
          </p>

          {soal.opsiList.map(o => (
            <DistribusiOpsi
              key={o}
              opsi={o}
              teksOpsi={soal.opsi[o] ?? null}
              jumlah={soal.distribusiJumlah[o] ?? 0}
              total={soal.totalDijawab}
              isKunci={o === soal.kunci}
              siswa={soal.distribusiSiswa[o] ?? []}
              onLihat={() => onLihatSiswa(o)}
            />
          ))}

          {soal.tidakMenjawab.length > 0 && (
            <div className="flex items-center gap-3 py-2 px-3 rounded-lg bg-slate-50 border border-slate-100 mt-1">
              <div className="w-7 h-7 rounded-lg flex items-center justify-center bg-slate-300 text-slate-600 flex-shrink-0">
                <X className="w-3 h-3" />
              </div>
              <div className="flex-1 text-xs text-slate-500">Tidak menjawab</div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold text-slate-600">{soal.tidakMenjawab.length}</span>
                <button
                  onClick={() => onLihatSiswa('__tidak_menjawab__')}
                  className="text-xs px-2 py-0.5 rounded-md bg-white border border-slate-200 text-slate-600 hover:bg-slate-100 transition-colors"
                >
                  Lihat
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Komponen utama ─────────────────────────────────────
interface AnalisisUjianProps {
  apiPath: string
  showMapelFilter?: boolean
}

export default function AnalisisUjianView({ apiPath, showMapelFilter = false }: AnalisisUjianProps) {
  const [mapelList, setMapelList] = useState<MapelItem[]>([])
  const [data, setData] = useState<AnalisisSoal[]>([])
  const [sesiTerpilih, setSesiTerpilih] = useState<SesiItem | null>(null)
  const [ringkasan, setRingkasan] = useState<Ringkasan | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingData, setLoadingData] = useState(false)
  const [filterMapelId, setFilterMapelId] = useState('')
  const [search, setSearch] = useState('')
  const [modalSiswa, setModalSiswa] = useState<ModalSiswaState>({
    open: false, soalTeks: '', opsi: '', opsiTeks: '', siswaList: [], isKunci: false
  })

  // Load awal: ambil daftar mapel
  const loadMapelList = useCallback(async () => {
    setLoading(true)
    try {
      const res = await apiRequest<{ mapelList: MapelItem[] }>(`${apiPath}?only_mapel=1`)
      setMapelList(res.mapelList ?? [])
    } finally {
      setLoading(false)
    }
  }, [apiPath])

  // Load analisis otomatis dari sesi terbaru berdasarkan mapel
  const loadAnalisis = useCallback(async (mapelId: string) => {
    if (!mapelId) { setData([]); setSesiTerpilih(null); setRingkasan(null); return }
    setLoadingData(true)
    try {
      const params = new URLSearchParams({ mapel_id: mapelId, latest: '1' })
      const res = await apiRequest<{
        data: AnalisisSoal[]
        sesi: SesiItem
        ringkasan: Ringkasan
        mapelList: MapelItem[]
      }>(`${apiPath}?${params}`)
      setData(res.data ?? [])
      setSesiTerpilih(res.sesi ?? null)
      setRingkasan(res.ringkasan ?? null)
      if (res.mapelList?.length) setMapelList(res.mapelList)
    } finally {
      setLoadingData(false)
    }
  }, [apiPath])

  useEffect(() => { loadMapelList() }, [loadMapelList])
  useEffect(() => { loadAnalisis(filterMapelId) }, [filterMapelId])

  function bukaModalSiswa(soal: AnalisisSoal, opsi: string) {
    const isTidakMenjawab = opsi === '__tidak_menjawab__'
    setModalSiswa({
      open: true,
      soalTeks: soal.teks,
      opsi: isTidakMenjawab ? '-' : opsi,
      opsiTeks: isTidakMenjawab ? 'Tidak menjawab' : (soal.opsi[opsi] ?? ''),
      siswaList: isTidakMenjawab ? soal.tidakMenjawab : (soal.distribusiSiswa[opsi] ?? []),
      isKunci: !isTidakMenjawab && opsi === soal.kunci,
    })
  }

  const filtered = data.filter(s =>
    !search || s.teks.toLowerCase().includes(search.toLowerCase())
  )

  if (loading) return <PageLoader />

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="page-title">Analisis Hasil Ujian</h1>
        <p className="page-subtitle">Soal diurutkan dari yang paling banyak salah dijawab</p>
      </div>

      {/* Filter */}
      <div className="card py-4 flex flex-wrap gap-3 items-center">
        {showMapelFilter && (
          <select
            value={filterMapelId}
            onChange={e => { setFilterMapelId(e.target.value); setData([]) }}
            className="select w-52"
          >
            <option value="">— Pilih Mata Pelajaran —</option>
            {mapelList.map(m => <option key={m.id} value={m.id}>{m.nama}</option>)}
          </select>
        )}

        {data.length > 0 && (
          <div className="relative flex-1 min-w-[180px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Cari teks soal..."
              className="input pl-8 w-full"
            />
          </div>
        )}
      </div>

      {/* Loading analisis */}
      {loadingData && (
        <div className="card flex items-center justify-center py-12 text-slate-400 gap-2">
          <div className="w-5 h-5 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
          <span className="text-sm">Memuat analisis...</span>
        </div>
      )}

      {/* Belum pilih mapel */}
      {!loadingData && showMapelFilter && !filterMapelId && (
        <div className="card">
          <EmptyState message="Pilih mata pelajaran di atas untuk melihat analisis hasil jawaban siswa." icon={BarChart3} />
        </div>
      )}

      {/* Data kosong */}
      {!loadingData && (!showMapelFilter || filterMapelId) && data.length === 0 && !loadingData && (
        <div className="card">
          <EmptyState message="Belum ada data jawaban untuk mata pelajaran ini." icon={BookOpen} />
        </div>
      )}

      {/* Ringkasan */}
      {!loadingData && ringkasan && data.length > 0 && (
        <>
          {sesiTerpilih && (
            <div className="card py-3 px-4 bg-brand-50 border border-brand-100 text-sm text-brand-800 flex flex-wrap gap-x-4 gap-y-1">
              <span className="font-semibold">{sesiTerpilih.nama_mapel}</span>
              <span>Kelas: {sesiTerpilih.kelas}</span>
              <span>{formatDateTime(sesiTerpilih.waktu_mulai)}</span>
              <span>{ringkasan.totalSiswa} peserta</span>
            </div>
          )}

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard label="Total Soal" value={ringkasan.totalSoal} icon={BookOpen} color="bg-brand-500" />
            <StatCard label="Rata-rata Benar" value={`${ringkasan.rataPersenBenar}%`} icon={BarChart3} color="bg-emerald-500" />
            <StatCard label="Soal Mudah" value={ringkasan.soalMudah} icon={CheckCircle} color="bg-emerald-400" />
            <StatCard label="Soal Sulit" value={ringkasan.soalSulit} icon={AlertTriangle} color="bg-red-500" />
          </div>

          <div className="flex items-center gap-2 text-xs text-slate-400">
            <span className="w-2 h-2 rounded-full bg-red-500 inline-block" /> Soal paling banyak salah di atas
            <span className="ml-3 w-2 h-2 rounded-full bg-emerald-500 inline-block" /> Kunci jawaban
          </div>

          <div className="space-y-3">
            {filtered.map((soal, i) => (
              <SoalCard
                key={soal.id}
                soal={soal}
                rank={i + 1}
                onLihatSiswa={(opsi) => bukaModalSiswa(soal, opsi)}
              />
            ))}
          </div>

          {filtered.length === 0 && search && (
            <div className="card">
              <EmptyState message={`Tidak ada soal yang cocok dengan "${search}"`} icon={Search} />
            </div>
          )}
        </>
      )}

      {/* Modal daftar siswa */}
      <Modal
        open={modalSiswa.open}
        onClose={() => setModalSiswa(m => ({ ...m, open: false }))}
        title={`Siswa yang menjawab opsi ${modalSiswa.opsi}`}
        size="md"
      >
        <div className="space-y-3">
          <div className={`px-3 py-2 rounded-lg text-sm ${modalSiswa.isKunci ? 'bg-emerald-50 text-emerald-800' : 'bg-slate-50 text-slate-700'}`}>
            <span className="font-semibold">Opsi {modalSiswa.opsi}:</span>{' '}
            {modalSiswa.opsiTeks || <span className="text-slate-400 italic">—</span>}
          </div>

          <p className="text-xs text-slate-400 line-clamp-2">Soal: {modalSiswa.soalTeks}</p>

          {modalSiswa.siswaList.length === 0 ? (
            <p className="text-sm text-slate-400 text-center py-4">Tidak ada siswa</p>
          ) : (
            <div className="divide-y divide-slate-100 max-h-80 overflow-y-auto">
              {modalSiswa.siswaList.map((s, i) => (
                <div key={s.nis} className="flex items-center gap-3 py-2.5">
                  <span className="w-6 text-xs text-slate-400 text-right flex-shrink-0">{i + 1}</span>
                  <div>
                    <div className="text-sm font-medium text-slate-800">{s.nama}</div>
                    <div className="text-xs text-slate-400">NIS: {s.nis}</div>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="text-xs text-slate-400 text-right">{modalSiswa.siswaList.length} siswa</div>
        </div>
      </Modal>
    </div>
  )
}
