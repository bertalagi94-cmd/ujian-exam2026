// Ekspor DAFTAR JADWAL ujian (tabel jadwal itu sendiri) ke Excel atau PDF.
//
// Dibuat 100% di BROWSER (xlsx + jsPDF, sama seperti Cetak Massal dan Ekspor Akun),
// jadi tidak ada request baru ke server dan tidak menambah beban Vercel/Supabase.
// Data yang diekspor = baris yang sudah dimuat halaman /admin/jadwal.
import type { Jadwal } from '@/types'

const NAMA_BULAN = [
  'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember',
]

// "2026-11-16..." -> "16 November 2026". Dipotong manual (bukan new Date) supaya
// tanggal tidak bergeser sehari karena zona waktu.
function tanggalIndo(tgl: string): string {
  const [y, m, d] = String(tgl ?? '').slice(0, 10).split('-')
  const bulan = NAMA_BULAN[Number(m) - 1]
  return bulan && d && y ? `${Number(d)} ${bulan} ${y}` : String(tgl ?? '')
}

const jam = (s?: string | null) => String(s ?? '').slice(0, 5)

function durasiEssay(j: Jadwal): string {
  return j.essay_durasi_efektif ? `${j.essay_durasi_efektif} menit` : '-'
}

const LABEL_SOAL: Record<string, string> = {
  BELUM_ADA: 'Belum ada',
  DRAFT: 'Draft',
  MENUNGGU: 'Menunggu persetujuan',
  DITOLAK: 'Ditolak',
  DISETUJUI: 'Disetujui',
}

const bandingJadwal = (a: Jadwal, b: Jadwal) =>
  String(a.tanggal).slice(0, 10).localeCompare(String(b.tanggal).slice(0, 10)) ||
  (a.sesi ?? 0) - (b.sesi ?? 0) ||
  jam(a.jam_mulai).localeCompare(jam(b.jam_mulai)) ||
  String(a.kelas ?? '').localeCompare(String(b.kelas ?? ''), 'id', { numeric: true })

// Tanggal LOKAL perangkat (bukan UTC) supaya nama berkas tidak mundur sehari
// bila diekspor dini hari WITA.
const hariIniLokal = () => {
  const n = new Date()
  const dua = (v: number) => String(v).padStart(2, '0')
  return `${n.getFullYear()}-${dua(n.getMonth() + 1)}-${dua(n.getDate())}`
}

const namaBerkas = (ekstensi: string) => `Jadwal_Ujian_${hariIniLokal()}.${ekstensi}`

function unduhBlob(blob: Blob, nama: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = nama
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

// ── Excel ────────────────────────────────────────────────────────────────────
export async function eksporJadwalExcel(data: Jadwal[]): Promise<void> {
  const XLSX = await import('xlsx')
  const urut = [...data].sort(bandingJadwal)

  const baris = urut.map((j, i) => ({
    No: i + 1,
    Tanggal: tanggalIndo(j.tanggal),
    Sesi: j.sesi ?? '',
    'Jam Mulai': jam(j.jam_mulai),
    'Jam Selesai': jam(j.jam_selesai),
    'Mata Pelajaran': j.nama_mapel ?? '',
    Kelas: j.kelas ?? '',
    Pengawas: j.nama_pengawas ?? j.pengawas ?? '',
    'Durasi PG (menit)': j.durasi ?? '',
    'Durasi Essay': durasiEssay(j),
    'Status Soal': LABEL_SOAL[j.status_soal ?? ''] ?? '',
    'Status Ujian': j.status ?? '',
  }))

  const ws = XLSX.utils.json_to_sheet(baris)
  ws['!cols'] = [
    { wch: 5 }, { wch: 20 }, { wch: 6 }, { wch: 11 }, { wch: 12 }, { wch: 32 },
    { wch: 12 }, { wch: 28 }, { wch: 17 }, { wch: 14 }, { wch: 22 }, { wch: 13 },
  ]
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Jadwal')
  XLSX.writeFile(wb, namaBerkas('xlsx'))
}

// ── PDF ──────────────────────────────────────────────────────────────────────
export interface OpsiPdfJadwal {
  namaSekolah?: string
  /** Keterangan tambahan di bawah judul, mis. "Status: AKTIF". */
  subjudul?: string
}

export async function eksporJadwalPdf(data: Jadwal[], opsi: OpsiPdfJadwal = {}): Promise<void> {
  const { jsPDF } = await import('jspdf')
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'landscape' })
  const urut = [...data].sort(bandingJadwal)

  const L = 10                                   // margin kiri/kanan
  const lebar = doc.internal.pageSize.getWidth()
  const tinggi = doc.internal.pageSize.getHeight()
  const kolom: { judul: string; w: number }[] = [
    { judul: 'No', w: 10 },
    { judul: 'Tanggal', w: 36 },
    { judul: 'Sesi', w: 12 },
    { judul: 'Jam', w: 28 },
    { judul: 'Mata Pelajaran', w: 66 },
    { judul: 'Kelas', w: 24 },
    { judul: 'Pengawas', w: 62 },
    { judul: 'Durasi', w: 20 },
    { judul: 'Status', w: 19 },
  ]
  const tinggiBaris = 7

  let y = 0
  let halaman = 0

  const kepala = () => {
    halaman++
    y = 12
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(13)
    doc.text('JADWAL UJIAN', lebar / 2, y, { align: 'center' })
    y += 5.5
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9)
    if (opsi.namaSekolah) { doc.text(opsi.namaSekolah, lebar / 2, y, { align: 'center' }); y += 4.5 }
    if (opsi.subjudul) { doc.text(opsi.subjudul, lebar / 2, y, { align: 'center' }); y += 4.5 }
    y += 2
    // header tabel
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(8.5)
    doc.setFillColor(230, 233, 240)
    doc.rect(L, y, kolom.reduce((s, k) => s + k.w, 0), tinggiBaris, 'F')
    let x = L
    for (const k of kolom) {
      doc.text(k.judul, x + 1.5, y + 4.8)
      x += k.w
    }
    y += tinggiBaris
    doc.setFont('helvetica', 'normal')
  }

  const potong = (teks: string, lebarMm: number) => {
    const t = String(teks ?? '')
    if (doc.getTextWidth(t) <= lebarMm - 3) return t
    let s = t
    while (s.length > 1 && doc.getTextWidth(s + '…') > lebarMm - 3) s = s.slice(0, -1)
    return s + '…'
  }

  kepala()
  doc.setFontSize(8.5)

  urut.forEach((j, i) => {
    if (y + tinggiBaris > tinggi - 12) {
      doc.addPage()
      kepala()
      doc.setFontSize(8.5)
    }
    if (i % 2 === 1) {
      doc.setFillColor(247, 248, 251)
      doc.rect(L, y, kolom.reduce((s, k) => s + k.w, 0), tinggiBaris, 'F')
    }
    const isi = [
      String(i + 1),
      tanggalIndo(j.tanggal),
      String(j.sesi ?? ''),
      `${jam(j.jam_mulai)} - ${jam(j.jam_selesai)}`,
      j.nama_mapel ?? '',
      j.kelas ?? '',
      j.nama_pengawas ?? j.pengawas ?? '',
      j.durasi ? `${j.durasi} mnt` : '',
      j.status ?? '',
    ]
    let x = L
    isi.forEach((teks, c) => {
      doc.text(potong(teks, kolom[c].w), x + 1.5, y + 4.8)
      x += kolom[c].w
    })
    y += tinggiBaris
  })

  // Nomor halaman + tanggal cetak
  const total = doc.getNumberOfPages()
  const dicetak = `Dicetak ${tanggalIndo(hariIniLokal())}`
  for (let p = 1; p <= total; p++) {
    doc.setPage(p)
    doc.setFontSize(8)
    doc.setTextColor(120)
    doc.text(dicetak, L, tinggi - 6)
    doc.text(`Halaman ${p} dari ${total}`, lebar - L, tinggi - 6, { align: 'right' })
    doc.setTextColor(0)
  }

  unduhBlob(doc.output('blob'), namaBerkas('pdf'))
}
