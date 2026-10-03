// src/lib/impor-soal/template-docx.ts
//
// ── PEMBUAT TEMPLATE WORD (.docx) UNTUK IMPOR SOAL ─────────────────────────
// Dibuat langsung dari XML OOXML + JSZip (JSZip sudah jadi dependensi repo),
// jadi TIDAK ada paket npm baru dan tidak butuh koneksi server — template
// dibuat di browser guru saat tombol "Unduh Template" ditekan.
//
// DESAIN TEMPLATE
//  • SATU TABEL PER NOMOR SOAL. Dengan begitu soal, semua opsi, kunci, dan
//    gambar-gambarnya selalu satu kesatuan (tidak terpisah antar halaman:
//    baris dikunci `cantSplit` dan paragraf diberi `keepNext`).
//  • Tabel dua kolom: kolom kiri = label (No / Soal / A / B / … / Kunci),
//    kolom kanan = isian guru. Parser (docx-parser.ts) membaca LABEL di
//    kolom kiri, bukan posisi baris, jadi guru boleh menghapus baris
//    "Pembahasan" atau menyalin-tempel tabel tanpa merusak impor.
//  • Gambar: guru cukup klik di dalam sel kanan lalu Sisipkan ▸ Gambar.
//    Berlaku untuk sel Soal maupun sel Opsi A–E (opsi bergambar).
//  • Petunjuk di label (baris kedua, abu-abu kecil) TIDAK ikut terbaca —
//    parser hanya memakai baris pertama label.
//  • Tabel dengan "No" berisi kata CONTOH dilewati saat impor, begitu juga
//    tabel yang seluruh isiannya kosong.

import JSZip from 'jszip'

export type JenisTemplate = 'pg' | 'essay'

export interface OpsiTemplate {
  jenis: JenisTemplate
  /** Jumlah tabel soal kosong yang disediakan (1–100). */
  jumlah: number
  /** Jumlah opsi PG: 4 (A–D) atau 5 (A–E). Diabaikan untuk essay. */
  jumlahOpsi?: 4 | 5
}

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'

// Lebar halaman A4 dengan margin 2 cm: 11906 - 2*1134 = 9638 twips.
const LEBAR_TABEL = 9638
const LEBAR_LABEL = 1900
const LEBAR_ISI = LEBAR_TABEL - LEBAR_LABEL

const WARNA_LABEL = 'E8EEF7'
const WARNA_HEADER = '1E4F9C'
const WARNA_PETUNJUK = '6B7280'

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

interface RunOpt { b?: boolean; i?: boolean; color?: string; sz?: number }

function run(text: string, o: RunOpt = {}): string {
  const rpr =
    (o.b ? '<w:b/>' : '') +
    (o.i ? '<w:i/>' : '') +
    (o.color ? `<w:color w:val="${o.color}"/>` : '') +
    (o.sz ? `<w:sz w:val="${o.sz}"/><w:szCs w:val="${o.sz}"/>` : '')
  return `<w:r>${rpr ? `<w:rPr>${rpr}</w:rPr>` : ''}<w:t xml:space="preserve">${esc(text)}</w:t></w:r>`
}

interface ParaOpt { keepNext?: boolean; jc?: 'left' | 'center'; after?: number; before?: number }

function para(runs: string, o: ParaOpt = {}): string {
  const ppr =
    (o.keepNext ? '<w:keepNext/>' : '') +
    (o.before !== undefined || o.after !== undefined
      ? `<w:spacing w:before="${o.before ?? 0}" w:after="${o.after ?? 0}"/>`
      : '') +
    (o.jc ? `<w:jc w:val="${o.jc}"/>` : '')
  return `<w:p>${ppr ? `<w:pPr>${ppr}</w:pPr>` : ''}${runs}</w:p>`
}

const BORDER =
  '<w:tblBorders>' +
  ['top', 'left', 'bottom', 'right', 'insideH', 'insideV']
    .map(s => `<w:${s} w:val="single" w:sz="6" w:space="0" w:color="7F8FA6"/>`)
    .join('') +
  '</w:tblBorders>'

function tc(width: number, content: string, shade?: string): string {
  return (
    `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/>` +
    (shade ? `<w:shd w:val="clear" w:color="auto" w:fill="${shade}"/>` : '') +
    `</w:tcPr>${content}</w:tc>`
  )
}

interface BarisSpec {
  label: string
  petunjuk?: string
  /** Isi awal sel kanan (kosong untuk tabel soal sungguhan). */
  isi?: string[]
  /** Ini baris terakhir tabel — paragraf tidak diberi keepNext. */
  terakhir?: boolean
}

function baris(b: BarisSpec): string {
  const kn = !b.terakhir
  const kiri =
    para(run(b.label, { b: true }), { keepNext: kn, before: 40, after: b.petunjuk ? 0 : 40 }) +
    (b.petunjuk
      ? para(run(b.petunjuk, { i: true, color: WARNA_PETUNJUK, sz: 16 }), { keepNext: kn, after: 40 })
      : '')
  const isiParas = (b.isi && b.isi.length ? b.isi : ['']).map(t =>
    para(t ? run(t) : '', { keepNext: kn, before: 40, after: 40 })
  )
  return (
    '<w:tr><w:trPr><w:cantSplit/></w:trPr>' +
    tc(LEBAR_LABEL, kiri, WARNA_LABEL) +
    tc(LEBAR_ISI, isiParas.join('')) +
    '</w:tr>'
  )
}

function tabel(rows: string[]): string {
  return (
    '<w:tbl><w:tblPr>' +
    `<w:tblW w:w="${LEBAR_TABEL}" w:type="dxa"/>` +
    BORDER +
    '<w:tblLayout w:type="fixed"/>' +
    '<w:tblCellMar><w:left w:w="100" w:type="dxa"/><w:right w:w="100" w:type="dxa"/></w:tblCellMar>' +
    '</w:tblPr>' +
    `<w:tblGrid><w:gridCol w:w="${LEBAR_LABEL}"/><w:gridCol w:w="${LEBAR_ISI}"/></w:tblGrid>` +
    rows.join('') +
    '</w:tbl>'
  )
}

// Paragraf pemisah antar tabel. WAJIB ada: dua tabel yang berdempetan tanpa
// paragraf di antaranya akan digabung oleh Word menjadi satu tabel.
const PEMISAH = para('', { after: 120 })

function barisSoalPg(nomor: string, jumlahOpsi: 4 | 5, contoh?: ReturnType<typeof dataContohPg>): string[] {
  const huruf = ['A', 'B', 'C', 'D', 'E'].slice(0, jumlahOpsi)
  const rows: BarisSpec[] = [
    { label: 'No', isi: [nomor] },
    {
      label: 'Soal',
      petunjuk: 'ketik soal; gambar: Sisipkan ▸ Gambar',
      isi: contoh?.soal,
    },
    ...huruf.map(h => ({
      label: h,
      petunjuk: h === 'A' ? 'teks atau gambar' : undefined,
      isi: contoh?.opsi[h],
    })),
    { label: 'Kunci', petunjuk: `huruf ${huruf[0]}–${huruf[huruf.length - 1]}`, isi: contoh ? [contoh.kunci] : undefined },
    { label: 'Pembahasan', petunjuk: 'boleh dikosongkan', isi: contoh?.pembahasan },
  ]
  rows[rows.length - 1].terakhir = true
  return rows.map(baris)
}

function dataContohPg(jumlahOpsi: 4 | 5) {
  const opsi: Record<string, string[]> = {
    A: ['Gambar atau teks opsi A. (Untuk opsi bergambar: hapus teks ini lalu Sisipkan ▸ Gambar.)'],
    B: ['Isi opsi B'],
    C: ['Isi opsi C'],
    D: ['Isi opsi D'],
  }
  if (jumlahOpsi === 5) opsi.E = ['Isi opsi E']
  return {
    soal: [
      'Tuliskan pertanyaan di sini. Jika ada gambar/diagram, klik di sel ini lalu Sisipkan ▸ Gambar.',
      'Soal boleh terdiri dari beberapa paragraf.',
    ],
    opsi,
    kunci: 'B',
    pembahasan: ['Penjelasan singkat jawaban (opsional).'],
  }
}

function barisSoalEssay(nomor: string, contoh?: { soal: string[]; bobot: string }): string[] {
  const rows: BarisSpec[] = [
    { label: 'No', isi: [nomor] },
    { label: 'Soal', petunjuk: 'ketik soal; gambar: Sisipkan ▸ Gambar', isi: contoh?.soal },
    {
      label: 'Bobot',
      petunjuk: 'skor maksimal soal ini, angka > 0',
      isi: contoh ? [contoh.bobot] : undefined,
      terakhir: true,
    },
  ]
  return rows.map(baris)
}

function blokJudul(teks: string, sub: string): string {
  return (
    para(run(teks, { b: true, sz: 32, color: WARNA_HEADER }), { jc: 'center', after: 40 }) +
    para(run(sub, { i: true, color: WARNA_PETUNJUK }), { jc: 'center', after: 200 })
  )
}

function blokPetunjuk(jenis: JenisTemplate, jumlahOpsi: 4 | 5): string {
  const langkahPg = [
    'Satu tabel = satu nomor soal. Isi sel di kolom kanan; jangan mengubah tulisan di kolom kiri (No, Soal, A, B, …, Kunci).',
    `Opsi jawaban: A–${jumlahOpsi === 5 ? 'E' : 'D'}. Kolom Kunci diisi satu huruf saja (contoh: B).`,
    'Soal atau opsi bergambar: klik di dalam sel yang dimaksud, lalu Sisipkan ▸ Gambar. Satu sel = satu gambar (teks dan gambar boleh bersama).',
    'Butuh lebih banyak soal? Blok satu tabel beserta garis kosong di bawahnya, Salin (Ctrl+C), lalu Tempel (Ctrl+V) di bagian bawah dokumen.',
    'Baris Pembahasan boleh dikosongkan atau dihapus. Tabel yang seluruhnya kosong akan dilewati saat impor.',
  ]
  const langkahEssay = [
    'Satu tabel = satu nomor soal. Isi sel di kolom kanan; jangan mengubah tulisan di kolom kiri (No, Soal, Bobot).',
    'Bobot = skor maksimal soal tersebut (angka lebih dari 0, mis. 10 atau 20). Total bobot dipakai sebagai patokan penilaian essay.',
    'Soal bergambar: klik di dalam sel Soal, lalu Sisipkan ▸ Gambar. Satu soal = satu gambar (teks dan gambar boleh bersama).',
    'Butuh lebih banyak soal? Blok satu tabel beserta garis kosong di bawahnya, Salin (Ctrl+C), lalu Tempel (Ctrl+V) di bagian bawah dokumen.',
    'Tabel yang seluruhnya kosong akan dilewati saat impor.',
  ]
  const umum = [
    'Gunakan gambar berformat PNG atau JPG (maks. 2 MB per gambar). Gambar hasil tempel dari program lain kadang berformat EMF/WMF dan tidak bisa dibaca — simpan dulu sebagai PNG, lalu sisipkan lewat menu Gambar.',
    'Simpan file sebagai .docx (bukan .doc), lalu unggah di menu Impor dari Word.',
  ]
  const semua = [...(jenis === 'pg' ? langkahPg : langkahEssay), ...umum]
  return (
    para(run('Petunjuk pengisian', { b: true, sz: 24 }), { after: 80 }) +
    semua.map((t, i) => para(run(`${i + 1}. `, { b: true }) + run(t), { after: 60 })).join('') +
    para('', { after: 120 })
  )
}

function dokumen(opsi: OpsiTemplate): string {
  const jumlah = Math.max(1, Math.min(100, Math.floor(opsi.jumlah) || 10))
  const jumlahOpsi: 4 | 5 = opsi.jumlahOpsi === 5 ? 5 : 4
  const isPg = opsi.jenis === 'pg'

  const body: string[] = []
  body.push(
    blokJudul(
      isPg ? 'TEMPLATE IMPOR SOAL PILIHAN GANDA' : 'TEMPLATE IMPOR SOAL ESSAY',
      'SmartExam CBT — isi tabel di bawah, simpan, lalu impor melalui menu Buat Soal'
    )
  )
  body.push(blokPetunjuk(opsi.jenis, jumlahOpsi))

  // Contoh pengisian — kata "CONTOH" di kolom No membuat parser melewatinya.
  body.push(para(run('Contoh pengisian (tabel ini tidak akan diimpor):', { b: true }), { after: 80, keepNext: true }))
  body.push(
    tabel(
      isPg
        ? barisSoalPg('CONTOH', jumlahOpsi, dataContohPg(jumlahOpsi))
        : barisSoalEssay('CONTOH', {
            soal: ['Jelaskan proses terjadinya hujan. Boleh disertai gambar siklus air (Sisipkan ▸ Gambar).'],
            bobot: '20',
          })
    )
  )
  body.push(PEMISAH)
  body.push(para(run('DAFTAR SOAL', { b: true, sz: 26, color: WARNA_HEADER }), { before: 240, after: 120, keepNext: true }))

  for (let n = 1; n <= jumlah; n++) {
    body.push(tabel(isPg ? barisSoalPg(String(n), jumlahOpsi) : barisSoalEssay(String(n))))
    body.push(PEMISAH)
  }

  const sect =
    '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/>' +
    '<w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="567" w:footer="567" w:gutter="0"/></w:sectPr>'

  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    `<w:document xmlns:w="${W_NS}"><w:body>${body.join('')}${sect}</w:body></w:document>`
  )
}

const STYLES =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  `<w:styles xmlns:w="${W_NS}">` +
  '<w:docDefaults><w:rPrDefault><w:rPr>' +
  '<w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:eastAsia="Times New Roman" w:cs="Times New Roman"/>' +
  '<w:sz w:val="24"/><w:szCs w:val="24"/><w:lang w:val="id-ID"/>' +
  '</w:rPr></w:rPrDefault>' +
  '<w:pPrDefault><w:pPr><w:spacing w:after="0" w:line="259" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>' +
  '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>' +
  '</w:styles>'

const CONTENT_TYPES =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
  '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
  '<Default Extension="xml" ContentType="application/xml"/>' +
  '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
  '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
  '</Types>'

const ROOT_RELS =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
  '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
  '</Relationships>'

const DOC_RELS =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
  '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
  '</Relationships>'

/** Membuat file template .docx sebagai Blob (untuk diunduh di browser). */
export async function buatTemplateDocx(opsi: OpsiTemplate): Promise<Blob> {
  const zip = new JSZip()
  zip.file('[Content_Types].xml', CONTENT_TYPES)
  zip.file('_rels/.rels', ROOT_RELS)
  zip.file('word/document.xml', dokumen(opsi))
  zip.file('word/styles.xml', STYLES)
  zip.file('word/_rels/document.xml.rels', DOC_RELS)
  return zip.generateAsync({
    type: 'blob',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    compression: 'DEFLATE',
  })
}

/** Versi Buffer/Uint8Array — dipakai untuk pengujian di Node. */
export async function buatTemplateDocxBytes(opsi: OpsiTemplate): Promise<Uint8Array> {
  const zip = new JSZip()
  zip.file('[Content_Types].xml', CONTENT_TYPES)
  zip.file('_rels/.rels', ROOT_RELS)
  zip.file('word/document.xml', dokumen(opsi))
  zip.file('word/styles.xml', STYLES)
  zip.file('word/_rels/document.xml.rels', DOC_RELS)
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })
}

export function namaFileTemplate(jenis: JenisTemplate): string {
  return jenis === 'pg' ? 'Template-Impor-Soal-Pilihan-Ganda.docx' : 'Template-Impor-Soal-Essay.docx'
}
