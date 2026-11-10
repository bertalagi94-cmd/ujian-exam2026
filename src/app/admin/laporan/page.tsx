'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import {
  FileBarChart, RefreshCw, Download, Search, ChevronDown, ChevronRight,
  ClipboardList, PlayCircle, CheckCircle2, School as SchoolIcon, Filter as FilterIcon,
} from 'lucide-react'
import { Toast, Spinner, EmptyState } from '@/components/ui'
import { apiRequest, formatDate } from '@/lib/utils'
import type { JenjangGroup, LaporanResponse, Tahap } from '@/lib/laporan-pdf'
import {
  DAFTAR_TAHAP, INFO_TAHAP, STATUS_SOAL_LABEL, STATUS_KISI_LABEL,
  bangunPdfLaporan, hitungRingkas, namaBerkasPdf,
} from '@/lib/laporan-pdf'

// ── Warna status untuk preview di halaman (label & tipe ada di '@/lib/laporan-pdf') ──
type PillColor = 'green' | 'yellow' | 'red' | 'slate' | 'blue'
const STATUS_SOAL_COLOR: Record<string, PillColor> = {
  BELUM_DIBUAT: 'slate', DRAFT: 'slate', MENUNGGU: 'yellow', DISETUJUI: 'green', DITOLAK: 'red',
}
const STATUS_KISI_COLOR: Record<string, PillColor> = {
  BELUM_DIBUAT: 'slate', DRAFT: 'yellow', TERKIRIM: 'green',
}
const PILL_CLASS: Record<PillColor, string> = {
  green: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-600/20',
  yellow: 'bg-amber-50 text-amber-700 ring-1 ring-amber-600/20',
  red: 'bg-red-50 text-red-700 ring-1 ring-red-600/20',
  slate: 'bg-slate-100 text-slate-600 ring-1 ring-slate-400/20',
  blue: 'bg-blue-50 text-blue-700 ring-1 ring-blue-600/20',
}
function Pill({ label, color }: { label: string; color: PillColor }) {
  return <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${PILL_CLASS[color]}`}>{label}</span>
}

const kunciJenjang = (g: JenjangGroup) => g.sekolahId ?? '__tanpa_jenjang__'

export default function AdminLaporanPage() {
  const [data, setData] = useState<JenjangGroup[]>([])
  const [generatedAt, setGeneratedAt] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [downloading, setDownloading] = useState<string | null>(null) // sekolahId yang sedang di-download, atau 'ALL'
  const [search, setSearch] = useState('')
  // Filter per kelas / per mapel ('' = semua). Dicocokkan lewat NAMA supaya kelas
  // atau mapel bernama sama di beberapa jenjang ikut tampil bersamaan.
  const [filterKelas, setFilterKelas] = useState('')
  const [filterMapel, setFilterMapel] = useState('')
  const [panelFilterBuka, setPanelFilterBuka] = useState(false)
  // Download PDF: tiap tahap (Pra/Saat/Setelah Ujian) = 1 file terpisah.
  const [panelUnduhBuka, setPanelUnduhBuka] = useState(false)
  const [hanyaBelum, setHanyaBelum] = useState(false)
  const [jenjangUnduh, setJenjangUnduh] = useState('ALL')
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null)

  const showToast = (msg: string, type: 'success' | 'error' = 'success') => {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 3500)
  }

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await apiRequest<LaporanResponse>('/api/admin/laporan-lengkap')
      setData(res.data)
      setGeneratedAt(res.generatedAt)
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Gagal memuat laporan', 'error')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  // Pilihan dropdown filter dibuat SALING MENYESUAIKAN: daftar mapel hanya berisi
  // mapel yang ada di kelas terpilih, dan daftar kelas hanya berisi kelas yang
  // punya mapel terpilih — jadi tidak ada kombinasi yang berujung tabel kosong.
  const urutNama = (a: string, b: string) => a.localeCompare(b, 'id', { numeric: true })
  const opsiKelas = useMemo(() => {
    const set = new Set<string>()
    for (const g of data) for (const r of g.rows) {
      if (!filterMapel || r.namaMapel === filterMapel) set.add(r.namaKelas)
    }
    return [...set].sort(urutNama)
  }, [data, filterMapel])
  const opsiMapel = useMemo(() => {
    const set = new Set<string>()
    for (const g of data) for (const r of g.rows) {
      if (!filterKelas || r.namaKelas === filterKelas) set.add(r.namaMapel)
    }
    return [...set].sort(urutNama)
  }, [data, filterKelas])

  // Pilihan yang sudah tidak ada lagi (mis. setelah Refresh atau setelah filter
  // lain diganti) otomatis dikembalikan ke "Semua".
  useEffect(() => { if (filterKelas && !opsiKelas.includes(filterKelas)) setFilterKelas('') }, [opsiKelas, filterKelas])
  useEffect(() => { if (filterMapel && !opsiMapel.includes(filterMapel)) setFilterMapel('') }, [opsiMapel, filterMapel])

  const jumlahFilterAktif = (filterKelas ? 1 : 0) + (filterMapel ? 1 : 0)
  const resetFilter = () => { setFilterKelas(''); setFilterMapel('') }

  // Filter kelas + mapel + pencarian (client-side) — dipakai untuk preview DAN
  // untuk PDF yang di-generate (PDF hanya memuat baris yang sedang tampil).
  const filteredData = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q && !filterKelas && !filterMapel) return data
    return data
      .map(g => ({
        ...g,
        rows: g.rows.filter(r =>
          (!filterKelas || r.namaKelas === filterKelas) &&
          (!filterMapel || r.namaMapel === filterMapel) &&
          (!q ||
            r.namaMapel.toLowerCase().includes(q) ||
            r.namaKelas.toLowerCase().includes(q) ||
            r.namaGuru.toLowerCase().includes(q))
        ),
      }))
      .filter(g => g.rows.length > 0)
  }, [data, search, filterKelas, filterMapel])

  const toggleCollapse = (key: string) => setCollapsed(prev => ({ ...prev, [key]: !prev[key] }))

  // ── Download PDF per tahap ──────────────────────────────────────────────────
  // Cakupan file = baris yang sedang tampil (ikut pencarian + Filter kelas/mapel),
  // dipersempit lagi oleh pilihan jenjang. Detail tabel ada di '@/lib/laporan-pdf'.
  const opsiJenjang = useMemo(
    () => filteredData.map(g => ({ key: kunciJenjang(g), label: g.label })),
    [filteredData]
  )
  useEffect(() => {
    if (jenjangUnduh !== 'ALL' && !opsiJenjang.some(o => o.key === jenjangUnduh)) setJenjangUnduh('ALL')
  }, [opsiJenjang, jenjangUnduh])

  const targetUnduh = useMemo(
    () => (jenjangUnduh === 'ALL' ? filteredData : filteredData.filter(g => kunciJenjang(g) === jenjangUnduh)),
    [filteredData, jenjangUnduh]
  )
  const ringkasTahap = useMemo(() => hitungRingkas(targetUnduh.flatMap(g => g.rows)), [targetUnduh])
  const cakupanTeks = [
    `Kelas: ${filterKelas || 'Semua'}`,
    `Mapel: ${filterMapel || 'Semua'}`,
    search.trim() ? `Pencarian: "${search.trim()}"` : '',
  ].filter(Boolean).join('  |  ')

  async function unduhPdf(tahap: Tahap) {
    setDownloading(tahap)
    try {
      const { jsPDF } = await import('jspdf')
      const logoCache = new Map<string, string>()
      const ambilLogo = async (url: string): Promise<string | null> => {
        if (!url) return null
        if (logoCache.has(url)) return logoCache.get(url)!
        try {
          const resp = await fetch(url)
          const blob = await resp.blob()
          const b64 = await new Promise<string>(res => {
            const r = new FileReader()
            r.onload = () => res((r.result as string).split(',')[1])
            r.readAsDataURL(blob)
          })
          logoCache.set(url, b64)
          return b64
        } catch {
          return null
        }
      }

      const doc = await bangunPdfLaporan(jsPDF, {
        tahap,
        hanyaBelum,
        target: targetUnduh,
        cakupan: cakupanTeks,
        dicetak: generatedAt ? formatDate(generatedAt) : '-',
        ambilLogo,
      })
      if (!doc) {
        showToast(hanyaBelum ? 'Tidak ada data yang belum lengkap pada cakupan ini' : 'Tidak ada data untuk diunduh', 'error')
        return
      }
      doc.save(namaBerkasPdf({
        tahap,
        hanyaBelum,
        jenjangLabel: jenjangUnduh === 'ALL' ? null : (targetUnduh[0]?.label ?? null),
        kelas: filterKelas,
        mapel: filterMapel,
        tanggal: new Date().toISOString().slice(0, 10),
      }))
      showToast(`PDF ${INFO_TAHAP[tahap].tombol} berhasil diunduh`)
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Gagal membuat PDF', 'error')
    } finally {
      setDownloading(null)
    }
  }

  const totalKombinasi = filteredData.reduce((sum, g) => sum + g.rows.length, 0)

  return (
    <div className="space-y-6 animate-fade-in">
      {toast && <Toast message={toast.msg} type={toast.type} onClose={() => setToast(null)} />}

      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div>
          <h1 className="page-title flex items-center gap-2">
            <FileBarChart className="w-6 h-6 text-brand-600" />
            Laporan Lengkap
          </h1>
          <p className="page-subtitle">
            Rekap Pra Ujian, Saat Ujian & Setelah Ujian per mata pelajaran + kelas, dikelompokkan per jenjang/sekolah
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button className="btn-secondary flex items-center gap-2" onClick={load} disabled={loading}>
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
          </button>
          <button
            className="btn-primary flex items-center gap-2"
            onClick={() => setPanelUnduhBuka(v => !v)}
            aria-expanded={panelUnduhBuka}
            disabled={loading || filteredData.length === 0}
          >
            <Download className="w-4 h-4" /> Download PDF
          </button>
        </div>
      </div>

      {generatedAt && (
        <p className="text-xs text-muted">
          Data dihitung: {new Date(generatedAt).toLocaleString('id-ID')} · Total kombinasi mapel + kelas: {totalKombinasi}
        </p>
      )}

      {/* Panel Download PDF — 1 file per tahap */}
      {panelUnduhBuka && (
        <div className="card p-4 space-y-4 max-w-3xl">
          <div>
            <p className="font-semibold text-slate-800">Download PDF per tahap</p>
            <p className="text-xs text-muted">
              Setiap tahap diunduh sebagai file terpisah. Cakupan mengikuti pencarian dan Filter di bawah: {cakupanTeks}.
            </p>
          </div>
          <div className="flex flex-wrap items-end gap-4">
            {opsiJenjang.length > 1 && (
              <div className="min-w-[200px]">
                <label className="label">Jenjang</label>
                <select className="select" value={jenjangUnduh} onChange={e => setJenjangUnduh(e.target.value)}>
                  <option value="ALL">Semua jenjang</option>
                  {opsiJenjang.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
                </select>
              </div>
            )}
            <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer select-none pb-2">
              <input
                type="checkbox"
                className="w-4 h-4 rounded border-slate-300"
                checked={hanyaBelum}
                onChange={e => setHanyaBelum(e.target.checked)}
              />
              Hanya yang belum lengkap / belum tuntas
            </label>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {DAFTAR_TAHAP.map((t, i) => {
              const r = ringkasTahap[t]
              const kosong = hanyaBelum ? r.belum === 0 : r.total === 0
              return (
                <button
                  key={t}
                  type="button"
                  className="btn-secondary w-full flex-col items-start gap-0.5 text-left"
                  onClick={() => unduhPdf(t)}
                  disabled={downloading !== null || kosong}
                >
                  <span className="flex items-center gap-2 font-semibold">
                    {downloading === t ? <Spinner size="sm" /> : <Download className="w-4 h-4" />}
                    {i + 1}. {INFO_TAHAP[t].tombol}
                  </span>
                  <span className="text-xs font-normal text-muted">
                    {INFO_TAHAP[t].sub} · {hanyaBelum && r.belum === 0 ? 'semua sudah beres' : `${r.belum} dari ${r.total} belum`}
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* Search + tombol Filter */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[220px] max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              className="input pl-9"
              placeholder="Cari mapel, kelas, atau nama guru..."
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
          <button
            type="button"
            className={`btn-secondary flex items-center gap-2 ${jumlahFilterAktif > 0 ? 'ring-2 ring-brand-500/40' : ''}`}
            onClick={() => setPanelFilterBuka(v => !v)}
            aria-expanded={panelFilterBuka}
            disabled={loading || data.length === 0}
          >
            <FilterIcon className="w-4 h-4" />
            Filter
            {jumlahFilterAktif > 0 && (
              <span className="inline-flex items-center justify-center min-w-[1.25rem] h-5 px-1 rounded-full bg-brand-600 text-white text-xs font-semibold">
                {jumlahFilterAktif}
              </span>
            )}
          </button>
          {jumlahFilterAktif > 0 && (
            <button type="button" className="text-sm text-brand-600 hover:underline" onClick={resetFilter}>
              Reset filter
            </button>
          )}
        </div>

        {panelFilterBuka && (
          <div className="card p-4 grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-2xl">
            <div>
              <label className="label">Filter per Kelas</label>
              <select className="select" value={filterKelas} onChange={e => setFilterKelas(e.target.value)}>
                <option value="">Semua kelas</option>
                {opsiKelas.map(k => <option key={k} value={k}>{k}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Filter per Mapel</label>
              <select className="select" value={filterMapel} onChange={e => setFilterMapel(e.target.value)}>
                <option value="">Semua mapel</option>
                {opsiMapel.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
            <p className="sm:col-span-2 text-xs text-muted">
              Pilihan kelas dan mapel saling menyesuaikan. Hasil filter juga dipakai saat Download PDF.
            </p>
          </div>
        )}
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><Spinner size="lg" /></div>
      ) : filteredData.length === 0 ? (
        <EmptyState
          icon={FileBarChart}
          title="Tidak ada data"
          description={
            jumlahFilterAktif > 0 || search.trim()
              ? 'Tidak ada kombinasi mapel + kelas yang cocok dengan pencarian atau filter. Coba ubah atau reset filter.'
              : 'Belum ada kombinasi mapel + kelas yang bisa dilaporkan.'
          }
        />
      ) : (
        <div className="space-y-5">
          {filteredData.map(g => {
            const key = g.sekolahId ?? '__tanpa_jenjang__'
            const isCollapsed = collapsed[key] ?? false
            const belumSoal = g.rows.filter(r => r.pra.statusSoal !== 'DISETUJUI').length
            const sesiBerjalan = g.rows.filter(r => r.saat.adaSesiBerjalan).length
            const belumKirim = g.rows.filter(r => r.setelah.totalNilai > 0 && r.setelah.sudahDikirimWali < r.setelah.totalNilai).length

            return (
              <div key={key} className="card overflow-hidden">
                {/* Header jenjang */}
                <button
                  className="w-full flex items-center justify-between p-4 bg-slate-50 hover:bg-slate-100 transition-colors text-left"
                  onClick={() => toggleCollapse(key)}
                >
                  <div className="flex items-center gap-3">
                    {isCollapsed ? <ChevronRight className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
                    <SchoolIcon className="w-5 h-5 text-brand-600" />
                    <div>
                      <p className="font-semibold text-slate-800">
                        {g.label} — {g.namaSekolah}
                      </p>
                      <p className="text-xs text-muted">{g.rows.length} kombinasi mapel + kelas</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="hidden sm:flex items-center gap-3 text-xs text-muted">
                      <span className="flex items-center gap-1"><ClipboardList className="w-3.5 h-3.5" />{belumSoal} soal belum disetujui</span>
                      <span className="flex items-center gap-1"><PlayCircle className="w-3.5 h-3.5" />{sesiBerjalan} sesi berjalan</span>
                      <span className="flex items-center gap-1"><CheckCircle2 className="w-3.5 h-3.5" />{belumKirim} nilai belum terkirim</span>
                    </div>
                  </div>
                </button>

                {!isCollapsed && (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm border border-slate-200 border-collapse">
                      <thead>
                        <tr className="bg-slate-50 text-xs text-slate-500 uppercase tracking-wide">
                          <th className="text-left p-2.5 pl-4 border border-slate-200">Mapel</th>
                          <th className="text-left p-2.5 border border-slate-200">Kelas</th>
                          <th className="text-left p-2.5 border border-slate-200">Guru</th>
                          <th className="text-left p-2.5 border border-slate-200 bg-blue-50/50">Status Soal</th>
                          <th className="text-left p-2.5 border border-slate-200 bg-blue-50/50">Kisi-kisi</th>
                          <th className="text-left p-2.5 border border-slate-200 bg-blue-50/50">Jadwal</th>
                          <th className="text-left p-2.5 border border-slate-200 bg-indigo-50/50">Mode Jawaban Essay</th>
                          <th className="text-left p-2.5 border border-slate-200 bg-amber-50/50">Progres Ujian</th>
                          <th className="text-left p-2.5 border border-slate-200 bg-amber-50/50">Pelanggaran</th>
                          <th className="text-left p-2.5 border border-slate-200 bg-emerald-50/50">Rata-rata</th>
                          <th className="text-left p-2.5 border border-slate-200 bg-emerald-50/50">Kirim Wali</th>
                        </tr>
                      </thead>
                      <tbody>
                        {g.rows.map(r => (
                          <tr key={`${r.mapelId}-${r.kelasId}`} className="hover:bg-slate-50/60">
                            <td className="p-2.5 pl-4 font-medium text-slate-700 border border-slate-200">{r.namaMapel}</td>
                            <td className="p-2.5 text-slate-600 border border-slate-200">{r.namaKelas}</td>
                            <td className="p-2.5 text-slate-600 border border-slate-200">{r.namaGuru}</td>
                            <td className="p-2.5 border border-slate-200">
                              <Pill label={STATUS_SOAL_LABEL[r.pra.statusSoal] ?? r.pra.statusSoal} color={STATUS_SOAL_COLOR[r.pra.statusSoal] ?? 'slate'} />
                              <span className="block text-[11px] text-muted mt-0.5">
                                {r.pra.jumlahSoal} soal (M{r.pra.distribusi.mudah}/S{r.pra.distribusi.sedang}/Sk{r.pra.distribusi.sukar})
                              </span>
                              {r.pra.catatanPenolakan && (
                                <span className="block text-[11px] text-red-600 mt-0.5">{r.pra.catatanPenolakan}</span>
                              )}
                            </td>
                            <td className="p-2.5 border border-slate-200">
                              <Pill label={STATUS_KISI_LABEL[r.pra.statusKisiKisi] ?? r.pra.statusKisiKisi} color={STATUS_KISI_COLOR[r.pra.statusKisiKisi] ?? 'slate'} />
                            </td>
                            <td className="p-2.5 text-xs text-slate-600 border border-slate-200">
                              {r.pra.jadwal.length
                                ? <>{r.pra.jadwal.length} sesi<br />terdekat: {formatDate(r.pra.jadwal[0].tanggal)}</>
                                : <span className="text-slate-400">Belum dijadwalkan</span>}
                            </td>
                            <td className="p-2.5 text-xs border border-slate-200">
                              {r.pra.adaEssay
                                ? <Pill
                                    label={r.pra.modeJawabanEssay === 'KERTAS' ? 'Kertas' : 'Digital'}
                                    color={r.pra.modeJawabanEssay === 'KERTAS' ? 'yellow' : 'blue'}
                                  />
                                : <span className="text-slate-400">Tidak ada soal essay</span>}
                            </td>
                            <td className="p-2.5 text-xs border border-slate-200">
                              <Pill
                                label={r.saat.adaSesiBerjalan ? 'Sedang Berjalan' : (r.saat.siswaTerdaftar > 0 ? 'Sudah Selesai' : 'Belum Mulai')}
                                color={r.saat.adaSesiBerjalan ? 'blue' : (r.saat.siswaTerdaftar > 0 ? 'green' : 'slate')}
                              />
                              <span className="block text-slate-500 mt-0.5">{r.saat.siswaSelesai}/{r.saat.totalSiswaKelas} siswa selesai</span>
                            </td>
                            <td className="p-2.5 text-xs border border-slate-200">
                              {r.saat.pelanggaranBelumDitindak > 0
                                ? <span className="font-semibold text-red-600">{r.saat.pelanggaranBelumDitindak} belum ditindak</span>
                                : <span className="text-slate-400">Tidak ada</span>}
                              {r.setelah.pelanggaranFinal > 0 && (
                                <span className="block text-slate-500 mt-0.5">{r.setelah.pelanggaranFinal} total tercatat</span>
                              )}
                            </td>
                            <td className="p-2.5 text-slate-700 border border-slate-200">
                              {r.setelah.totalNilai > 0 ? (
                                <>
                                  <span className="font-semibold">{r.setelah.rataRata}</span>
                                  <span className="block text-[11px] text-muted mt-0.5">{r.setelah.jumlahLulus} lulus / {r.setelah.jumlahTidakLulus} tidak</span>
                                </>
                              ) : <span className="text-slate-400 text-xs">Belum ada nilai</span>}
                            </td>
                            <td className="p-2.5 text-xs border border-slate-200">
                              {r.setelah.totalNilai > 0 ? (
                                <>
                                  <Pill
                                    label={`${r.setelah.sudahDikirimWali}/${r.setelah.totalNilai}`}
                                    color={r.setelah.sudahDikirimWali === r.setelah.totalNilai ? 'green' : 'yellow'}
                                  />
                                  {r.setelah.adaDikembalikan && <span className="block text-red-500 mt-0.5">Ada revisi</span>}
                                </>
                              ) : <span className="text-slate-400">-</span>}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
