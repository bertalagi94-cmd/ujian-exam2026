// Ekspor naskah soal (PG & Essay) ke PDF dan Word (.docx) dengan kop sekolah.
//
// Dibuat 100% di BROWSER (jsPDF + docx), sama seperti Ekspor Akun dan PDF
// Kesiapan Ujian: tidak ada soal yang diunggah ke server lagi, dan tidak ada
// route API baru. Data soal diambil dari endpoint guru yang sudah ada.
//
// PDF memakai font DejaVu Serif (public/fonts) karena font bawaan jsPDF tidak
// punya simbol matematika/sains (√ ≤ ≥ → ² π dst.) yang dipakai lewat
// PaletSimbol. Word memakai Times New Roman; Word otomatis mencari font
// cadangan untuk simbol.
import type { Document as DocxDocument } from 'docx'

// ── Tipe ────────────────────────────────────────────────────────────────────
export interface SoalPgEkspor {
  teks: string
  opsi_a?: string | null
  opsi_b?: string | null
  opsi_c?: string | null
  opsi_d?: string | null
  opsi_e?: string | null
  kunci?: string | null
  jumlah_opsi?: number | null
  gambar_url?: string | null
  gambar_pertanyaan?: string | null
  gambar_opsi_a?: string | null
  gambar_opsi_b?: string | null
  gambar_opsi_c?: string | null
  gambar_opsi_d?: string | null
  gambar_opsi_e?: string | null
}

export interface SoalEssayEkspor {
  teks: string
  gambar_url?: string | null
  bobot_maks?: number | null
  urutan?: number | null
}

export interface OpsiEksporSoal {
  jenis: 'PG' | 'ESSAY'
  namaMapel: string
  namaKelas: string
  namaSekolah?: string
  alamat?: string
  npsn?: string
  tahunAjaran?: string
  logoUrl?: string
  namaGuru?: string
  durasiMenit?: number | null
  soalPg?: SoalPgEkspor[]
  soalEssay?: SoalEssayEkspor[]
  /** Hanya PG: tambahkan halaman Kunci Jawaban di akhir. */
  sertakanKunci?: boolean
}

/** Gambar yang sudah dinormalisasi ke PNG (piksel asli sudah dikecilkan). */
export interface AsetGambar {
  dataUrl: string
  bytes: Uint8Array
  w: number
  h: number
}

export interface AsetEkspor {
  logo: AsetGambar | null
  gambar: Record<string, AsetGambar>
}

export interface FontPdf {
  normal: string // base64 TTF
  bold: string
  italic: string
}

// ── Util umum ───────────────────────────────────────────────────────────────
const LABEL_OPSI = ['A', 'B', 'C', 'D', 'E'] as const

function bersih(s: string | null | undefined): string {
  return String(s ?? '').replace(/\r\n?/g, '\n').replace(/\t/g, '    ').trim()
}

function jumlahOpsiSoal(s: SoalPgEkspor): number {
  const n = Number(s.jumlah_opsi)
  if (n >= 2 && n <= 5) return n
  // cadangan: hitung dari opsi yang terisi
  let terisi = 0
  LABEL_OPSI.forEach((l, i) => {
    const k = `opsi_${l.toLowerCase()}` as keyof SoalPgEkspor
    if (bersih(s[k] as string) || bersih(s[`gambar_opsi_${l.toLowerCase()}` as keyof SoalPgEkspor] as string)) terisi = i + 1
  })
  return Math.max(terisi, 2)
}

function gambarPertanyaan(s: SoalPgEkspor | SoalEssayEkspor): string {
  const x = s as SoalPgEkspor
  return bersih(x.gambar_pertanyaan) || bersih(x.gambar_url)
}

function gambarOpsi(s: SoalPgEkspor, label: string): string {
  return bersih(s[`gambar_opsi_${label.toLowerCase()}` as keyof SoalPgEkspor] as string)
}

function teksOpsi(s: SoalPgEkspor, label: string): string {
  return bersih(s[`opsi_${label.toLowerCase()}` as keyof SoalPgEkspor] as string)
}

export function namaFileSoal(o: OpsiEksporSoal, ext: 'pdf' | 'docx'): string {
  const aman = (t: string) => t.replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40)
  const jenis = o.jenis === 'PG' ? 'PG' : 'Essay'
  return `Soal-${jenis}-${aman(o.namaMapel) || 'Mapel'}-Kelas-${aman(o.namaKelas) || 'X'}.${ext}`
}

function judulNaskah(o: OpsiEksporSoal): string {
  return o.jenis === 'PG' ? 'NASKAH SOAL PILIHAN GANDA' : 'NASKAH SOAL ESSAY'
}

function petunjuk(o: OpsiEksporSoal): string {
  return o.jenis === 'PG'
    ? 'Petunjuk: Pilihlah satu jawaban yang paling benar dengan memberi tanda silang (X) pada huruf A, B, C, D, atau E.'
    : 'Petunjuk: Jawablah pertanyaan berikut dengan jelas, tepat, dan lengkap.'
}

function jumlahSoal(o: OpsiEksporSoal): number {
  return o.jenis === 'PG' ? (o.soalPg?.length ?? 0) : (o.soalEssay?.length ?? 0)
}

function barisIdentitas(o: OpsiEksporSoal): [string, string][] {
  const r: [string, string][] = [
    ['Mata Pelajaran', o.namaMapel || '-'],
    ['Kelas', o.namaKelas || '-'],
  ]
  if (o.namaGuru) r.push(['Guru Pengampu', o.namaGuru])
  r.push(['Jumlah Soal', String(jumlahSoal(o))])
  if (o.durasiMenit && o.durasiMenit > 0) r.push(['Waktu', `${o.durasiMenit} menit`])
  return r
}

function barisKop(o: OpsiEksporSoal): { nama: string; sub: string[] } {
  const sub: string[] = []
  if (o.npsn) sub.push(`NPSN: ${o.npsn}`)
  if (o.alamat) sub.push(o.alamat)
  return { nama: (o.namaSekolah || 'NAMA SEKOLAH').toUpperCase(), sub }
}

// ── Pemuatan aset (browser) ─────────────────────────────────────────────────
const MAKS_PIKSEL = 900

/** Unduh gambar, kecilkan, dan ubah ke PNG (menangani webp/svg/gif juga). */
export async function muatGambar(url: string): Promise<AsetGambar | null> {
  try {
    const resp = await fetch(url)
    if (!resp.ok) return null
    const blob = await resp.blob()
    if (!blob.size) return null
    const objUrl = URL.createObjectURL(blob)
    try {
      const img = await new Promise<HTMLImageElement>((res, rej) => {
        const im = new Image()
        im.onload = () => res(im)
        im.onerror = () => rej(new Error('gambar rusak'))
        im.src = objUrl
      })
      let w = img.naturalWidth || img.width
      let h = img.naturalHeight || img.height
      if (!w || !h) return null
      const skala = Math.min(1, MAKS_PIKSEL / Math.max(w, h))
      w = Math.max(1, Math.round(w * skala))
      h = Math.max(1, Math.round(h * skala))
      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext('2d')
      if (!ctx) return null
      ctx.fillStyle = '#ffffff' // latar putih: PNG transparan tidak jadi hitam di PDF
      ctx.fillRect(0, 0, w, h)
      ctx.drawImage(img, 0, 0, w, h)
      const dataUrl = canvas.toDataURL('image/png')
      const b64 = dataUrl.split(',')[1] ?? ''
      const bin = atob(b64)
      const bytes = new Uint8Array(bin.length)
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
      return { dataUrl, bytes, w, h }
    } finally {
      URL.revokeObjectURL(objUrl)
    }
  } catch {
    return null // gambar gagal dimuat: soal tetap dicetak tanpa gambar itu
  }
}

export async function siapkanAset(o: OpsiEksporSoal): Promise<AsetEkspor> {
  const urls = new Set<string>()
  if (o.jenis === 'PG') {
    for (const s of o.soalPg ?? []) {
      const gp = gambarPertanyaan(s); if (gp) urls.add(gp)
      for (const l of LABEL_OPSI) { const g = gambarOpsi(s, l); if (g) urls.add(g) }
    }
  } else {
    for (const s of o.soalEssay ?? []) { const gp = gambarPertanyaan(s); if (gp) urls.add(gp) }
  }
  const daftar = Array.from(urls)
  const hasil = await Promise.all(daftar.map(u => muatGambar(u)))
  const gambar: Record<string, AsetGambar> = {}
  daftar.forEach((u, i) => { const h = hasil[i]; if (h) gambar[u] = h })
  const logo = o.logoUrl ? await muatGambar(o.logoUrl) : null
  return { logo, gambar }
}

async function ambilFontBase64(path: string): Promise<string> {
  const resp = await fetch(path)
  if (!resp.ok) throw new Error('Font PDF tidak ditemukan')
  const buf = new Uint8Array(await resp.arrayBuffer())
  let s = ''
  const CH = 0x8000
  for (let i = 0; i < buf.length; i += CH) s += String.fromCharCode(...buf.subarray(i, i + CH))
  return btoa(s)
}

export async function muatFontPdf(): Promise<FontPdf> {
  const [normal, bold, italic] = await Promise.all([
    ambilFontBase64('/fonts/DejaVuSerif.ttf'),
    ambilFontBase64('/fonts/DejaVuSerif-Bold.ttf'),
    ambilFontBase64('/fonts/DejaVuSerif-Italic.ttf'),
  ])
  return { normal, bold, italic }
}

function simpanBlob(blob: Blob, nama: string) {
  const a = document.createElement('a')
  const url = URL.createObjectURL(blob)
  a.href = url
  a.download = nama
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

// ═══════════════════════════════════════════════════════════════════════════
// PDF
// ═══════════════════════════════════════════════════════════════════════════
export async function bangunPdf(o: OpsiEksporSoal, aset: AsetEkspor, font: FontPdf) {
  const { jsPDF } = await import('jspdf')
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })

  doc.addFileToVFS('DejaVuSerif.ttf', font.normal)
  doc.addFont('DejaVuSerif.ttf', 'DV', 'normal')
  doc.addFileToVFS('DejaVuSerif-Bold.ttf', font.bold)
  doc.addFont('DejaVuSerif-Bold.ttf', 'DV', 'bold')
  doc.addFileToVFS('DejaVuSerif-Italic.ttf', font.italic)
  doc.addFont('DejaVuSerif-Italic.ttf', 'DV', 'italic')

  const PW = 210, PH = 297
  const lm = 20, rm = 20
  const w = PW - lm - rm
  const topLanjutan = 24
  const bawah = PH - 20
  const FS = 10.5
  const LH = FS * 0.3528 * 1.4 // tinggi baris (mm)
  let y = 18

  const setFont = (gaya: 'normal' | 'bold' | 'italic', ukuran = FS) => {
    doc.setFont('DV', gaya)
    doc.setFontSize(ukuran)
  }
  const halamanBaru = () => { doc.addPage(); y = topLanjutan }
  const pastikan = (tinggi: number) => { if (y + tinggi > bawah) halamanBaru() }

  // ── Kop ────────────────────────────────────────────────────────────────
  const kop = barisKop(o)
  const logoMm = 22
  if (aset.logo) {
    try { doc.addImage(aset.logo.dataUrl, 'PNG', lm, y - 2, logoMm, logoMm) } catch { /* lewati logo */ }
  }
  const cx = lm + w / 2
  setFont('bold', 15)
  doc.setTextColor(15, 23, 42)
  const namaBaris = doc.splitTextToSize(kop.nama, w - (aset.logo ? logoMm * 2 + 4 : 0)) as string[]
  let ky = y + 4
  for (const b of namaBaris) { doc.text(b, cx, ky, { align: 'center' }); ky += 6.2 }
  setFont('normal', 9)
  doc.setTextColor(51, 65, 85)
  for (const s of kop.sub) {
    for (const b of doc.splitTextToSize(s, w - logoMm * 2 - 4) as string[]) {
      doc.text(b, cx, ky, { align: 'center' }); ky += 4.2
    }
  }
  y = Math.max(ky, y + logoMm) + 2.5
  doc.setDrawColor(15, 23, 42)
  doc.setLineWidth(0.9); doc.line(lm, y, lm + w, y)
  doc.setLineWidth(0.25); doc.line(lm, y + 1.3, lm + w, y + 1.3)
  y += 7

  // ── Judul ──────────────────────────────────────────────────────────────
  setFont('bold', 12)
  doc.setTextColor(15, 23, 42)
  doc.text(judulNaskah(o), cx, y, { align: 'center' })
  y += 5.5
  if (o.tahunAjaran) {
    setFont('normal', 10)
    doc.text(`TAHUN PELAJARAN ${o.tahunAjaran}`, cx, y, { align: 'center' })
    y += 5.5
  }
  y += 2

  // ── Kotak identitas (Mata Pelajaran, Kelas, dst.) ─────────────────────
  const ident = barisIdentitas(o)
  const baris = Math.ceil(ident.length / 2)
  const rowH = 6.4
  const boxH = baris * rowH + 3
  doc.setDrawColor(100, 116, 139)
  doc.setLineWidth(0.3)
  doc.rect(lm, y, w, boxH)
  setFont('normal', 10)
  ident.forEach(([label, nilai], i) => {
    const col = i % 2
    const row = Math.floor(i / 2)
    const x0 = lm + 3 + col * (w / 2)
    const yy = y + 5 + row * rowH
    doc.setFont('DV', 'normal'); doc.setTextColor(71, 85, 105)
    doc.text(label, x0, yy)
    doc.text(':', x0 + 33, yy)
    doc.setFont('DV', 'bold'); doc.setTextColor(15, 23, 42)
    const sisa = w / 2 - 33 - 8
    const potong = doc.splitTextToSize(nilai, sisa) as string[]
    doc.text(potong[0] ?? '', x0 + 36, yy)
  })
  y += boxH + 5

  setFont('italic', 9.5)
  doc.setTextColor(51, 65, 85)
  for (const b of doc.splitTextToSize(petunjuk(o), w) as string[]) { doc.text(b, lm, y); y += LH }
  y += 3
  doc.setTextColor(0, 0, 0)

  // ── Helper konten ──────────────────────────────────────────────────────
  const tulisTeks = (teks: string, x: number, lebar: number, gaya: 'normal' | 'bold' = 'normal') => {
    setFont(gaya)
    doc.setTextColor(0, 0, 0)
    for (const para of teks.split('\n')) {
      const lines = (para === '' ? [''] : doc.splitTextToSize(para, lebar)) as string[]
      for (const ln of lines) { pastikan(LH); doc.text(ln, x, y + 3.2); y += LH }
    }
  }
  const tinggiTeks = (teks: string, lebar: number): number => {
    setFont('normal')
    let n = 0
    for (const para of teks.split('\n')) n += para === '' ? 1 : (doc.splitTextToSize(para, lebar) as string[]).length
    return n * LH
  }
  const gambarMm = (a: AsetGambar, maksW: number, maksH: number) => {
    let gw = Math.min(maksW, (a.w / 96) * 25.4)
    let gh = (gw * a.h) / a.w
    if (gh > maksH) { gh = maksH; gw = (gh * a.w) / a.h }
    return { gw, gh }
  }
  const tulisGambar = (url: string, x: number, maksW: number, maksH = 70) => {
    const a = aset.gambar[url]
    if (!a) return
    const { gw, gh } = gambarMm(a, maksW, maksH)
    pastikan(gh + 2)
    try { doc.addImage(a.dataUrl, 'PNG', x, y + 1, gw, gh) } catch { return }
    y += gh + 3
  }

  const xNo = lm
  const xIsi = lm + 8

  if (o.jenis === 'PG') {
    const daftar = o.soalPg ?? []
    daftar.forEach((s, i) => {
      const teks = bersih(s.teks)
      const gp = gambarPertanyaan(s)
      const n = jumlahOpsiSoal(s)
      // jaga agar pertanyaan tidak terpisah dari opsi pertamanya
      const pertamaH = tinggiTeks(`A. ${teksOpsi(s, 'A')}`, w - 16)
      pastikan(Math.min(tinggiTeks(teks, w - 8), 40) + pertamaH + 2)
      setFont('normal'); doc.setTextColor(0, 0, 0)
      doc.text(`${i + 1}.`, xNo, y + 3.2)
      tulisTeks(teks, xIsi, w - 8)
      if (gp) tulisGambar(gp, xIsi, w - 8)
      for (let k = 0; k < n; k++) {
        const L = LABEL_OPSI[k]
        const t = teksOpsi(s, L)
        const g = gambarOpsi(s, L)
        pastikan(LH + (g ? 12 : 0))
        setFont('normal'); doc.setTextColor(0, 0, 0)
        doc.text(`${L}.`, xIsi, y + 3.2)
        if (t) tulisTeks(t, xIsi + 7, w - 15)
        else if (!g) y += LH
        if (g) tulisGambar(g, xIsi + 7, w - 15, 45)
      }
      y += 2.5
    })
  } else {
    const daftar = o.soalEssay ?? []
    daftar.forEach((s, i) => {
      const teks = bersih(s.teks)
      const gp = gambarPertanyaan(s)
      pastikan(Math.min(tinggiTeks(teks, w - 8), 40) + 2)
      setFont('normal'); doc.setTextColor(0, 0, 0)
      doc.text(`${i + 1}.`, xNo, y + 3.2)
      tulisTeks(teks, xIsi, w - 8)
      if (gp) tulisGambar(gp, xIsi, w - 8)
      if (s.bobot_maks) {
        pastikan(LH)
        setFont('italic', 9); doc.setTextColor(100, 116, 139)
        doc.text(`[Skor maksimal: ${s.bobot_maks}]`, xIsi, y + 3.2)
        y += LH
        doc.setTextColor(0, 0, 0)
      }
      y += 3.5
    })
  }

  if (jumlahSoal(o) === 0) {
    setFont('italic'); doc.setTextColor(100, 116, 139)
    doc.text('(Belum ada soal pada paket ini)', xIsi, y + 3.2)
    y += LH
  }

  // ── Kunci jawaban (PG, opsional) ──────────────────────────────────────
  if (o.jenis === 'PG' && o.sertakanKunci && (o.soalPg?.length ?? 0) > 0) {
    halamanBaru()
    setFont('bold', 12); doc.setTextColor(15, 23, 42)
    doc.text('KUNCI JAWABAN', cx, y + 3, { align: 'center' })
    y += 6
    setFont('normal', 10); doc.setTextColor(71, 85, 105)
    doc.text(`${o.namaMapel} · Kelas ${o.namaKelas}`, cx, y + 3, { align: 'center' })
    y += 9
    const kolom = 5
    const lebarKol = w / kolom
    const daftar = o.soalPg ?? []
    const perKol = Math.ceil(daftar.length / kolom)
    daftar.forEach((s, i) => {
      const col = Math.floor(i / perKol)
      const row = i % perKol
      const yy = y + row * 6.2
      if (yy > bawah) return
      const xx = lm + col * lebarKol
      doc.setFont('DV', 'normal'); doc.setFontSize(10.5); doc.setTextColor(0, 0, 0)
      doc.text(`${i + 1}.`, xx, yy + 3.2)
      doc.setFont('DV', 'bold')
      doc.text(String(s.kunci ?? '-').toUpperCase(), xx + 10, yy + 3.2)
    })
  }

  // ── Header halaman lanjutan + footer semua halaman ────────────────────
  const total = doc.getNumberOfPages()
  for (let p = 1; p <= total; p++) {
    doc.setPage(p)
    if (p > 1) {
      doc.setFont('DV', 'normal'); doc.setFontSize(8.5); doc.setTextColor(100, 116, 139)
      doc.text(`${o.namaMapel} · Kelas ${o.namaKelas}`, lm, 14)
      doc.text((o.namaSekolah || '').toUpperCase(), lm + w, 14, { align: 'right' })
      doc.setDrawColor(203, 213, 225); doc.setLineWidth(0.25)
      doc.line(lm, 16, lm + w, 16)
    }
    doc.setDrawColor(203, 213, 225); doc.setLineWidth(0.25)
    doc.line(lm, PH - 15, lm + w, PH - 15)
    doc.setFont('DV', 'normal'); doc.setFontSize(8.5); doc.setTextColor(100, 116, 139)
    doc.text(judulNaskah(o), lm, PH - 10.5)
    doc.text(`Halaman ${p} dari ${total}`, lm + w, PH - 10.5, { align: 'right' })
  }
  return doc
}

export async function unduhSoalPdf(o: OpsiEksporSoal): Promise<string> {
  const [aset, font] = await Promise.all([siapkanAset(o), muatFontPdf()])
  const doc = await bangunPdf(o, aset, font)
  const nama = namaFileSoal(o, 'pdf')
  simpanBlob(doc.output('blob'), nama)
  return nama
}

// ═══════════════════════════════════════════════════════════════════════════
// WORD (.docx)
// ═══════════════════════════════════════════════════════════════════════════
export async function bangunDocx(o: OpsiEksporSoal, aset: AsetEkspor): Promise<DocxDocument> {
  const D = await import('docx')
  const {
    Document, Paragraph, TextRun, Table, TableRow, TableCell, WidthType, BorderStyle, AlignmentType,
    ImageRun, Footer, Header, PageNumber, VerticalAlign, TableLayoutType,
  } = D

  const FONT = 'Times New Roman'
  const SZ = 24 // 12pt (half-point)
  const CONTENT_W = 9638 // A4 (11906) − margin 2×1134 twips ≈ 17 cm... dipakai sebagai lebar tabel
  const tanpaBorder = {
    top: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
    bottom: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
    left: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
    right: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
  }

  const run = (text: string, extra: Partial<ConstructorParameters<typeof TextRun>[0]> = {}) =>
    new TextRun({ text, font: FONT, size: SZ, ...(extra as object) })

  // teks banyak baris → satu paragraf dengan <w:br/> di antara baris
  const runsBanyakBaris = (teks: string, extra: object = {}) => {
    const out: InstanceType<typeof TextRun>[] = []
    teks.split('\n').forEach((ln, i) => out.push(new TextRun({ text: ln, font: FONT, size: SZ, break: i === 0 ? 0 : 1, ...extra })))
    return out
  }

  const gambarRun = (url: string, maksPx: number) => {
    const a = aset.gambar[url]
    if (!a) return null
    let gw = Math.min(maksPx, a.w)
    let gh = Math.round((gw * a.h) / a.w)
    if (gh > 300) { gh = 300; gw = Math.round((gh * a.w) / a.h) }
    return new ImageRun({ type: 'png', data: a.bytes, transformation: { width: gw, height: gh } })
  }

  // ── Kop ──
  const kop = barisKop(o)
  const kolLogo = 1700
  const kolTeks = CONTENT_W - kolLogo * 2
  const logoRun = aset.logo
    ? new ImageRun({ type: 'png', data: aset.logo.bytes, transformation: { width: 82, height: 82 } })
    : null
  const teksKop: InstanceType<typeof Paragraph>[] = [
    new Paragraph({
      alignment: AlignmentType.CENTER, spacing: { after: 40 },
      children: [new TextRun({ text: kop.nama, font: FONT, size: 30, bold: true })],
    }),
    ...kop.sub.map(s => new Paragraph({
      alignment: AlignmentType.CENTER, spacing: { after: 0 },
      children: [new TextRun({ text: s, font: FONT, size: 19 })],
    })),
  ]
  const tabelKop = new Table({
    width: { size: CONTENT_W, type: WidthType.DXA },
    columnWidths: [kolLogo, kolTeks, kolLogo],
    layout: TableLayoutType.FIXED,
    borders: { ...tanpaBorder, insideHorizontal: tanpaBorder.top, insideVertical: tanpaBorder.top },
    rows: [new TableRow({
      children: [
        new TableCell({
          width: { size: kolLogo, type: WidthType.DXA }, borders: tanpaBorder, verticalAlign: VerticalAlign.CENTER,
          children: [new Paragraph({ alignment: AlignmentType.LEFT, children: logoRun ? [logoRun] : [] })],
        }),
        new TableCell({
          width: { size: kolTeks, type: WidthType.DXA }, borders: tanpaBorder, verticalAlign: VerticalAlign.CENTER,
          children: teksKop,
        }),
        new TableCell({
          width: { size: kolLogo, type: WidthType.DXA }, borders: tanpaBorder,
          children: [new Paragraph({ children: [] })],
        }),
      ],
    })],
  })

  // garis ganda di bawah kop
  const garisKop = new Paragraph({
    spacing: { before: 60, after: 160 },
    border: {
      bottom: { style: BorderStyle.DOUBLE, size: 6, color: '0F172A', space: 1 },
    },
    children: [],
  })

  // ── Judul ──
  const judul: InstanceType<typeof Paragraph>[] = [
    new Paragraph({
      alignment: AlignmentType.CENTER, spacing: { after: 40 },
      children: [new TextRun({ text: judulNaskah(o), font: FONT, size: 26, bold: true })],
    }),
  ]
  if (o.tahunAjaran) {
    judul.push(new Paragraph({
      alignment: AlignmentType.CENTER, spacing: { after: 160 },
      children: [new TextRun({ text: `TAHUN PELAJARAN ${o.tahunAjaran}`, font: FONT, size: SZ })],
    }))
  }

  // ── Kotak identitas ──
  const ident = barisIdentitas(o)
  const kolLabel = 2100
  const kolNilai = Math.floor((CONTENT_W - 2 * kolLabel - 2 * 300) / 2)
  const kolTitik = 300
  const border1 = { style: BorderStyle.SINGLE, size: 4, color: '64748B' }
  const barisIdent: InstanceType<typeof TableRow>[] = []
  for (let i = 0; i < ident.length; i += 2) {
    const pasangan = [ident[i], ident[i + 1]]
    const sel: InstanceType<typeof TableCell>[] = []
    pasangan.forEach(p => {
      const [label, nilai] = p ?? ['', '']
      sel.push(
        new TableCell({
          width: { size: kolLabel, type: WidthType.DXA },
          children: [new Paragraph({ spacing: { before: 50, after: 50 }, children: [run(label, { size: 22 })] })],
        }),
        new TableCell({
          width: { size: kolTitik, type: WidthType.DXA },
          children: [new Paragraph({ spacing: { before: 50, after: 50 }, children: [run(p ? ':' : '', { size: 22 })] })],
        }),
        new TableCell({
          width: { size: kolNilai, type: WidthType.DXA },
          children: [new Paragraph({ spacing: { before: 50, after: 50 }, children: [run(nilai, { size: 22, bold: true })] })],
        }),
      )
    })
    barisIdent.push(new TableRow({ children: sel }))
  }
  const tabelIdent = new Table({
    width: { size: CONTENT_W, type: WidthType.DXA },
    columnWidths: [kolLabel, kolTitik, kolNilai, kolLabel, kolTitik, kolNilai],
    layout: TableLayoutType.FIXED,
    borders: {
      top: border1, bottom: border1, left: border1, right: border1,
      insideHorizontal: tanpaBorder.top, insideVertical: tanpaBorder.top,
    },
    rows: barisIdent,
  })

  const infoPetunjuk = new Paragraph({
    spacing: { before: 160, after: 200 },
    children: [run(petunjuk(o), { italics: true, size: 21, color: '334155' })],
  })

  // ── Soal ──
  const isi: (InstanceType<typeof Paragraph> | InstanceType<typeof Table>)[] = []
  const NO_INDENT = 454 // 0,8 cm
  const OPSI_INDENT = NO_INDENT + 454

  if (o.jenis === 'PG') {
    ;(o.soalPg ?? []).forEach((s, i) => {
      const n = jumlahOpsiSoal(s)
      const gp = gambarPertanyaan(s)
      isi.push(new Paragraph({
        keepNext: true,
        spacing: { before: 140, after: 40 },
        indent: { left: NO_INDENT, hanging: NO_INDENT },
        tabStops: [{ type: 'left', position: NO_INDENT }],
        children: [run(`${i + 1}.\t`), ...runsBanyakBaris(bersih(s.teks))],
      }))
      const gr = gp ? gambarRun(gp, 380) : null
      if (gr) isi.push(new Paragraph({ keepNext: true, indent: { left: NO_INDENT }, spacing: { after: 60 }, children: [gr] }))
      for (let k = 0; k < n; k++) {
        const L = LABEL_OPSI[k]
        const t = teksOpsi(s, L)
        const g = gambarOpsi(s, L)
        const go = g ? gambarRun(g, 240) : null
        const children = [run(`${L}.\t`), ...(t ? runsBanyakBaris(t) : [])]
        isi.push(new Paragraph({
          keepNext: k < n - 1,
          keepLines: true,
          spacing: { after: 20 },
          indent: { left: OPSI_INDENT, hanging: 454 },
          tabStops: [{ type: 'left', position: OPSI_INDENT }],
          children,
        }))
        if (go) isi.push(new Paragraph({ keepNext: k < n - 1, indent: { left: OPSI_INDENT }, spacing: { after: 40 }, children: [go] }))
      }
    })
  } else {
    ;(o.soalEssay ?? []).forEach((s, i) => {
      const gp = gambarPertanyaan(s)
      isi.push(new Paragraph({
        spacing: { before: 160, after: 60 },
        indent: { left: NO_INDENT, hanging: NO_INDENT },
        tabStops: [{ type: 'left', position: NO_INDENT }],
        children: [run(`${i + 1}.\t`), ...runsBanyakBaris(bersih(s.teks))],
      }))
      const gr = gp ? gambarRun(gp, 420) : null
      if (gr) isi.push(new Paragraph({ indent: { left: NO_INDENT }, spacing: { after: 60 }, children: [gr] }))
      if (s.bobot_maks) {
        isi.push(new Paragraph({
          indent: { left: NO_INDENT }, spacing: { after: 100 },
          children: [run(`[Skor maksimal: ${s.bobot_maks}]`, { italics: true, size: 19, color: '64748B' })],
        }))
      }
    })
  }
  if (jumlahSoal(o) === 0) {
    isi.push(new Paragraph({ children: [run('(Belum ada soal pada paket ini)', { italics: true, color: '64748B' })] }))
  }

  // ── Kunci jawaban ──
  const kunci: (InstanceType<typeof Paragraph> | InstanceType<typeof Table>)[] = []
  if (o.jenis === 'PG' && o.sertakanKunci && (o.soalPg?.length ?? 0) > 0) {
    kunci.push(
      new Paragraph({
        pageBreakBefore: true, alignment: AlignmentType.CENTER, spacing: { after: 40 },
        children: [new TextRun({ text: 'KUNCI JAWABAN', font: FONT, size: 26, bold: true })],
      }),
      new Paragraph({
        alignment: AlignmentType.CENTER, spacing: { after: 200 },
        children: [run(`${o.namaMapel} · Kelas ${o.namaKelas}`, { size: 22, color: '475569' })],
      }),
    )
    const daftar = o.soalPg ?? []
    const KOL = 5
    const perKol = Math.ceil(daftar.length / KOL)
    const lebarKol = Math.floor(CONTENT_W / KOL)
    const border = { style: BorderStyle.SINGLE, size: 4, color: 'CBD5E1' }
    const bs = { top: border, bottom: border, left: border, right: border }
    const rows: InstanceType<typeof TableRow>[] = []
    for (let r = 0; r < perKol; r++) {
      const cells: InstanceType<typeof TableCell>[] = []
      for (let c = 0; c < KOL; c++) {
        const idx = c * perKol + r
        const s = daftar[idx]
        cells.push(new TableCell({
          width: { size: lebarKol, type: WidthType.DXA }, borders: bs,
          children: [new Paragraph({
            spacing: { before: 40, after: 40 }, alignment: AlignmentType.CENTER,
            children: s
              ? [run(`${idx + 1}.  `), run(String(s.kunci ?? '-').toUpperCase(), { bold: true })]
              : [],
          })],
        }))
      }
      rows.push(new TableRow({ children: cells }))
    }
    kunci.push(new Table({
      width: { size: lebarKol * KOL, type: WidthType.DXA },
      columnWidths: Array(KOL).fill(lebarKol),
      layout: TableLayoutType.FIXED,
      rows,
    }))
  }

  const footer = new Footer({
    children: [new Paragraph({
      border: { top: { style: BorderStyle.SINGLE, size: 4, color: 'CBD5E1', space: 4 } },
      tabStops: [{ type: 'right', position: CONTENT_W }],
      children: [
        new TextRun({ text: judulNaskah(o), font: FONT, size: 17, color: '64748B' }),
        new TextRun({ text: '\tHalaman ', font: FONT, size: 17, color: '64748B' }),
        new TextRun({ children: [PageNumber.CURRENT], font: FONT, size: 17, color: '64748B' }),
        new TextRun({ text: ' dari ', font: FONT, size: 17, color: '64748B' }),
        new TextRun({ children: [PageNumber.TOTAL_PAGES], font: FONT, size: 17, color: '64748B' }),
      ],
    })],
  })
  // Header kecil hanya di halaman 2 dst. (halaman pertama sudah punya kop).
  const headerLanjutan = new Header({
    children: [new Paragraph({
      border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: 'CBD5E1', space: 4 } },
      tabStops: [{ type: 'right', position: CONTENT_W }],
      children: [
        new TextRun({ text: `${o.namaMapel} · Kelas ${o.namaKelas}`, font: FONT, size: 17, color: '64748B' }),
        new TextRun({ text: `\t${(o.namaSekolah || '').toUpperCase()}`, font: FONT, size: 17, color: '64748B' }),
      ],
    })],
  })
  const headerKosong = new Header({ children: [new Paragraph({ children: [] })] })

  return new Document({
    creator: o.namaGuru || 'SmartExam',
    title: `${judulNaskah(o)} - ${o.namaMapel} - Kelas ${o.namaKelas}`,
    styles: { default: { document: { run: { font: FONT, size: SZ } } } },
    sections: [{
      properties: {
        titlePage: true,
        page: {
          size: { width: 11906, height: 16838 }, // A4
          margin: { top: 1134, bottom: 1134, left: 1134, right: 1134 },
        },
      },
      headers: { default: headerLanjutan, first: headerKosong },
      footers: { default: footer, first: footer },
      children: [tabelKop, garisKop, ...judul, tabelIdent, infoPetunjuk, ...isi, ...kunci],
    }],
  })
}

export async function unduhSoalWord(o: OpsiEksporSoal): Promise<string> {
  const aset = await siapkanAset(o)
  const doc = await bangunDocx(o, aset)
  const { Packer } = await import('docx')
  const blob = await Packer.toBlob(doc)
  const nama = namaFileSoal(o, 'docx')
  simpanBlob(blob, nama)
  return nama
}
