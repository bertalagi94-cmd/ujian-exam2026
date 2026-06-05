'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  Plus, Pencil, Trash2, Calendar, FileText, Download, PackageOpen,
  CheckCircle, Clock, AlertCircle, XCircle, HelpCircle, AlertTriangle
} from 'lucide-react'
import { Modal, Confirm, StatusBadge, SearchInput, EmptyState, Spinner, Toast, Pagination } from '@/components/ui'
import { apiRequest, formatDate } from '@/lib/utils'
import { Jadwal, Mapel, Kelas, User } from '@/types'

const PER_PAGE = 20

function fmtTanggal(d: string) {
  if (!d) return ''
  const days = ['Minggu','Senin','Selasa','Rabu','Kamis','Jumat','Sabtu']
  const months = ['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember']
  const dt = new Date(d)
  return `${days[dt.getDay()]}, ${dt.getDate()} ${months[dt.getMonth()]} ${dt.getFullYear()}`
}
function fmtTglPendek(d: string) {
  if (!d) return ''
  const months = ['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember']
  const dt = new Date(d)
  return `${dt.getDate()} ${months[dt.getMonth()]} ${dt.getFullYear()}`
}

// Badge status soal
function SoalStatusBadge({ status }: { status?: string }) {
  switch (status) {
    case 'DISETUJUI':
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-700">
          <CheckCircle className="w-3 h-3" /> Soal Siap
        </span>
      )
    case 'MENUNGGU':
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-700">
          <Clock className="w-3 h-3" /> Menunggu Persetujuan
        </span>
      )
    case 'DRAFT':
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-blue-100 text-blue-700">
          <AlertCircle className="w-3 h-3" /> Draft
        </span>
      )
    case 'DITOLAK':
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-red-100 text-red-700">
          <XCircle className="w-3 h-3" /> Ditolak
        </span>
      )
    default:
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-slate-100 text-slate-500">
          <HelpCircle className="w-3 h-3" /> Belum Ada Soal
        </span>
      )
  }
}

interface Siswa { nis: string; nama: string }
interface JadwalCetak {
  id: string; tanggal: string; sesi: number
  jam_mulai: string; jam_selesai: string; durasi: number
  kelas: string; nama_mapel: string; nama_pengawas: string
  siswa: Siswa[]
}
interface Sekolah {
  namaSekolah?: string; npsn?: string; alamat?: string
  kota?: string; tahunAjaran?: string; namaKepsek?: string; logoUrl?: string
}

export default function AdminJadwalPage() {
  const [jadwal, setJadwal] = useState<Jadwal[]>([])
  const [mapelList, setMapelList] = useState<Mapel[]>([])
  const [kelasList, setKelasList] = useState<Kelas[]>([])
  const [guruList, setGuruList] = useState<User[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [page, setPage] = useState(1)
  const [modalOpen, setModalOpen] = useState(false)
  const [editData, setEditData] = useState<Partial<Jadwal> | null>(null)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [selectedMapelId, setSelectedMapelId] = useState<string>('')
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null)

  const [cetakMassalOpen, setCetakMassalOpen] = useState(false)
  const [cetakMode, setCetakMode] = useState<{ daftarHadir: boolean; beritaAcara: boolean }>({ daftarHadir: true, beritaAcara: true })
  const [cetakTanggal, setCetakTanggal] = useState('')
  const [tanggalList, setTanggalList] = useState<string[]>([])
  const [downloadingZip, setDownloadingZip] = useState(false)
  const [soalBelumSiapOpen, setSoalBelumSiapOpen] = useState(false)

  const showToast = (msg: string, type: 'success' | 'error' = 'success') => setToast({ msg, type })

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await apiRequest<{ data: Jadwal[] }>('/api/admin/jadwal')
      setJadwal(res.data)
      const dates = [...new Set(res.data.map(j => j.tanggal.slice(0, 10)))].sort().reverse()
      setTanggalList(dates)
      if (dates.length > 0) setCetakTanggal(dates[0])
    } finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])
  useEffect(() => {
    Promise.all([
      apiRequest<{ data: Mapel[] }>('/api/admin/mapel'),
      apiRequest<{ data: Kelas[] }>('/api/admin/kelas'),
      apiRequest<{ data: User[] }>('/api/admin/users'),
    ]).then(([m, k, u]) => {
      setMapelList(m.data)
      setKelasList(k.data)
      setGuruList(u.data.filter(u => u.role === 'GURU'))
    })
  }, [])

  const filtered = jadwal.filter(j => {
    const matchSearch = !search || (j.nama_mapel ?? '').toLowerCase().includes(search.toLowerCase())
    const matchStatus = !filterStatus || j.status === filterStatus
    return matchSearch && matchStatus
  })

  const paginated = filtered.slice((page - 1) * PER_PAGE, page * PER_PAGE)

  async function handleSave(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    const payload = Object.fromEntries(fd.entries())
    setSaving(true)
    try {
      if (editData?.id) {
        await apiRequest('/api/admin/jadwal', { method: 'PUT', body: JSON.stringify({ id: editData.id, ...payload }) })
        showToast('Jadwal berhasil diperbarui')
      } else {
        await apiRequest('/api/admin/jadwal', { method: 'POST', body: JSON.stringify(payload) })
        showToast('Jadwal berhasil ditambahkan')
      }
      setModalOpen(false)
      load()
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Gagal menyimpan', 'error')
    } finally { setSaving(false) }
  }

  async function handleDelete() {
    if (!deleteId) return
    setSaving(true)
    try {
      await apiRequest('/api/admin/jadwal', { method: 'DELETE', body: JSON.stringify({ id: deleteId }) })
      showToast('Jadwal berhasil dihapus')
      setDeleteId(null)
      load()
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Gagal menghapus', 'error')
    } finally { setSaving(false) }
  }

  function cetakSatu(jadwal: Jadwal, mode: 'daftar-hadir' | 'berita-acara') {
    const url = `/admin/cetak?tanggal=${jadwal.tanggal.slice(0, 10)}&mode=${mode}&id=${jadwal.id}`
    window.open(url, '_blank')
  }

  async function generatePDFBlob(j: JadwalCetak, sekolah: Sekolah, mode: 'daftar-hadir' | 'berita-acara'): Promise<Uint8Array> {
    const { jsPDF } = await import('jspdf')
    const doc = new jsPDF({ unit: 'mm', format: 'a4' })
    const s = sekolah
    const lm = 25, rm = 20, top = 20, w = 210 - lm - rm
    const pageW = 210

    if (s.logoUrl) {
      try {
        const resp = await fetch(s.logoUrl)
        const blob = await resp.blob()
        const b64 = await new Promise<string>(res => {
          const r = new FileReader(); r.onload = () => res((r.result as string).split(',')[1]); r.readAsDataURL(blob)
        })
        doc.addImage(b64, 'PNG', lm, top, 18, 18)
      } catch { /* skip */ }
    }
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(14)
    doc.text((s.namaSekolah ?? 'NAMA SEKOLAH').toUpperCase(), pageW / 2, top + 6, { align: 'center' })
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9)
    doc.text(`NPSN: ${s.npsn ?? '-'}`, pageW / 2, top + 11, { align: 'center' })
    doc.text(s.alamat ?? '', pageW / 2, top + 15, { align: 'center' })

    const lineY = top + 21
    doc.setLineWidth(0.8); doc.line(lm, lineY, lm + w, lineY)
    doc.setLineWidth(0.3); doc.line(lm, lineY + 1.5, lm + w, lineY + 1.5)

    let my = lineY + 2

    if (mode === 'daftar-hadir') {
      doc.setFont('helvetica', 'bold'); doc.setFontSize(12)
      my += 8
      doc.text('DAFTAR HADIR PESERTA UJIAN', pageW / 2, my, { align: 'center' })
      doc.setLineWidth(0.3)
      doc.line(pageW / 2 - 38, my + 1, pageW / 2 + 38, my + 1)
      my += 8

      doc.setFont('helvetica', 'normal'); doc.setFontSize(10)
      const meta = [
        ['Mata Pelajaran', j.nama_mapel, 'Kelas', j.kelas],
        ['Hari / Tanggal', fmtTanggal(j.tanggal), 'Sesi', `Sesi ke-${j.sesi}`],
        ['Pukul', `${j.jam_mulai} - ${j.jam_selesai} WITA`, 'Pengawas', j.nama_pengawas || '-'],
        ['Tahun Ajaran', s.tahunAjaran ?? '-', 'Durasi', `${j.durasi} menit`],
      ]
      for (const row of meta) {
        doc.text(row[0], lm, my); doc.text(':', lm + 32, my)
        doc.setFont('helvetica', 'bold'); doc.text(row[1], lm + 35, my); doc.setFont('helvetica', 'normal')
        doc.text(row[2], lm + w / 2 + 2, my); doc.text(':', lm + w / 2 + 28, my)
        doc.setFont('helvetica', 'bold'); doc.text(row[3], lm + w / 2 + 31, my); doc.setFont('helvetica', 'normal')
        my += 6
      }

      my += 3
      const colW = [12, 35, w - 12 - 35 - 38, 38]
      const headers = ['No', 'NIS', 'Nama Siswa', 'Tanda Tangan']
      doc.setFillColor(220, 220, 220)
      doc.setDrawColor(0)
      let cx = lm
      for (let i = 0; i < headers.length; i++) {
        doc.rect(cx, my, colW[i], 7, 'F')
        doc.rect(cx, my, colW[i], 7, 'S')
        cx += colW[i]
      }
      doc.setFont('helvetica', 'bold'); doc.setFontSize(9.5)
      cx = lm
      for (let i = 0; i < headers.length; i++) {
        doc.text(headers[i], cx + colW[i] / 2, my + 4.8, { align: 'center' })
        cx += colW[i]
      }
      my += 7

      doc.setFont('helvetica', 'normal')
      for (let i = 0; i < j.siswa.length; i++) {
        const siswa = j.siswa[i]
        if (my > 265) { doc.addPage(); my = 20 }
        cx = lm
        doc.rect(cx, my, colW[0], 7); doc.text(String(i + 1), cx + colW[0] / 2, my + 4.8, { align: 'center' }); cx += colW[0]
        doc.rect(cx, my, colW[1], 7); doc.text(siswa.nis, cx + 2, my + 4.8); cx += colW[1]
        doc.rect(cx, my, colW[2], 7); doc.text(siswa.nama, cx + 2, my + 4.8); cx += colW[2]
        doc.rect(cx, my, colW[3], 7); cx += colW[3]
        my += 7
      }
      my += 5
      doc.setFontSize(10)
      doc.text('Jumlah peserta: ', lm, my)
      doc.setFont('helvetica', 'bold'); doc.text(`${j.siswa.length} siswa`, lm + 32, my)
      doc.setFont('helvetica', 'normal')
      my += 6
    } else {
      doc.setFont('helvetica', 'bold'); doc.setFontSize(12)
      my += 8
      doc.text('BERITA ACARA PELAKSANAAN UJIAN', pageW / 2, my, { align: 'center' })
      doc.setLineWidth(0.3)
      doc.line(pageW / 2 - 44, my + 1, pageW / 2 + 44, my + 1)
      my += 10

      doc.setFont('helvetica', 'normal'); doc.setFontSize(10)
      const introPrefix = 'Pada hari ini,  '
      const introDate = fmtTanggal(j.tanggal)
      const introSuffix = ' telah dilaksanakan Ujian dengan ketentuan sebagai berikut:'
      doc.setFont('helvetica', 'normal')
      const prefixW = doc.getTextWidth(introPrefix)
      doc.setFont('helvetica', 'bold')
      const dateW = doc.getTextWidth(introDate)
      doc.setFont('helvetica', 'normal')
      doc.text(introPrefix, lm, my)
      doc.setFont('helvetica', 'bold')
      doc.text(introDate, lm + prefixW, my)
      doc.setFont('helvetica', 'normal')
      doc.text(introSuffix, lm + prefixW + dateW, my)
      my += 9

      const baRows = [
        ['Mata Pelajaran', j.nama_mapel],
        ['Kelas', j.kelas],
        ['Pukul', `${j.jam_mulai} s.d. ${j.jam_selesai} WITA (${j.durasi} menit)`],
        ['Sesi ke-', String(j.sesi)],
        ['Nama Pengawas', j.nama_pengawas || '-'],
        ['Jumlah Peserta Terdaftar', `${j.siswa.length} siswa`],
        ['Jumlah Hadir', '______ siswa'],
        ['Jumlah Tidak Hadir', '______ siswa (sakit: ___, izin: ___, alpha: ___)'],
        ['Kejadian Khusus', '_'.repeat(50)],
      ]
      for (const [label, val] of baRows) {
        doc.text(label, lm, my); doc.text(':', lm + 56, my); doc.text(val, lm + 60, my)
        my += 7
      }
      my += 5
      const closing = 'Demikian berita acara ini dibuat dengan sesungguhnya untuk dapat dipergunakan sebagaimana mestinya.'
      const lines = doc.splitTextToSize(closing, w)
      doc.text(lines, lm, my)
      my += lines.length * 6 + 8
    }

    const ttdY = my + 12
    const signSpace = 30
    doc.setFontSize(10)
    doc.setFont('helvetica', 'normal')
    doc.text('Pengawas Ujian,', lm, ttdY)

    const kota = s.kota ?? 'Banggai Kepulauan'
    doc.text(`${kota}, ${fmtTglPendek(j.tanggal)}`, lm + w, ttdY, { align: 'right' })
    doc.text('Mengetahui,', lm + w, ttdY + 5, { align: 'right' })
    doc.text(`Kepala ${s.namaSekolah ?? 'Sekolah'}`, lm + w, ttdY + 10, { align: 'right' })

    doc.setFont('helvetica', 'bold')
    doc.text(j.nama_pengawas || '_________________', lm, ttdY + signSpace)
    doc.setLineWidth(0.3)
    doc.line(lm, ttdY + signSpace + 1, lm + doc.getTextWidth(j.nama_pengawas || '_________________'), ttdY + signSpace + 1)

    doc.text(s.namaKepsek ?? '_________________', lm + w, ttdY + signSpace, { align: 'right' })
    const kepsekW = doc.getTextWidth(s.namaKepsek ?? '_________________')
    doc.line(lm + w - kepsekW, ttdY + signSpace + 1, lm + w, ttdY + signSpace + 1)

    return doc.output('arraybuffer') as unknown as Uint8Array
  }

  async function handleDownloadZip() {
    if (!cetakTanggal || (!cetakMode.daftarHadir && !cetakMode.beritaAcara)) return
    setDownloadingZip(true)
    try {
      const token = localStorage.getItem('token')
      const res = await fetch(`/api/admin/cetak?tanggal=${cetakTanggal}`, {
        headers: { Authorization: `Bearer ${token}` }
      })
      const json = await res.json()
      const jadwalList: JadwalCetak[] = json.data ?? []
      const sekolah: Sekolah = json.sekolah ?? {}

      const { default: JSZip } = await import('jszip')
      const zip = new JSZip()

      const modes: Array<'daftar-hadir' | 'berita-acara'> = []
      if (cetakMode.daftarHadir) modes.push('daftar-hadir')
      if (cetakMode.beritaAcara) modes.push('berita-acara')

      for (const j of jadwalList) {
        const kelas = j.kelas.replace(/[^a-zA-Z0-9]/g, '_')
        const mapel = j.nama_mapel.replace(/[^a-zA-Z0-9]/g, '_')
        const sesi = `Sesi${j.sesi}`
        for (const mode of modes) {
          const pdfBytes = await generatePDFBlob(j, sekolah, mode)
          const label = mode === 'daftar-hadir' ? 'DaftarHadir' : 'BeritaAcara'
          zip.file(`${label}_${kelas}_${mapel}_${sesi}.pdf`, pdfBytes)
        }
      }

      const zipBlob = await zip.generateAsync({ type: 'blob' })
      const url = URL.createObjectURL(zipBlob)
      const a = document.createElement('a')
      a.href = url
      a.download = `Cetak_${cetakTanggal}.zip`
      a.click()
      URL.revokeObjectURL(url)
      setCetakMassalOpen(false)
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Gagal membuat ZIP', 'error')
    } finally {
      setDownloadingZip(false)
    }
  }

  return (
    <div className="space-y-6 animate-fade-in">
      {toast && <Toast message={toast.msg} type={toast.type} onClose={() => setToast(null)} />}

      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="page-title">Jadwal Ujian</h1>
          <p className="page-subtitle">{jadwal.length} jadwal terdaftar</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button onClick={() => setCetakMassalOpen(true)} className="btn-secondary btn-sm">
            <PackageOpen className="w-4 h-4" /> Download Massal
          </button>
          {(() => {
            const belumSiap = jadwal.filter(j => j.status_soal !== 'DISETUJUI')
            return (
              <button
                onClick={() => setSoalBelumSiapOpen(true)}
                className={`btn-sm flex items-center gap-1.5 font-medium rounded-xl px-3 py-2 border transition-colors ${
                  belumSiap.length > 0
                    ? 'bg-amber-50 border-amber-300 text-amber-700 hover:bg-amber-100'
                    : 'bg-emerald-50 border-emerald-200 text-emerald-700 hover:bg-emerald-100'
                }`}
              >
                {belumSiap.length > 0
                  ? <AlertTriangle className="w-4 h-4" />
                  : <CheckCircle className="w-4 h-4" />
                }
                {belumSiap.length > 0 ? `${belumSiap.length} Soal Belum Siap` : 'Semua Soal Siap'}
              </button>
            )
          })()}
          <button onClick={() => { setEditData({}); setSelectedMapelId(''); setModalOpen(true) }} className="btn-primary btn-sm">
            <Plus className="w-4 h-4" /> Tambah Jadwal
          </button>
        </div>
      </div>

      <div className="card py-4 flex gap-3 flex-wrap">
        <SearchInput value={search} onChange={v => { setSearch(v); setPage(1) }}
          placeholder="Cari mata pelajaran..." className="flex-1 min-w-[200px]" />
        <select value={filterStatus} onChange={e => { setFilterStatus(e.target.value); setPage(1) }} className="select w-40">
          <option value="">Semua Status</option>
          {['AKTIF', 'BERJALAN', 'SELESAI'].map(s => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
      </div>

      {/* ── TABEL (desktop) ── */}
      <div className="card p-0 overflow-hidden hidden md:block">
        <div className="table-wrapper">
          {loading ? (
            <div className="flex justify-center py-20"><Spinner size="lg" /></div>
          ) : paginated.length === 0 ? (
            <EmptyState message="Tidak ada jadwal ditemukan" icon={Calendar} />
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Tanggal</th>
                  <th>Mata Pelajaran</th>
                  <th>Kelas</th>
                  <th>Pengawas</th>
                  <th>Waktu</th>
                  <th>Status Ujian</th>
                  <th>Status Soal</th>
                  <th>Aksi</th>
                </tr>
              </thead>
              <tbody>
                {paginated.map(j => (
                  <tr key={j.id}>
                    <td>
                      <div className="font-medium text-slate-800">{formatDate(j.tanggal)}</div>
                      <div className="text-xs text-slate-400">Sesi {j.sesi} · {j.durasi} mnt</div>
                    </td>
                    <td className="font-medium text-slate-800">{j.nama_mapel ?? j.mapel_id}</td>
                    <td><span className="badge-blue">{j.kelas}</span></td>
                    <td className="text-sm text-slate-600">{j.nama_pengawas ?? <span className="text-slate-400 text-xs">-</span>}</td>
                    <td className="text-sm text-slate-600 whitespace-nowrap">{j.jam_mulai} – {j.jam_selesai}</td>
                    <td><StatusBadge status={j.status} /></td>
                    <td><SoalStatusBadge status={j.status_soal} /></td>
                    <td>
                      <div className="flex gap-1 flex-wrap">
                        <button onClick={() => cetakSatu(j, 'daftar-hadir')}
                          className="btn-ghost btn-icon btn-sm text-emerald-600 hover:bg-emerald-50" title="Cetak Daftar Hadir">
                          <FileText className="w-3.5 h-3.5" />
                        </button>
                        <button onClick={() => cetakSatu(j, 'berita-acara')}
                          className="btn-ghost btn-icon btn-sm text-blue-600 hover:bg-blue-50" title="Cetak Berita Acara">
                          <Download className="w-3.5 h-3.5" />
                        </button>
                        {j.status === 'AKTIF' && (
                          <>
                            <button onClick={() => { setEditData(j); setSelectedMapelId(j.mapel_id ?? ''); setModalOpen(true) }}
                              className="btn-ghost btn-icon btn-sm text-slate-600 hover:bg-slate-50">
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                            <button onClick={() => setDeleteId(j.id)}
                              className="btn-ghost btn-icon btn-sm text-red-600 hover:bg-red-50">
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <div className="px-4 py-2 border-t border-slate-100">
          <Pagination page={page} totalPages={Math.ceil(filtered.length / PER_PAGE)}
            onPage={setPage} total={filtered.length} perPage={PER_PAGE} />
        </div>
      </div>

      {/* ── CARD LIST (mobile) ── */}
      <div className="md:hidden space-y-3">
        {loading ? (
          <div className="flex justify-center py-20"><Spinner size="lg" /></div>
        ) : paginated.length === 0 ? (
          <div className="card"><EmptyState message="Tidak ada jadwal ditemukan" icon={Calendar} /></div>
        ) : (
          <>
            {paginated.map(j => (
              <div key={j.id} className="card p-4 space-y-3">
                {/* Baris atas: mapel + status ujian */}
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="font-semibold text-slate-900">{j.nama_mapel ?? j.mapel_id}</div>
                    <div className="text-xs text-slate-500 mt-0.5">
                      {formatDate(j.tanggal)} · Sesi {j.sesi}
                    </div>
                  </div>
                  <StatusBadge status={j.status} />
                </div>

                {/* Detail */}
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                  <div className="text-slate-500">Kelas</div>
                  <div><span className="badge-blue">{j.kelas}</span></div>
                  <div className="text-slate-500">Waktu</div>
                  <div className="text-slate-700">{j.jam_mulai} – {j.jam_selesai} <span className="text-slate-400">({j.durasi} mnt)</span></div>
                  <div className="text-slate-500">Pengawas</div>
                  <div className="text-slate-700">{j.nama_pengawas ?? <span className="text-slate-400">-</span>}</div>
                </div>

                {/* Status soal */}
                <div className="pt-1 border-t border-slate-100">
                  <SoalStatusBadge status={j.status_soal} />
                </div>

                {/* Aksi */}
                <div className="flex gap-2 pt-1 border-t border-slate-100">
                  <button onClick={() => cetakSatu(j, 'daftar-hadir')}
                    className="flex-1 btn-secondary btn-sm text-emerald-700 border-emerald-200 hover:bg-emerald-50">
                    <FileText className="w-3.5 h-3.5" /> Daftar Hadir
                  </button>
                  <button onClick={() => cetakSatu(j, 'berita-acara')}
                    className="flex-1 btn-secondary btn-sm text-blue-700 border-blue-200 hover:bg-blue-50">
                    <Download className="w-3.5 h-3.5" /> Berita Acara
                  </button>
                  {j.status === 'AKTIF' && (
                    <>
                      <button onClick={() => { setEditData(j); setSelectedMapelId(j.mapel_id ?? ''); setModalOpen(true) }}
                        className="btn-ghost btn-icon btn-sm text-slate-600">
                        <Pencil className="w-4 h-4" />
                      </button>
                      <button onClick={() => setDeleteId(j.id)}
                        className="btn-ghost btn-icon btn-sm text-red-600">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </>
                  )}
                </div>
              </div>
            ))}
            <div className="card py-2 px-4">
              <Pagination page={page} totalPages={Math.ceil(filtered.length / PER_PAGE)}
                onPage={setPage} total={filtered.length} perPage={PER_PAGE} />
            </div>
          </>
        )}
      </div>

      {/* Modal Cetak Massal */}
      <Modal open={cetakMassalOpen} onClose={() => setCetakMassalOpen(false)}
        title="Cetak Dokumen Massal" size="sm"
        footer={
          <>
            <button onClick={() => setCetakMassalOpen(false)} className="btn-secondary">Batal</button>
            <button onClick={handleDownloadZip} className="btn-primary"
              disabled={!cetakTanggal || (!cetakMode.daftarHadir && !cetakMode.beritaAcara) || downloadingZip}>
              {downloadingZip ? <Spinner size="sm" /> : <PackageOpen className="w-4 h-4" />}
              {downloadingZip ? 'Membuat ZIP...' : 'Download ZIP'}
            </button>
          </>
        }
      >
        <div className="space-y-4">
          <p className="text-sm text-slate-500">
            Pilih tanggal dan jenis dokumen. Semua jadwal pada tanggal tersebut akan dicetak sekaligus dalam satu file.
          </p>
          <div>
            <label className="label">Tanggal Ujian</label>
            <select value={cetakTanggal} onChange={e => setCetakTanggal(e.target.value)} className="select w-full">
              {tanggalList.length === 0 && <option value="">-- Belum ada jadwal --</option>}
              {tanggalList.map(t => (
                <option key={t} value={t}>{formatDate(t)}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Jenis Dokumen</label>
            <div className="flex gap-4">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={cetakMode.daftarHadir}
                  onChange={e => setCetakMode(prev => ({ ...prev, daftarHadir: e.target.checked }))}
                  className="accent-brand-600 w-4 h-4" />
                <span className="text-sm text-slate-700">Daftar Hadir</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={cetakMode.beritaAcara}
                  onChange={e => setCetakMode(prev => ({ ...prev, beritaAcara: e.target.checked }))}
                  className="accent-brand-600 w-4 h-4" />
                <span className="text-sm text-slate-700">Berita Acara</span>
              </label>
            </div>
            {!cetakMode.daftarHadir && !cetakMode.beritaAcara && (
              <p className="mt-1.5 text-xs text-red-500">Pilih minimal satu jenis dokumen.</p>
            )}
          </div>
          {cetakTanggal && (
            <div className="bg-slate-50 rounded-xl px-4 py-3 text-sm text-slate-600">
              Akan mencetak{' '}
              <strong>{jadwal.filter(j => j.tanggal.slice(0, 10) === cetakTanggal).length} jadwal</strong>
              {' '}pada <strong>{formatDate(cetakTanggal)}</strong>
            </div>
          )}
        </div>
      </Modal>

      {/* Modal Tambah/Edit */}
      <Modal open={modalOpen} onClose={() => setModalOpen(false)}
        title={editData?.id ? 'Edit Jadwal' : 'Tambah Jadwal Baru'}
        footer={
          <>
            <button onClick={() => setModalOpen(false)} className="btn-secondary" disabled={saving}>Batal</button>
            <button form="jadwal-form" type="submit" className="btn-primary" disabled={saving}>
              {saving ? <Spinner size="sm" /> : (editData?.id ? 'Simpan' : 'Tambah')}
            </button>
          </>
        }
      >
        <form id="jadwal-form" onSubmit={handleSave} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Tanggal *</label>
              <input name="tanggal" type="date" className="input" required defaultValue={editData?.tanggal?.slice(0, 10)} />
            </div>
            <div>
              <label className="label">Sesi</label>
              <select name="sesi" className="select" defaultValue={editData?.sesi ?? 1}>
                {[1, 2, 3, 4].map(s => <option key={s} value={s}>Sesi {s}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="label">Mata Pelajaran *</label>
            <select name="mapel_id" className="select" required
              defaultValue={editData?.mapel_id ?? ''}
              onChange={e => setSelectedMapelId(e.target.value)}>
              <option value="">Pilih Mapel</option>
              {mapelList.filter((m, idx, arr) => arr.findIndex(x => x.nama === m.nama) === idx)
                .map(m => <option key={m.id} value={m.id}>{m.nama}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Kelas *</label>
            <select name="kelas" className="select" required defaultValue={editData?.kelas ?? ''}>
              <option value="">Pilih Kelas</option>
              {kelasList.map(k => <option key={k.id} value={k.nama}>{k.nama}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="label">Jam Mulai *</label>
              <input name="jam_mulai" type="time" className="input" required defaultValue={editData?.jam_mulai} />
            </div>
            <div>
              <label className="label">Jam Selesai *</label>
              <input name="jam_selesai" type="time" className="input" required defaultValue={editData?.jam_selesai} />
            </div>
            <div>
              <label className="label">Durasi (menit)</label>
              <input name="durasi" type="number" className="input" defaultValue={editData?.durasi ?? 90} min={15} max={240} />
            </div>
          </div>
          <div>
            <label className="label">Pengawas</label>
            {(() => {
              const guruMapel = selectedMapelId ? mapelList.find(m => m.id === selectedMapelId)?.guru_id : null
              const available = guruList.filter(g => g.username !== guruMapel)
              const excluded = guruList.find(g => g.username === guruMapel)
              return (
                <>
                  <select name="pengawas" className="select" defaultValue={editData?.pengawas ?? ''}>
                    <option value="">- Pilih Pengawas -</option>
                    {available.map(p => (
                      <option key={p.username} value={p.username}>{p.nama}</option>
                    ))}
                  </select>
                  {excluded && selectedMapelId && (
                    <p className="mt-1.5 text-xs text-amber-600">
                      ⚠ <strong>{excluded.nama}</strong> tidak tersedia karena mengampu mata pelajaran ini.
                    </p>
                  )}
                  {available.length === 0 && (
                    <p className="mt-1.5 text-xs text-slate-400">Tidak ada guru yang tersedia sebagai pengawas.</p>
                  )}
                </>
              )
            })()}
          </div>
        </form>
      </Modal>

      <Confirm open={!!deleteId} onClose={() => setDeleteId(null)} onConfirm={handleDelete}
        title="Hapus Jadwal" message="Jadwal ini akan dihapus permanen. Lanjutkan?"
        confirmLabel="Ya, Hapus" loading={saving} />

      {/* Modal Soal Belum Siap */}
      <Modal
        open={soalBelumSiapOpen}
        onClose={() => setSoalBelumSiapOpen(false)}
        title="Soal Belum Siap"
        size="md"
        footer={
          <button onClick={() => setSoalBelumSiapOpen(false)} className="btn-primary">Tutup</button>
        }
      >
        {(() => {
          const belumSiap = jadwal.filter(j => j.status_soal !== 'DISETUJUI')
          if (belumSiap.length === 0) {
            return (
              <div className="flex flex-col items-center justify-center py-10 text-center gap-3">
                <div className="w-14 h-14 rounded-full bg-emerald-100 flex items-center justify-center">
                  <CheckCircle className="w-7 h-7 text-emerald-600" />
                </div>
                <p className="font-semibold text-slate-700">Semua soal sudah siap!</p>
                <p className="text-sm text-slate-400">Seluruh jadwal ujian telah memiliki soal yang disetujui.</p>
              </div>
            )
          }

          // Kelompokkan per status
          const grouped: Record<string, Jadwal[]> = {}
          for (const j of belumSiap) {
            const key = j.status_soal ?? 'BELUM_ADA'
            if (!grouped[key]) grouped[key] = []
            grouped[key].push(j)
          }

          const urutan = ['BELUM_ADA', 'DITOLAK', 'DRAFT', 'MENUNGGU']
          const labelGrup: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
            BELUM_ADA: { label: 'Belum Ada Soal', color: 'text-slate-600', icon: <HelpCircle className="w-4 h-4" /> },
            DITOLAK:   { label: 'Soal Ditolak',   color: 'text-red-600',   icon: <XCircle className="w-4 h-4" /> },
            DRAFT:     { label: 'Masih Draft',     color: 'text-blue-600',  icon: <AlertCircle className="w-4 h-4" /> },
            MENUNGGU:  { label: 'Menunggu Persetujuan', color: 'text-amber-600', icon: <Clock className="w-4 h-4" /> },
          }

          return (
            <div className="space-y-5">
              <p className="text-sm text-slate-500">
                Ditemukan <strong className="text-slate-700">{belumSiap.length} jadwal</strong> dengan soal yang belum siap.
              </p>
              {urutan.filter(k => grouped[k]?.length).map(key => {
                const meta = labelGrup[key]
                const items = grouped[key]
                return (
                  <div key={key}>
                    <div className={`flex items-center gap-2 font-semibold text-sm mb-2 ${meta.color}`}>
                      {meta.icon} {meta.label} ({items.length})
                    </div>
                    <div className="space-y-1.5">
                      {items.map(j => (
                        <div key={j.id} className="flex items-center justify-between gap-3 px-3 py-2.5 rounded-xl bg-slate-50 border border-slate-100">
                          <div>
                            <span className="font-medium text-slate-800 text-sm">{j.nama_mapel ?? j.mapel_id}</span>
                            <span className="mx-2 text-slate-300">·</span>
                            <span className="text-xs text-slate-500">Kelas {j.kelas}</span>
                          </div>
                          <div className="text-xs text-slate-400 shrink-0">{formatDate(j.tanggal)}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
          )
        })()}
      </Modal>
    </div>
  )
}
