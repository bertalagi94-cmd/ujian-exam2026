// Pembuat PDF "Unduh Massal Hasil Ujian" (admin). Dibuat 100% di BROWSER dengan
// jsPDF (pola sama seperti PDF Kesiapan Ujian & Cetak Massal), tanpa unggah ke server.
//
// Dua bentuk:
//  - unduhPdfGabungan : satu PDF; halaman Ringkasan (bila >1 kelas–mapel), lalu tiap
//                       kelas–mapel mulai di halaman baru.
//  - unduhZipPdf      : ZIP berisi satu PDF per kelas–mapel, per folder kelas, + Ringkasan.pdf.
import type { jsPDF } from 'jspdf'
import {
  nilaiEfektif, ringkasan, statusLulus, bersihkanNama, namaUnik, picuUnduh,
  type HasilKombo,
} from '@/lib/ekspor-nilai'
import { tanggalFile } from '@/lib/ekspor-akun'

export interface KopPdf {
  namaSekolah: string
  alamat: string
  npsn: string
  tahunAjaran: string
  logo: { data: string; format: 'PNG' | 'JPEG' } | null
  dicetakOleh: string
}

// ── Kop ──────────────────────────────────────────────────────────────────────

async function logoKeDataUrl(url: string): Promise<KopPdf['logo']> {
  try {
    const resp = await fetch(url)
    if (!resp.ok) return null
    const blob = await resp.blob()
    const dataUrl = await new Promise<string>((res, rej) => {
      const r = new FileReader()
      r.onload = () => res(String(r.result))
      r.onerror = () => rej(new Error('baca logo gagal'))
      r.readAsDataURL(blob)
    })
    const jenis = /^data:image\/(png|jpe?g)/i.exec(dataUrl)?.[1]?.toLowerCase()
    if (!jenis) return null // webp/svg tidak didukung jsPDF: lewati logo saja
    return { data: dataUrl, format: jenis === 'png' ? 'PNG' : 'JPEG' }
  } catch {
    return null
  }
}

/** Siapkan data kop dari pengaturan sekolah (/api/public/pengaturan). Logo dimuat sekali saja. */
export async function muatKop(p: Record<string, string>, dicetakOleh = ''): Promise<KopPdf> {
  return {
    namaSekolah: p.namaSekolah || '',
    alamat: p.alamatSekolah || '',
    npsn: p.npsnSekolah || '',
    tahunAjaran: p.tahunAjaran || '',
    logo: p.logoUrl ? await logoKeDataUrl(p.logoUrl) : null,
    dicetakOleh,
  }
}

// ── Utilitas gambar ──────────────────────────────────────────────────────────

const LM = 15
const W = 180
const HAL_W = 210
const HAL_H = 297
const BAWAH = HAL_H - 18 // sisakan ruang untuk nomor halaman
const TINGGI_BARIS = 6.2

type Warna = [number, number, number]
interface Kolom { judul: string; lebar: number; rata: 'left' | 'center' | 'right' }

/** Helvetica bawaan jsPDF hanya mendukung Latin-1: karakter lain diganti agar tidak jadi sandi acak. */
const aman = (s: unknown) => String(s ?? '').replace(/[^\u0020-\u00ff]/g, '?')

function tglCetak(d: Date): string {
  try {
    return new Intl.DateTimeFormat('id-ID', {
      day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Makassar',
    }).format(d).replace(/\./g, ':') + ' WITA'
  } catch {
    return d.toLocaleString('id-ID')
  }
}

/** Potong teks dengan "…" bila lebih lebar dari kolom. */
function muat(doc: jsPDF, teks: string, lebar: number): string {
  const t = aman(teks)
  if (doc.getTextWidth(t) <= lebar) return t
  let s = t
  while (s.length > 1 && doc.getTextWidth(s + '...') > lebar) s = s.slice(0, -1)
  return s.trimEnd() + '...'
}

function kopSekolah(doc: jsPDF, kop: KopPdf, subjudul: string): number {
  let y = 15
  if (kop.logo) {
    try { doc.addImage(kop.logo.data, kop.logo.format, LM, y - 2, 16, 16) } catch { /* lewati logo */ }
  }
  doc.setFont('helvetica', 'bold'); doc.setFontSize(13); doc.setTextColor(15, 23, 42)
  doc.text(aman(kop.namaSekolah || 'SMARTEXAM').toUpperCase(), HAL_W / 2, y + 4, { align: 'center' })
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(71, 85, 105)
  doc.text(aman(subjudul), HAL_W / 2, y + 9.5, { align: 'center' })
  const baris2 = [kop.alamat, kop.npsn ? `NPSN ${kop.npsn}` : ''].filter(Boolean).join(' | ')
  if (baris2) {
    doc.setFontSize(8)
    doc.text(muat(doc, baris2, W - 36), HAL_W / 2, y + 13.5, { align: 'center' })
  }
  y += 18
  doc.setDrawColor(15, 23, 42)
  doc.setLineWidth(0.7); doc.line(LM, y, LM + W, y)
  doc.setLineWidth(0.2); doc.line(LM, y + 1.2, LM + W, y + 1.2)
  return y + 8
}

function barisInfo(doc: jsPDF, y: number, pasangan: [string, string][]): number {
  doc.setFontSize(9.5)
  for (const [label, isi] of pasangan) {
    doc.setFont('helvetica', 'normal'); doc.setTextColor(71, 85, 105)
    doc.text(label, LM, y)
    doc.setFont('helvetica', 'bold'); doc.setTextColor(15, 23, 42)
    doc.text(`: ${muat(doc, isi, W - 32)}`, LM + 28, y)
    y += 5
  }
  return y + 2
}

function judulTabel(doc: jsPDF, y: number, kolom: Kolom[]): number {
  doc.setFillColor(226, 232, 240)
  doc.rect(LM, y, W, TINGGI_BARIS + 0.8, 'F')
  doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5); doc.setTextColor(15, 23, 42)
  let x = LM
  for (const k of kolom) {
    const tx = k.rata === 'center' ? x + k.lebar / 2 : k.rata === 'right' ? x + k.lebar - 2 : x + 2
    doc.text(k.judul, tx, y + 4.6, { align: k.rata })
    x += k.lebar
  }
  return y + TINGGI_BARIS + 0.8
}

/**
 * Tabel dengan judul kolom yang diulang di tiap halaman. `lanjutan` dipanggil saat
 * perlu halaman baru: ia menambah halaman dan mengembalikan posisi y awal.
 */
function gambarTabel(
  doc: jsPDF, y: number, kolom: Kolom[], baris: string[][],
  lanjutan: () => number,
  warna?: (b: number, k: number) => Warna | undefined,
): number {
  y = judulTabel(doc, y, kolom)
  doc.setFontSize(9)
  baris.forEach((r, bi) => {
    if (y + TINGGI_BARIS > BAWAH) {
      y = judulTabel(doc, lanjutan(), kolom)
      doc.setFontSize(9)
    }
    if (bi % 2 === 1) {
      doc.setFillColor(248, 250, 252)
      doc.rect(LM, y, W, TINGGI_BARIS, 'F')
    }
    let x = LM
    kolom.forEach((k, ki) => {
      const w = warna?.(bi, ki)
      doc.setFont('helvetica', w ? 'bold' : 'normal')
      doc.setTextColor(...(w ?? [30, 41, 59]))
      const tx = k.rata === 'center' ? x + k.lebar / 2 : k.rata === 'right' ? x + k.lebar - 2 : x + 2
      doc.text(muat(doc, r[ki] ?? '', k.lebar - 3), tx, y + 4.3, { align: k.rata })
      x += k.lebar
    })
    doc.setDrawColor(226, 232, 240); doc.setLineWidth(0.1)
    doc.line(LM, y + TINGGI_BARIS, LM + W, y + TINGGI_BARIS)
    y += TINGGI_BARIS
  })
  return y
}

function nomorHalaman(doc: jsPDF, kop: KopPdf, sekarang: Date) {
  const n = doc.getNumberOfPages()
  for (let i = 1; i <= n; i++) {
    doc.setPage(i)
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(100, 116, 139)
    const kiri = kop.dicetakOleh ? `Dicetak oleh ${kop.dicetakOleh} - ${tglCetak(sekarang)}` : `Dicetak ${tglCetak(sekarang)}`
    doc.text(muat(doc, kiri, W - 40), LM, HAL_H - 10)
    doc.text(`Halaman ${i} dari ${n}`, LM + W, HAL_H - 10, { align: 'right' })
  }
}

// ── Isi halaman ──────────────────────────────────────────────────────────────

const KOLOM_SISWA: Kolom[] = [
  { judul: 'No', lebar: 8, rata: 'center' },
  { judul: 'NIS', lebar: 23, rata: 'left' },
  { judul: 'Nama Siswa', lebar: 54, rata: 'left' },
  { judul: 'Nilai PG', lebar: 14, rata: 'center' },
  { judul: 'Grade PG', lebar: 15, rata: 'center' },
  { judul: 'Essay', lebar: 14, rata: 'center' },
  { judul: 'Nilai Akhir', lebar: 17, rata: 'center' },
  { judul: 'KKM', lebar: 11, rata: 'center' },
  { judul: 'Status', lebar: 24, rata: 'center' },
]

const teksAngka = (n: number | null | undefined) => (n == null ? '-' : String(n))

function halamanKombo(doc: jsPDF, kop: KopPdf, h: HasilKombo) {
  const r = ringkasan(h.baris)
  let y = kopSekolah(doc, kop, 'Rekap Hasil Ujian')

  doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.setTextColor(15, 23, 42)
  doc.text('REKAP HASIL UJIAN', HAL_W / 2, y, { align: 'center' })
  y += 7
  const info: [string, string][] = [
    ['Mata Pelajaran', h.kombo.mapel_nama],
    ['Kelas', h.kombo.kelas],
  ]
  if (kop.tahunAjaran) info.push(['Tahun Ajaran', kop.tahunAjaran])
  info.push(['Jumlah Siswa', String(r.jumlah)])
  y = barisInfo(doc, y, info)

  const baris = h.baris.map((b, i) => [
    String(i + 1), b.nis, b.nama_siswa,
    teksAngka(b.nilai), b.grade ?? '-',
    b.essay_aktif ? teksAngka(b.nilai_essay) : '-',
    teksAngka(nilaiEfektif(b)), teksAngka(b.kkm), statusLulus(b),
  ])
  const warna = (bi: number, ki: number): Warna | undefined => {
    if (ki !== 8) return undefined
    const s = baris[bi][8]
    return s === 'Lulus' ? [5, 120, 85] : s === 'Tidak Lulus' ? [185, 28, 28] : undefined
  }
  const lanjutan = () => {
    doc.addPage()
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9.5); doc.setTextColor(71, 85, 105)
    doc.text(muat(doc, `${h.kombo.mapel_nama} - Kelas ${h.kombo.kelas} (lanjutan)`, W), LM, 15)
    return 20
  }
  y = gambarTabel(doc, y, KOLOM_SISWA, baris, lanjutan, warna)

  // Ringkasan di bawah tabel (dijaga agar tidak terpotong antar-halaman)
  const butuh = 34
  if (y + butuh > BAWAH) y = lanjutan()
  y += 6
  const ringkas: [string, string][] = [
    ['Rata-rata', r.rata == null ? '-' : String(r.rata)],
    ['Nilai tertinggi', teksAngka(r.tertinggi)],
    ['Nilai terendah', teksAngka(r.terendah)],
    ['Lulus', `${r.lulus} dari ${r.jumlah} siswa (${r.persenLulus ?? 0}%)`],
  ]
  y = barisInfo(doc, y, ringkas)

  doc.setFont('helvetica', 'italic'); doc.setFontSize(8); doc.setTextColor(100, 116, 139)
  const catatan = [
    'Nilai Akhir = gabungan PG + Essay bila essay sudah dirilis; selain itu nilai PG. Status dihitung dari Nilai Akhir terhadap KKM.',
  ]
  const adaRemedial = h.baris.filter(b => b.nilai_edit != null).length
  if (adaRemedial > 0) catatan.push(`${adaRemedial} siswa memiliki nilai remedial dari guru; nilai remedial tidak dihitung di halaman ini (lihat unduhan Excel).`)
  for (const c of catatan) {
    for (const baris2 of doc.splitTextToSize(aman(c), W) as string[]) {
      doc.text(baris2, LM, y)
      y += 4
    }
  }
}

function halamanRingkasan(doc: jsPDF, kop: KopPdf, hasil: HasilKombo[]) {
  let y = kopSekolah(doc, kop, 'Ringkasan Hasil Ujian')
  doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.setTextColor(15, 23, 42)
  doc.text('RINGKASAN HASIL UJIAN', HAL_W / 2, y, { align: 'center' })
  y += 7
  const total = hasil.reduce((a, h) => a + h.baris.length, 0)
  const info: [string, string][] = [['Kelas - Mapel', String(hasil.length)], ['Total Data Nilai', String(total)]]
  if (kop.tahunAjaran) info.unshift(['Tahun Ajaran', kop.tahunAjaran])
  y = barisInfo(doc, y, info)

  const kolom: Kolom[] = [
    { judul: 'No', lebar: 8, rata: 'center' },
    { judul: 'Kelas', lebar: 20, rata: 'left' },
    { judul: 'Mata Pelajaran', lebar: 84, rata: 'left' },
    { judul: 'Siswa', lebar: 18, rata: 'center' },
    { judul: 'Rata-rata', lebar: 18, rata: 'center' },
    { judul: 'Lulus', lebar: 32, rata: 'center' },
  ]
  const baris = hasil.map((h, i) => {
    const r = ringkasan(h.baris)
    return [String(i + 1), h.kombo.kelas, h.kombo.mapel_nama, String(r.jumlah), r.rata == null ? '-' : String(r.rata),
      r.persenLulus == null ? '-' : `${r.lulus} (${r.persenLulus}%)`]
  })
  gambarTabel(doc, y, kolom, baris, () => {
    doc.addPage()
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9.5); doc.setTextColor(71, 85, 105)
    doc.text('Ringkasan hasil ujian (lanjutan)', LM, 15)
    return 20
  })
}

// ── Pembuat dokumen ──────────────────────────────────────────────────────────

async function dokumenBaru(): Promise<jsPDF> {
  const { jsPDF } = await import('jspdf')
  return new jsPDF({ unit: 'mm', format: 'a4' })
}

async function pdfGabungan(hasil: HasilKombo[], kop: KopPdf): Promise<jsPDF> {
  const sekarang = new Date()
  const doc = await dokumenBaru()
  let halamanTerpakai = false
  const halamanBaru = () => { if (halamanTerpakai) doc.addPage(); halamanTerpakai = true }

  if (hasil.length > 1) {
    halamanBaru()
    halamanRingkasan(doc, kop, hasil)
  }
  for (const h of hasil) {
    halamanBaru()
    halamanKombo(doc, kop, h)
  }
  nomorHalaman(doc, kop, sekarang)
  return doc
}

async function pdfSatu(h: HasilKombo, kop: KopPdf): Promise<jsPDF> {
  return pdfGabungan([h], kop)
}

/** Satu PDF: halaman Ringkasan (bila >1 kelas–mapel) lalu tiap kelas–mapel di halaman baru. */
export async function unduhPdfGabungan(hasil: HasilKombo[], kop: KopPdf): Promise<string> {
  if (hasil.length === 0) throw new Error('Tidak ada data untuk dicetak')
  const doc = await pdfGabungan(hasil, kop)
  const nama = `hasil-ujian-${tanggalFile()}.pdf`
  picuUnduh(doc.output('blob'), nama)
  return nama
}

/** ZIP berisi satu PDF per kelas–mapel (folder per kelas) + Ringkasan.pdf. */
export async function unduhZipPdf(hasil: HasilKombo[], kop: KopPdf): Promise<string> {
  if (hasil.length === 0) throw new Error('Tidak ada data untuk dicetak')
  const { default: JSZip } = await import('jszip')
  const zip = new JSZip()
  const terpakai = new Set<string>()
  for (const h of hasil) {
    const nama = namaUnik(`${bersihkanNama(h.kombo.kelas, 40)}/${bersihkanNama(h.kombo.mapel_nama, 80)}`, terpakai, 200)
    zip.file(`${nama}.pdf`, (await pdfSatu(h, kop)).output('arraybuffer'))
  }
  if (hasil.length > 1) {
    const doc = await dokumenBaru()
    halamanRingkasan(doc, kop, hasil)
    nomorHalaman(doc, kop, new Date())
    zip.file('Ringkasan.pdf', doc.output('arraybuffer'))
  }
  const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' })
  const nama = `hasil-ujian-pdf-${tanggalFile()}.zip`
  picuUnduh(blob, nama)
  return nama
}
