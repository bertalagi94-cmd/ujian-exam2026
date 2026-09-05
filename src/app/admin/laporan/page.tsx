'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import {
  FileBarChart, RefreshCw, Download, Search, ChevronDown, ChevronRight,
  ClipboardList, PlayCircle, CheckCircle2, School as SchoolIcon,
} from 'lucide-react'
import { Toast, Spinner, EmptyState } from '@/components/ui'
import { apiRequest, formatDate } from '@/lib/utils'

// ── Tipe data (harus selaras dengan response /api/admin/laporan-lengkap) ─────
interface JadwalItem {
  tanggal: string
  sesi: number
  jamMulai: string
  jamSelesai: string
  namaPengawas: string
  durasi: number
  statusJadwal: string
}
interface RowLaporan {
  mapelId: string
  namaMapel: string
  namaGuru: string
  kelasId: string
  namaKelas: string
  pra: {
    statusSoal: string
    jumlahSoal: number
    distribusi: { mudah: number; sedang: number; sukar: number }
    catatanPenolakan: string | null
    statusKisiKisi: string
    jadwal: JadwalItem[]
  }
  saat: {
    adaSesiBerjalan: boolean
    totalSiswaKelas: number
    siswaTerdaftar: number
    siswaSelesai: number
    pelanggaranBelumDitindak: number
  }
  setelah: {
    adaJadwalSelesai: boolean
    totalNilai: number
    rataRata: number
    jumlahLulus: number
    jumlahTidakLulus: number
    sudahDikirimWali: number
    adaDikembalikan: boolean
    pelanggaranFinal: number
  }
}
interface JenjangGroup {
  sekolahId: string | null
  label: string
  namaSekolah: string
  npsn: string
  namaKepsek: string
  nipKepsek: string
  alamat: string
  kota: string
  tahunAjaran: string
  logoUrl: string
  rows: RowLaporan[]
}
interface LaporanResponse {
  generatedAt: string
  data: JenjangGroup[]
}

// ── Label & warna status (dipakai di preview & PDF) ──────────────────────────
const STATUS_SOAL_LABEL: Record<string, string> = {
  BELUM_DIBUAT: 'Belum Dibuat', DRAFT: 'Draft', MENUNGGU: 'Menunggu Validasi',
  DISETUJUI: 'Disetujui', DITOLAK: 'Ditolak',
}
const STATUS_KISI_LABEL: Record<string, string> = {
  BELUM_DIBUAT: 'Belum Dibuat', DRAFT: 'Draft', TERKIRIM: 'Terkirim',
}
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
// Warna RGB (dipakai jsPDF, bukan Tailwind) senada dengan pill di atas
const PILL_RGB: Record<PillColor, [number, number, number]> = {
  green: [16, 150, 90], yellow: [180, 130, 10], red: [200, 45, 45], slate: [100, 116, 139], blue: [37, 99, 235],
}

function Pill({ label, color }: { label: string; color: PillColor }) {
  return <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${PILL_CLASS[color]}`}>{label}</span>
}

export default function AdminLaporanPage() {
  const [data, setData] = useState<JenjangGroup[]>([])
  const [generatedAt, setGeneratedAt] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [downloading, setDownloading] = useState<string | null>(null) // sekolahId yang sedang di-download, atau 'ALL'
  const [search, setSearch] = useState('')
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

  // Filter pencarian (client-side) — dipakai untuk preview DAN untuk PDF yang di-generate
  const filteredData = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return data
    return data
      .map(g => ({
        ...g,
        rows: g.rows.filter(r =>
          r.namaMapel.toLowerCase().includes(q) ||
          r.namaKelas.toLowerCase().includes(q) ||
          r.namaGuru.toLowerCase().includes(q)
        ),
      }))
      .filter(g => g.rows.length > 0)
  }, [data, search])

  const toggleCollapse = (key: string) => setCollapsed(prev => ({ ...prev, [key]: !prev[key] }))

  // ───────────────────────────────────────────────────────────────────────────
  // GENERATOR PDF (jsPDF, client-side) — kop sekolah per jenjang + 3 tabel
  // berwarna (Pra Ujian / Saat Ujian / Setelah Ujian), sesuai jenjang masing2
  // supaya data antar jenjang TIDAK PERNAH tercampur dalam satu tabel.
  // ───────────────────────────────────────────────────────────────────────────
  async function downloadPdf(target: JenjangGroup[], scope: string) {
    setDownloading(scope)
    try {
      const { jsPDF } = await import('jspdf')
      const doc = new jsPDF({ unit: 'mm', format: 'a4' })
      const pageW = 210, pageH = 297
      const lm = 15, rm = 15, w = pageW - lm - rm
      const logoCache = new Map<string, string>()

      async function getLogoB64(url: string): Promise<string | null> {
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

      function ensureSpace(y: number, needed: number): number {
        if (y + needed > pageH - 15) {
          doc.addPage()
          return 20
        }
        return y
      }

      function pillRect(x: number, y: number, text: string, color: PillColor) {
        const [r, g, b] = PILL_RGB[color]
        doc.setFontSize(7.5)
        const tw = doc.getTextWidth(text)
        const boxW = tw + 4
        doc.setFillColor(r, g, b)
        doc.roundedRect(x, y - 3.2, boxW, 4.6, 1, 1, 'F')
        doc.setTextColor(255, 255, 255)
        doc.text(text, x + 2, y)
        doc.setTextColor(20, 20, 20)
        return boxW
      }

      function sectionBanner(y: number, title: string, rgb: [number, number, number]): number {
        doc.setFillColor(rgb[0], rgb[1], rgb[2])
        doc.roundedRect(lm, y, w, 8, 1.5, 1.5, 'F')
        doc.setTextColor(255, 255, 255)
        doc.setFont('helvetica', 'bold')
        doc.setFontSize(11)
        doc.text(title, lm + 4, y + 5.6)
        doc.setTextColor(20, 20, 20)
        doc.setFont('helvetica', 'normal')
        return y + 12
      }

      // Header kolom tabel generik
      function tableHeader(y: number, cols: { label: string; width: number }[], rgb: [number, number, number]): number {
        let cx = lm
        doc.setFillColor(rgb[0], rgb[1], rgb[2])
        doc.setDrawColor(255, 255, 255)
        doc.setTextColor(255, 255, 255)
        doc.setFont('helvetica', 'bold')
        doc.setFontSize(8)
        for (const c of cols) {
          doc.rect(cx, y, c.width, 7, 'F')
          doc.text(c.label, cx + 2, y + 4.7)
          cx += c.width
        }
        doc.setTextColor(20, 20, 20)
        doc.setFont('helvetica', 'normal')
        return y + 7
      }

      for (let gi = 0; gi < target.length; gi++) {
        const g = target[gi]
        if (gi > 0) doc.addPage()
        let y = 18

        // ── Kop sekolah (spesifik per jenjang, supaya tidak tertukar) ──────
        const logoB64 = await getLogoB64(g.logoUrl)
        if (logoB64) {
          try { doc.addImage(logoB64, 'PNG', lm, y - 4, 18, 18) } catch { /* lewati kalau gagal decode */ }
        }
        doc.setFont('helvetica', 'bold')
        doc.setFontSize(14)
        doc.text((g.namaSekolah || 'NAMA SEKOLAH').toUpperCase(), pageW / 2, y + 2, { align: 'center' })
        doc.setFont('helvetica', 'normal')
        doc.setFontSize(9)
        doc.text(`NPSN: ${g.npsn || '-'}  |  ${g.alamat || '-'}${g.kota ? ', ' + g.kota : ''}`, pageW / 2, y + 7, { align: 'center' })
        doc.text(`Tahun Ajaran: ${g.tahunAjaran || '-'}`, pageW / 2, y + 11, { align: 'center' })
        y += 15
        doc.setLineWidth(0.8); doc.line(lm, y, lm + w, y)
        doc.setLineWidth(0.3); doc.line(lm, y + 1.2, lm + w, y + 1.2)
        y += 6

        // Banner jenjang + judul laporan
        doc.setFillColor(8, 47, 73)
        doc.roundedRect(lm, y, w, 9, 1.5, 1.5, 'F')
        doc.setTextColor(255, 255, 255)
        doc.setFont('helvetica', 'bold')
        doc.setFontSize(11)
        doc.text(`LAPORAN LENGKAP PERSIAPAN & PELAKSANAAN UJIAN — JENJANG ${g.label.toUpperCase()}`, lm + 4, y + 6)
        doc.setTextColor(20, 20, 20)
        doc.setFont('helvetica', 'normal')
        y += 13
        doc.setFontSize(8.5)
        doc.setTextColor(90, 90, 90)
        doc.text(`Dicetak: ${generatedAt ? formatDate(generatedAt) : '-'}  |  Total kombinasi mapel + kelas: ${g.rows.length}`, lm, y)
        doc.setTextColor(20, 20, 20)
        y += 6

        // ── SEKSI 1: PRA UJIAN (biru) ──────────────────────────────────────
        y = ensureSpace(y, 16)
        y = sectionBanner(y, '1. PRA UJIAN — Persiapan Soal, Kisi-kisi & Jadwal', [37, 99, 235])
        const praCols = [
          { label: 'Mapel', width: 30 },
          { label: 'Kelas', width: 20 },
          { label: 'Guru', width: 30 },
          { label: 'Status Soal', width: 26 },
          { label: 'Jml (M/S/Sk)', width: 24 },
          { label: 'Kisi-kisi', width: 20 },
          { label: 'Jadwal', width: w - (30 + 20 + 30 + 26 + 24 + 20) },
        ]
        y = ensureSpace(y, 10)
        y = tableHeader(y, praCols, [37, 99, 235])
        doc.setFontSize(7.5)
        for (let i = 0; i < g.rows.length; i++) {
          const r = g.rows[i]
          const rowH = 8
          y = ensureSpace(y, rowH + 12)
          if (y === 20) y = tableHeader(y, praCols, [37, 99, 235]) // header ulang di halaman baru
          if (i % 2 === 1) { doc.setFillColor(240, 245, 255); doc.rect(lm, y, w, rowH, 'F') }
          let cx = lm
          doc.text(r.namaMapel.slice(0, 16), cx + 2, y + 5); cx += praCols[0].width
          doc.text(r.namaKelas.slice(0, 12), cx + 2, y + 5); cx += praCols[1].width
          doc.text(r.namaGuru.slice(0, 18), cx + 2, y + 5); cx += praCols[2].width
          pillRect(cx + 1, y + 5.4, STATUS_SOAL_LABEL[r.pra.statusSoal] ?? r.pra.statusSoal, STATUS_SOAL_COLOR[r.pra.statusSoal] ?? 'slate'); cx += praCols[3].width
          doc.text(`${r.pra.jumlahSoal} (${r.pra.distribusi.mudah}/${r.pra.distribusi.sedang}/${r.pra.distribusi.sukar})`, cx + 2, y + 5); cx += praCols[4].width
          pillRect(cx + 1, y + 5.4, STATUS_KISI_LABEL[r.pra.statusKisiKisi] ?? r.pra.statusKisiKisi, STATUS_KISI_COLOR[r.pra.statusKisiKisi] ?? 'slate'); cx += praCols[5].width
          const jadwalTxt = r.pra.jadwal.length
            ? `${r.pra.jadwal.length} sesi — terdekat ${formatDate(r.pra.jadwal[0].tanggal)} (sesi ${r.pra.jadwal[0].sesi})`
            : 'Belum dijadwalkan'
          doc.text(jadwalTxt.slice(0, 42), cx + 2, y + 5)
          y += rowH
          if (r.pra.catatanPenolakan) {
            doc.setTextColor(180, 45, 45)
            doc.setFontSize(6.8)
            doc.text(`Catatan penolakan: ${r.pra.catatanPenolakan.slice(0, 110)}`, lm + 2, y + 3)
            doc.setTextColor(20, 20, 20)
            doc.setFontSize(7.5)
            y += 4.5
          }
        }
        y += 6

        // ── SEKSI 2: SAAT UJIAN (oranye) ────────────────────────────────────
        y = ensureSpace(y, 16)
        y = sectionBanner(y, '2. SAAT UJIAN — Progres Pelaksanaan', [217, 119, 6])
        const saatCols = [
          { label: 'Mapel', width: 32 },
          { label: 'Kelas', width: 22 },
          { label: 'Status', width: 22 },
          { label: 'Peserta / Total Siswa', width: 40 },
          { label: 'Selesai Mengerjakan', width: 38 },
          { label: 'Pelanggaran Belum Ditindak', width: w - (32 + 22 + 22 + 40 + 38) },
        ]
        y = ensureSpace(y, 10)
        y = tableHeader(y, saatCols, [217, 119, 6])
        doc.setFontSize(7.5)
        for (let i = 0; i < g.rows.length; i++) {
          const r = g.rows[i]
          const rowH = 7
          y = ensureSpace(y, rowH)
          if (y === 20) y = tableHeader(y, saatCols, [217, 119, 6])
          if (i % 2 === 1) { doc.setFillColor(255, 247, 235); doc.rect(lm, y, w, rowH, 'F') }
          let cx = lm
          doc.text(r.namaMapel.slice(0, 18), cx + 2, y + 4.7); cx += saatCols[0].width
          doc.text(r.namaKelas.slice(0, 13), cx + 2, y + 4.7); cx += saatCols[1].width
          const statusSaat = r.saat.adaSesiBerjalan ? 'BERJALAN' : (r.saat.siswaTerdaftar > 0 ? 'SELESAI' : 'BELUM MULAI')
          const statusSaatColor: PillColor = r.saat.adaSesiBerjalan ? 'blue' : (r.saat.siswaTerdaftar > 0 ? 'green' : 'slate')
          pillRect(cx + 1, y + 4.9, statusSaat, statusSaatColor); cx += saatCols[2].width
          doc.text(`${r.saat.siswaTerdaftar} / ${r.saat.totalSiswaKelas}`, cx + 2, y + 4.7); cx += saatCols[3].width
          doc.text(`${r.saat.siswaSelesai}`, cx + 2, y + 4.7); cx += saatCols[4].width
          if (r.saat.pelanggaranBelumDitindak > 0) {
            doc.setTextColor(200, 45, 45); doc.setFont('helvetica', 'bold')
            doc.text(`${r.saat.pelanggaranBelumDitindak}`, cx + 2, y + 4.7)
            doc.setFont('helvetica', 'normal'); doc.setTextColor(20, 20, 20)
          } else {
            doc.text('0', cx + 2, y + 4.7)
          }
          y += rowH
        }
        y += 6

        // ── SEKSI 3: SETELAH UJIAN (hijau) ─────────────────────────────────
        y = ensureSpace(y, 16)
        y = sectionBanner(y, '3. SETELAH UJIAN — Rekap Hasil & Tindak Lanjut', [22, 163, 74])
        const setelahCols = [
          { label: 'Mapel', width: 28 },
          { label: 'Kelas', width: 20 },
          { label: 'Rata-rata', width: 20 },
          { label: 'Lulus/Tdk', width: 22 },
          { label: 'Kirim Wali', width: 28 },
          { label: 'Dikembalikan', width: 26 },
          { label: 'Pelanggaran', width: w - (28 + 20 + 20 + 22 + 28 + 26) },
        ]
        y = ensureSpace(y, 10)
        y = tableHeader(y, setelahCols, [22, 163, 74])
        doc.setFontSize(7.5)
        for (let i = 0; i < g.rows.length; i++) {
          const r = g.rows[i]
          const rowH = 7
          y = ensureSpace(y, rowH)
          if (y === 20) y = tableHeader(y, setelahCols, [22, 163, 74])
          if (i % 2 === 1) { doc.setFillColor(236, 253, 245); doc.rect(lm, y, w, rowH, 'F') }
          let cx = lm
          doc.text(r.namaMapel.slice(0, 15), cx + 2, y + 4.7); cx += setelahCols[0].width
          doc.text(r.namaKelas.slice(0, 12), cx + 2, y + 4.7); cx += setelahCols[1].width
          doc.text(r.setelah.totalNilai > 0 ? String(r.setelah.rataRata) : '-', cx + 2, y + 4.7); cx += setelahCols[2].width
          doc.text(`${r.setelah.jumlahLulus}/${r.setelah.jumlahTidakLulus}`, cx + 2, y + 4.7); cx += setelahCols[3].width
          const kirimTxt = r.setelah.totalNilai > 0 ? `${r.setelah.sudahDikirimWali}/${r.setelah.totalNilai}` : '-'
          const kirimColor: PillColor = r.setelah.totalNilai === 0 ? 'slate'
            : r.setelah.sudahDikirimWali === r.setelah.totalNilai ? 'green' : 'yellow'
          pillRect(cx + 1, y + 4.9, kirimTxt, kirimColor); cx += setelahCols[4].width
          doc.text(r.setelah.adaDikembalikan ? 'Ya, direvisi' : '-', cx + 2, y + 4.7); cx += setelahCols[5].width
          doc.text(`${r.setelah.pelanggaranFinal}`, cx + 2, y + 4.7)
          y += rowH
        }
      }

      const filenamePart = target.length === 1 ? (target[0].label || 'jenjang').replace(/[^a-z0-9]+/gi, '_') : 'semua_jenjang'
      doc.save(`Laporan_Lengkap_Ujian_${filenamePart}_${new Date().toISOString().slice(0, 10)}.pdf`)
      showToast('PDF berhasil diunduh')
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
            onClick={() => downloadPdf(filteredData, 'ALL')}
            disabled={loading || filteredData.length === 0 || downloading !== null}
          >
            {downloading === 'ALL' ? <Spinner size="sm" /> : <Download className="w-4 h-4" />}
            Download PDF Semua Jenjang
          </button>
        </div>
      </div>

      {generatedAt && (
        <p className="text-xs text-muted">
          Data dihitung: {new Date(generatedAt).toLocaleString('id-ID')} · Total kombinasi mapel + kelas: {totalKombinasi}
        </p>
      )}

      {/* Search */}
      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
        <input
          className="input pl-9"
          placeholder="Cari mapel, kelas, atau nama guru..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><Spinner size="lg" /></div>
      ) : filteredData.length === 0 ? (
        <EmptyState icon={FileBarChart} title="Tidak ada data" description="Belum ada kombinasi mapel + kelas yang bisa dilaporkan, atau pencarian tidak menemukan hasil." />
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
                    <span
                      role="button"
                      className="btn-secondary text-xs py-1.5 px-3 flex items-center gap-1.5"
                      onClick={(e) => { e.stopPropagation(); downloadPdf([g], g.sekolahId ?? key) }}
                    >
                      {downloading === (g.sekolahId ?? key) ? <Spinner size="sm" /> : <Download className="w-3.5 h-3.5" />}
                      PDF Jenjang Ini
                    </span>
                  </div>
                </button>

                {!isCollapsed && (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-slate-50 border-y border-slate-200 text-xs text-slate-500 uppercase tracking-wide">
                          <th className="text-left p-2.5 pl-4">Mapel</th>
                          <th className="text-left p-2.5">Kelas</th>
                          <th className="text-left p-2.5">Guru</th>
                          <th className="text-left p-2.5 bg-blue-50/50">Status Soal</th>
                          <th className="text-left p-2.5 bg-blue-50/50">Kisi-kisi</th>
                          <th className="text-left p-2.5 bg-blue-50/50">Jadwal</th>
                          <th className="text-left p-2.5 bg-amber-50/50">Progres Ujian</th>
                          <th className="text-left p-2.5 bg-amber-50/50">Pelanggaran</th>
                          <th className="text-left p-2.5 bg-emerald-50/50">Rata-rata</th>
                          <th className="text-left p-2.5 bg-emerald-50/50">Kirim Wali</th>
                        </tr>
                      </thead>
                      <tbody>
                        {g.rows.map(r => (
                          <tr key={`${r.mapelId}-${r.kelasId}`} className="border-b border-slate-100 hover:bg-slate-50/60">
                            <td className="p-2.5 pl-4 font-medium text-slate-700">{r.namaMapel}</td>
                            <td className="p-2.5 text-slate-600">{r.namaKelas}</td>
                            <td className="p-2.5 text-slate-600">{r.namaGuru}</td>
                            <td className="p-2.5">
                              <Pill label={STATUS_SOAL_LABEL[r.pra.statusSoal] ?? r.pra.statusSoal} color={STATUS_SOAL_COLOR[r.pra.statusSoal] ?? 'slate'} />
                              <span className="block text-[11px] text-muted mt-0.5">
                                {r.pra.jumlahSoal} soal (M{r.pra.distribusi.mudah}/S{r.pra.distribusi.sedang}/Sk{r.pra.distribusi.sukar})
                              </span>
                              {r.pra.catatanPenolakan && (
                                <span className="block text-[11px] text-red-600 mt-0.5">{r.pra.catatanPenolakan}</span>
                              )}
                            </td>
                            <td className="p-2.5">
                              <Pill label={STATUS_KISI_LABEL[r.pra.statusKisiKisi] ?? r.pra.statusKisiKisi} color={STATUS_KISI_COLOR[r.pra.statusKisiKisi] ?? 'slate'} />
                            </td>
                            <td className="p-2.5 text-xs text-slate-600">
                              {r.pra.jadwal.length
                                ? <>{r.pra.jadwal.length} sesi<br />terdekat: {formatDate(r.pra.jadwal[0].tanggal)}</>
                                : <span className="text-slate-400">Belum dijadwalkan</span>}
                            </td>
                            <td className="p-2.5 text-xs">
                              <Pill
                                label={r.saat.adaSesiBerjalan ? 'Sedang Berjalan' : (r.saat.siswaTerdaftar > 0 ? 'Sudah Selesai' : 'Belum Mulai')}
                                color={r.saat.adaSesiBerjalan ? 'blue' : (r.saat.siswaTerdaftar > 0 ? 'green' : 'slate')}
                              />
                              <span className="block text-slate-500 mt-0.5">{r.saat.siswaSelesai}/{r.saat.totalSiswaKelas} siswa selesai</span>
                            </td>
                            <td className="p-2.5 text-xs">
                              {r.saat.pelanggaranBelumDitindak > 0
                                ? <span className="font-semibold text-red-600">{r.saat.pelanggaranBelumDitindak} belum ditindak</span>
                                : <span className="text-slate-400">Tidak ada</span>}
                              {r.setelah.pelanggaranFinal > 0 && (
                                <span className="block text-slate-500 mt-0.5">{r.setelah.pelanggaranFinal} total tercatat</span>
                              )}
                            </td>
                            <td className="p-2.5 text-slate-700">
                              {r.setelah.totalNilai > 0 ? (
                                <>
                                  <span className="font-semibold">{r.setelah.rataRata}</span>
                                  <span className="block text-[11px] text-muted mt-0.5">{r.setelah.jumlahLulus} lulus / {r.setelah.jumlahTidakLulus} tidak</span>
                                </>
                              ) : <span className="text-slate-400 text-xs">Belum ada nilai</span>}
                            </td>
                            <td className="p-2.5 text-xs">
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
