// Pembuat file "Unduh Massal Hasil Ujian" (Excel / ZIP) untuk admin.
// Data berasal dari /api/admin/nilai/ekspor. Seluruh pembuatan file terjadi di
// BROWSER admin; tidak ada yang diunggah ke mana pun.
import { formatDateTime } from '@/lib/utils'
import { tanggalFile } from '@/lib/ekspor-akun'

type ModulXLSX = typeof import('xlsx')

export interface KomboNilai {
  kelas: string
  mapel_nama: string
  jumlah: number
}

export interface BarisNilaiEkspor {
  nis: string
  nama_siswa: string
  kelas: string
  nama_mapel: string
  benar: number | null
  total: number | null
  nilai: number | null
  grade: string | null
  kkm: number | null
  timestamp: string | null
  essay_aktif: boolean
  nilai_essay: number | null
  nilai_total: number | null
  dirilis: boolean
  nilai_edit: number | null
  grade_edit: string | null
}

export interface HasilKombo {
  kombo: KomboNilai
  baris: BarisNilaiEkspor[]
}

// ── Perhitungan nilai ────────────────────────────────────────────────────────

/** Nilai yang berlaku: gabungan PG+Essay bila essay aktif & sudah dirilis, selain itu nilai PG. */
export function nilaiEfektif(b: BarisNilaiEkspor): number | null {
  return b.essay_aktif && b.dirilis && b.nilai_total != null ? b.nilai_total : b.nilai
}

function statusEssay(b: BarisNilaiEkspor): string {
  if (!b.essay_aktif) return '-'
  if (b.dirilis) return 'Dirilis'
  return b.nilai_essay != null ? 'Sudah dinilai (belum dirilis)' : 'Belum dinilai'
}

export function statusLulus(b: BarisNilaiEkspor): string {
  const n = nilaiEfektif(b)
  if (n == null || b.kkm == null) return '-'
  return n >= b.kkm ? 'Lulus' : 'Tidak Lulus'
}

export interface RingkasanNilai {
  jumlah: number
  rata: number | null
  tertinggi: number | null
  terendah: number | null
  lulus: number
  persenLulus: number | null
}

export function ringkasan(baris: BarisNilaiEkspor[]): RingkasanNilai {
  const angka = baris.map(nilaiEfektif).filter((n): n is number => n != null)
  const lulus = baris.filter(b => statusLulus(b) === 'Lulus').length
  return {
    jumlah: baris.length,
    rata: angka.length ? Math.round((angka.reduce((a, b) => a + b, 0) / angka.length) * 10) / 10 : null,
    tertinggi: angka.length ? Math.max(...angka) : null,
    terendah: angka.length ? Math.min(...angka) : null,
    lulus,
    persenLulus: baris.length ? Math.round((lulus / baris.length) * 100) : null,
  }
}

// ── Penamaan ─────────────────────────────────────────────────────────────────

/** Buang karakter terlarang untuk nama file/sheet (\ / : * ? " < > | [ ] dan karakter kontrol). */
export function bersihkanNama(teks: string, maks = 80): string {
  const bersih = teks
    .replace(/[\\/:*?"<>|[\]\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '')
  return (bersih || 'Tanpa nama').slice(0, maks).trim()
}

export function namaUnik(dasar: string, terpakai: Set<string>, maks: number): string {
  let nama = dasar.slice(0, maks).trim()
  let i = 2
  while (terpakai.has(nama.toLowerCase())) {
    const akhiran = ` (${i++})`
    nama = `${dasar.slice(0, maks - akhiran.length).trim()}${akhiran}`
  }
  terpakai.add(nama.toLowerCase())
  return nama
}

// ── Isi lembar ───────────────────────────────────────────────────────────────

type Sel = string | number | null
const v = (x: number | string | null | undefined): Sel => (x === null || x === undefined ? '' : x)

const JUDUL_TABEL = [
  'No', 'NIS', 'Nama Siswa', 'Nilai PG', 'Grade', 'Benar', 'Total Soal', 'KKM',
  'Nilai Essay', 'Nilai Akhir (PG+Essay)', 'Status Essay', 'Status', 'Nilai Remedial (Guru)', 'Tanggal Ujian',
]
const LEBAR_TABEL = [5, 14, 30, 9, 7, 7, 10, 6, 11, 20, 26, 13, 20, 20]

function barisSiswa(b: BarisNilaiEkspor, no: number): Sel[] {
  return [
    no, b.nis, b.nama_siswa, v(b.nilai), v(b.grade), v(b.benar), v(b.total), v(b.kkm),
    b.essay_aktif ? v(b.nilai_essay) : '-',
    v(nilaiEfektif(b)),
    statusEssay(b), statusLulus(b),
    v(b.nilai_edit),
    formatDateTime(b.timestamp),
  ]
}

function lembarKombo(XLSX: ModulXLSX, h: HasilKombo) {
  const r = ringkasan(h.baris)
  const aoa: Sel[][] = [
    ['REKAP HASIL UJIAN'],
    ['Mata Pelajaran', h.kombo.mapel_nama],
    ['Kelas', h.kombo.kelas],
    ['Diunduh', formatDateTime(new Date().toISOString())],
    [],
  ]
  if (h.baris.length === 0) {
    aoa.push(['Belum ada nilai untuk kelas dan mata pelajaran ini.'])
  } else {
    aoa.push(JUDUL_TABEL, ...h.baris.map((b, i) => barisSiswa(b, i + 1)))
    aoa.push(
      [],
      ['', '', 'Jumlah siswa', r.jumlah],
      ['', '', 'Rata-rata', v(r.rata)],
      ['', '', 'Tertinggi', v(r.tertinggi)],
      ['', '', 'Terendah', v(r.terendah)],
      ['', '', 'Lulus', `${r.lulus} dari ${r.jumlah} (${r.persenLulus ?? 0}%)`],
    )
  }
  const ws = XLSX.utils.aoa_to_sheet(aoa)
  ws['!cols'] = LEBAR_TABEL.map(wch => ({ wch }))
  return ws
}

function lembarRingkasan(XLSX: ModulXLSX, hasil: HasilKombo[]) {
  const aoa: Sel[][] = [
    ['RINGKASAN HASIL UJIAN'],
    ['Diunduh', formatDateTime(new Date().toISOString())],
    [],
    ['No', 'Kelas', 'Mata Pelajaran', 'Jumlah Siswa', 'Rata-rata', 'Tertinggi', 'Terendah', 'Lulus', '% Lulus'],
    ...hasil.map((h, i) => {
      const r = ringkasan(h.baris)
      return [i + 1, h.kombo.kelas, h.kombo.mapel_nama, r.jumlah, v(r.rata), v(r.tertinggi), v(r.terendah), r.lulus, r.persenLulus == null ? '' : `${r.persenLulus}%`]
    }),
  ]
  const ws = XLSX.utils.aoa_to_sheet(aoa)
  ws['!cols'] = [5, 12, 30, 13, 10, 10, 10, 8, 8].map(wch => ({ wch }))
  return ws
}

function lembarSemuaData(XLSX: ModulXLSX, hasil: HasilKombo[]) {
  const judul = ['No', 'Kelas', 'Mata Pelajaran', ...JUDUL_TABEL.slice(1)]
  let no = 0
  const isi = hasil.flatMap(h =>
    h.baris.map(b => {
      const s = barisSiswa(b, ++no)
      return [s[0], h.kombo.kelas, h.kombo.mapel_nama, ...s.slice(1)]
    })
  )
  const ws = XLSX.utils.aoa_to_sheet([judul, ...isi])
  ws['!cols'] = [5, 10, 26, ...LEBAR_TABEL.slice(1)].map(wch => ({ wch }))
  return ws
}

// ── Buku kerja ───────────────────────────────────────────────────────────────

function bukuGabungan(XLSX: ModulXLSX, hasil: HasilKombo[]) {
  const wb = XLSX.utils.book_new()
  const terpakai = new Set<string>()
  const tambah = (nama: string, ws: ReturnType<typeof lembarKombo>) =>
    XLSX.utils.book_append_sheet(wb, ws, namaUnik(nama, terpakai, 31))

  if (hasil.length > 1) {
    tambah('Ringkasan', lembarRingkasan(XLSX, hasil))
    tambah('Semua Data', lembarSemuaData(XLSX, hasil))
  }
  for (const h of hasil) {
    tambah(bersihkanNama(`${h.kombo.kelas} ${h.kombo.mapel_nama}`, 31), lembarKombo(XLSX, h))
  }
  return wb
}

function bukuSatuKombo(XLSX: ModulXLSX, h: HasilKombo) {
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, lembarKombo(XLSX, h), 'Nilai')
  return wb
}

// ── Unduh ────────────────────────────────────────────────────────────────────

export function picuUnduh(blob: Blob, namaFile: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = namaFile
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

/** Satu file Excel; satu sheet per kelas–mapel (+ sheet Ringkasan & Semua Data bila lebih dari satu). */
export async function unduhExcelGabungan(hasil: HasilKombo[]): Promise<string> {
  const XLSX = await import('xlsx')
  const nama = `hasil-ujian-${tanggalFile()}.xlsx`
  XLSX.writeFile(bukuGabungan(XLSX, hasil), nama)
  return nama
}

/** ZIP berisi satu file Excel per kelas–mapel, dikelompokkan per folder kelas, plus Ringkasan.xlsx. */
export async function unduhZip(hasil: HasilKombo[]): Promise<string> {
  const [XLSX, { default: JSZip }] = await Promise.all([import('xlsx'), import('jszip')])
  const zip = new JSZip()
  const tulis = (wb: ReturnType<typeof bukuSatuKombo>) =>
    XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer

  const terpakai = new Set<string>()
  for (const h of hasil) {
    const folder = bersihkanNama(h.kombo.kelas, 40)
    const dasar = bersihkanNama(h.kombo.mapel_nama, 80)
    const nama = namaUnik(`${folder}/${dasar}`, terpakai, 200)
    zip.file(`${nama}.xlsx`, tulis(bukuSatuKombo(XLSX, h)))
  }
  const wbRingkasan = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wbRingkasan, lembarRingkasan(XLSX, hasil), 'Ringkasan')
  zip.file('Ringkasan.xlsx', tulis(wbRingkasan))

  const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' })
  const nama = `hasil-ujian-${tanggalFile()}.zip`
  picuUnduh(blob, nama)
  return nama
}
