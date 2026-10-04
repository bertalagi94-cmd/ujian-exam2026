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
//    Berlaku untuk sel Soal maupun sel Opsi A–E (opsi bergambar). TIDAK ada
//    tempat khusus gambar: teks soal dan gambar soal ada di sel yang sama.
//  • Warna sebagai petunjuk visual untuk guru yang kurang terbiasa:
//    BIASA/biru  = nama baris (jangan diubah), kuning = tempat mengisi,
//    oranye      = tabel CONTOH (hanya ilustrasi, tidak diimpor).
//    Warna hanya tampilan; parser tidak memakainya.
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
const LEBAR_LABEL = 2300
const LEBAR_ISI = LEBAR_TABEL - LEBAR_LABEL

const WARNA_HEADER = '1E4F9C'
const WARNA_PETUNJUK = '6B7280'

/** Skema warna tabel. Warna hanya tampilan, tidak dibaca parser. */
interface Skema {
  label: string       // latar kolom nama baris
  labelTeks: string   // warna tulisan nama baris
  hint: string        // warna petunjuk kecil di bawah nama baris
  isi: string         // latar sel tempat mengisi
  no: string          // latar sel nomor (sudah terisi, tidak perlu diubah)
  garis: string       // warna garis tabel
  garisSz: number     // tebal garis (1/8 pt)
}

const SKEMA_ISI: Skema = {
  label: '1E4F9C', labelTeks: 'FFFFFF', hint: 'DCE8FF',
  isi: 'FFF5C2', no: 'E5E7EB', garis: '7F8FA6', garisSz: 6,
}
const SKEMA_CONTOH: Skema = {
  label: 'C2410C', labelTeks: 'FFFFFF', hint: 'FFE4D1',
  isi: 'FFF4EB', no: 'FDBA8C', garis: 'F97316', garisSz: 24,
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

interface RunOpt { b?: boolean; i?: boolean; color?: string; sz?: number; shade?: string }

function run(text: string, o: RunOpt = {}): string {
  const rpr =
    (o.b ? '<w:b/>' : '') +
    (o.i ? '<w:i/>' : '') +
    (o.color ? `<w:color w:val="${o.color}"/>` : '') +
    (o.sz ? `<w:sz w:val="${o.sz}"/><w:szCs w:val="${o.sz}"/>` : '') +
    (o.shade ? `<w:shd w:val="clear" w:color="auto" w:fill="${o.shade}"/>` : '')
  return `<w:r>${rpr ? `<w:rPr>${rpr}</w:rPr>` : ''}<w:t xml:space="preserve">${esc(text)}</w:t></w:r>`
}

interface ParaOpt { keepNext?: boolean; jc?: 'left' | 'center'; after?: number; before?: number; shade?: string }

function para(runs: string, o: ParaOpt = {}): string {
  const ppr =
    (o.keepNext ? '<w:keepNext/>' : '') +
    (o.shade ? `<w:shd w:val="clear" w:color="auto" w:fill="${o.shade}"/>` : '') +
    (o.before !== undefined || o.after !== undefined
      ? `<w:spacing w:before="${o.before ?? 0}" w:after="${o.after ?? 0}"/>`
      : '') +
    (o.jc ? `<w:jc w:val="${o.jc}"/>` : '')
  return `<w:p>${ppr ? `<w:pPr>${ppr}</w:pPr>` : ''}${runs}</w:p>`
}

function borders(warna: string, sz: number): string {
  return (
    '<w:tblBorders>' +
    ['top', 'left', 'bottom', 'right', 'insideH', 'insideV']
      .map(x => `<w:${x} w:val="single" w:sz="${sz}" w:space="0" w:color="${warna}"/>`)
      .join('') +
    '</w:tblBorders>'
  )
}

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
  /** Paragraf XML siap pakai untuk sel kanan (dipakai tabel CONTOH, mis. berisi gambar). */
  isiParas?: string[]
  /** Baris nomor: sel kanan memakai warna abu-abu (sudah terisi, tidak perlu diubah). */
  nomor?: boolean
  /** Ini baris terakhir tabel — paragraf tidak diberi keepNext. */
  terakhir?: boolean
}

function baris(b: BarisSpec, sk: Skema): string {
  const kn = !b.terakhir
  // Paragraf PERTAMA di kolom kiri = nama baris (dibaca parser). Petunjuk di
  // paragraf kedua tidak dibaca parser.
  const kiri =
    para(run(b.label, { b: true, color: sk.labelTeks }), { keepNext: kn, before: 40, after: b.petunjuk ? 0 : 40 }) +
    (b.petunjuk
      ? para(run(b.petunjuk, { i: true, color: sk.hint, sz: 16 }), { keepNext: kn, after: 40 })
      : '')
  const isiParas = b.isiParas ?? (b.isi && b.isi.length ? b.isi : ['']).map(t =>
    para(t ? run(t) : '', { keepNext: kn, before: 40, after: 40 })
  )
  return (
    '<w:tr><w:trPr><w:cantSplit/></w:trPr>' +
    tc(LEBAR_LABEL, kiri, sk.label) +
    tc(LEBAR_ISI, isiParas.join(''), b.nomor ? sk.no : sk.isi) +
    '</w:tr>'
  )
}

function tabel(rows: string[], sk: Skema): string {
  return (
    '<w:tbl><w:tblPr>' +
    `<w:tblW w:w="${LEBAR_TABEL}" w:type="dxa"/>` +
    borders(sk.garis, sk.garisSz) +
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

const HINT_NO = 'nomor otomatis; kolom biru jangan diubah'
const HINT_SOAL = 'tulis soal DAN sisipkan gambarnya di sel kanan ini (Sisipkan ▸ Gambar)'

function barisSoalPg(nomor: string, jumlahOpsi: 4 | 5, contoh?: ContohPg): string[] {
  const huruf = ['A', 'B', 'C', 'D', 'E'].slice(0, jumlahOpsi)
  const rows: BarisSpec[] = [
    { label: 'No', petunjuk: HINT_NO, isi: [nomor], nomor: true },
    { label: 'Soal', petunjuk: HINT_SOAL, isiParas: contoh?.soal },
    ...huruf.map(h => ({
      label: h,
      petunjuk: h === 'A' ? 'teks atau gambar' : undefined,
      isi: contoh?.opsi[h],
    })),
    { label: 'Kunci', petunjuk: `satu huruf ${huruf[0]}–${huruf[huruf.length - 1]}`, isi: contoh ? [contoh.kunci] : undefined },
    { label: 'Pembahasan', petunjuk: 'boleh dikosongkan', isi: contoh?.pembahasan },
  ]
  rows[rows.length - 1].terakhir = true
  return rows.map(r => baris(r, contoh ? SKEMA_CONTOH : SKEMA_ISI))
}

interface ContohPg {
  soal: string[]                 // paragraf XML (teks + gambar + catatan)
  opsi: Record<string, string[]>
  kunci: string
  pembahasan: string[]
}

// Paragraf contoh: kecil dan sederhana. Catatan oranye menjelaskan bahwa teks
// dan gambar soal ditulis di SEL YANG SAMA.
function paraContoh(runs: string): string {
  return para(runs, { keepNext: true, before: 40, after: 40 })
}
const catatanContoh = (t: string) => paraContoh(run(t, { i: true, color: 'C2410C', sz: 18 }))

function dataContohPg(jumlahOpsi: 4 | 5): ContohPg {
  const opsi: Record<string, string[]> = { A: ['2'], B: ['3'], C: ['4'], D: ['5'] }
  if (jumlahOpsi === 5) opsi.E = ['6']
  return {
    soal: [
      paraContoh(run('Perhatikan gambar berikut. Berapa banyak sisi bangun datar tersebut?')),
      paraContoh(RUN_GAMBAR_CONTOH),
      catatanContoh('Contoh: pertanyaan dan gambar ditulis di sel yang sama (tidak ada tempat terpisah untuk gambar).'),
    ],
    opsi,
    kunci: 'B',
    pembahasan: ['Segitiga memiliki 3 sisi.'],
  }
}

interface ContohEssay { soal: string[]; bobot: string }

function barisSoalEssay(nomor: string, contoh?: ContohEssay): string[] {
  const rows: BarisSpec[] = [
    { label: 'No', petunjuk: HINT_NO, isi: [nomor], nomor: true },
    { label: 'Soal', petunjuk: HINT_SOAL, isiParas: contoh?.soal },
    {
      label: 'Bobot',
      petunjuk: 'skor maksimal soal ini, angka > 0',
      isi: contoh ? [contoh.bobot] : undefined,
      terakhir: true,
    },
  ]
  return rows.map(r => baris(r, contoh ? SKEMA_CONTOH : SKEMA_ISI))
}

function dataContohEssay(): ContohEssay {
  return {
    soal: [
      paraContoh(run('Perhatikan gambar berikut. Sebutkan nama bangun datar tersebut dan jelaskan cirinya.')),
      paraContoh(RUN_GAMBAR_CONTOH),
      catatanContoh('Contoh: pertanyaan dan gambar ditulis di sel yang sama (tidak ada tempat terpisah untuk gambar).'),
    ],
    bobot: '10',
  }
}

function blokJudul(teks: string, sub: string): string {
  return (
    para(run(teks, { b: true, sz: 32, color: WARNA_HEADER }), { jc: 'center', after: 40 }) +
    para(run(sub, { i: true, color: WARNA_PETUNJUK }), { jc: 'center', after: 200 })
  )
}

function blokPetunjuk(jenis: JenisTemplate, jumlahOpsi: 4 | 5): string {
  const huruf = jumlahOpsi === 5 ? 'E' : 'D'
  const langkahPg = [
    'Satu tabel = satu nomor soal. Kolom BIRU berisi nama baris (No, Soal, A, B, …, Kunci): jangan diubah atau dihapus. Isi hanya kolom KUNING di sebelah kanannya. Nomor soal diurutkan otomatis saat impor, jadi angka di baris No tidak perlu diubah.',
    'Teks soal: ketik di kolom kuning pada baris Soal.',
    'Gambar soal (jika ada): masukkan di kolom kuning baris Soal yang SAMA dengan teks soal. Klik di dalam sel itu, lalu Sisipkan ▸ Gambar. Tidak ada tempat terpisah untuk gambar; teks dan gambar boleh bersama dalam satu sel (satu sel = satu gambar).',
    `Pilihan jawaban: ketik di baris A–${huruf}. Jika jawabannya berupa gambar, sisipkan gambar di sel opsi tersebut dengan cara yang sama.`,
    'Kunci: isi satu huruf saja (contoh: B).',
    'Butuh lebih banyak soal? Blok satu tabel beserta garis kosong di bawahnya, Salin (Ctrl+C), lalu Tempel (Ctrl+V) di bagian bawah dokumen.',
    'Baris Pembahasan boleh dikosongkan atau dihapus. Tabel yang seluruhnya kosong akan dilewati saat impor.',
  ]
  const langkahEssay = [
    'Satu tabel = satu nomor soal. Kolom BIRU berisi nama baris (No, Soal, Bobot): jangan diubah atau dihapus. Isi hanya kolom KUNING di sebelah kanannya. Nomor soal diurutkan otomatis saat impor, jadi angka di baris No tidak perlu diubah.',
    'Teks soal: ketik di kolom kuning pada baris Soal.',
    'Gambar soal (jika ada): masukkan di kolom kuning baris Soal yang SAMA dengan teks soal. Klik di dalam sel itu, lalu Sisipkan ▸ Gambar. Tidak ada tempat terpisah untuk gambar; teks dan gambar boleh bersama dalam satu sel (satu soal = satu gambar).',
    'Bobot = skor maksimal soal tersebut (angka lebih dari 0, mis. 10 atau 20). Total bobot dipakai sebagai patokan penilaian essay.',
    'Butuh lebih banyak soal? Blok satu tabel beserta garis kosong di bawahnya, Salin (Ctrl+C), lalu Tempel (Ctrl+V) di bagian bawah dokumen.',
    'Tabel yang seluruhnya kosong akan dilewati saat impor.',
  ]
  const umum = [
    'Gunakan gambar berformat PNG atau JPG (maks. 2 MB per gambar). Gambar hasil tempel dari program lain kadang berformat EMF/WMF dan tidak bisa dibaca — simpan dulu sebagai PNG, lalu sisipkan lewat menu Gambar.',
    'Simpan file sebagai .docx (bukan .doc), lalu unggah di menu Impor dari Word.',
  ]
  const semua = [...(jenis === 'pg' ? langkahPg : langkahEssay), ...umum]
  return (
    // Kotak peringatan utama
    para(run('PENTING', { b: true, color: 'FFFFFF', sz: 24 }), { shade: 'B45309', before: 0, after: 0, keepNext: true }) +
    para(
      run('Jangan mengubah kolom ', { b: true }) + run(' BIRU ', { b: true, color: 'FFFFFF', shade: SKEMA_ISI.label }) +
      run(' (nama baris). Isilah hanya kolom ', { b: true }) + run(' KUNING ', { b: true, shade: SKEMA_ISI.isi }) +
      run('.', { b: true }),
      { shade: 'FEF3C7', before: 0, after: 120 }
    ) +
    // Legenda warna
    para(
      run('Arti warna:  ', { b: true }) +
      run(' BIRU ', { b: true, color: 'FFFFFF', shade: SKEMA_ISI.label }) + run(' = jangan diubah     ') +
      run(' KUNING ', { b: true, shade: SKEMA_ISI.isi }) + run(' = tempat mengisi     ') +
      run(' ORANYE ', { b: true, color: 'FFFFFF', shade: SKEMA_CONTOH.label }) + run(' = hanya contoh, tidak diimpor'),
      { after: 160 }
    ) +
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
  // Diberi bingkai oranye tebal + spanduk di atas/bawah supaya jelas ini hanya contoh.
  body.push(
    para(run('CONTOH SAJA — BUKAN SOAL YANG HARUS DIISI', { b: true, color: 'FFFFFF', sz: 24 }), {
      shade: SKEMA_CONTOH.label, before: 120, after: 0, keepNext: true,
    })
  )
  body.push(
    para(run('Tabel bergaris oranye di bawah hanya memperlihatkan cara pengisian. Tidak perlu diisi atau diubah, dan tidak ikut diimpor.', { color: '7C2D12' }), {
      shade: 'FFEDD5', before: 0, after: 120, keepNext: true,
    })
  )
  body.push(
    tabel(
      isPg
        ? barisSoalPg('CONTOH', jumlahOpsi, dataContohPg(jumlahOpsi))
        : barisSoalEssay('CONTOH', dataContohEssay()),
      SKEMA_CONTOH
    )
  )
  body.push(
    para(run('▲ Akhir contoh. Isi soal Anda pada tabel bernomor di bagian "DAFTAR SOAL" di bawah ini.', { b: true, color: '7C2D12' }), {
      shade: 'FFEDD5', before: 120, after: 120,
    })
  )
  body.push(para(run('DAFTAR SOAL', { b: true, sz: 26, color: WARNA_HEADER }), { before: 240, after: 120, keepNext: true }))

  for (let n = 1; n <= jumlah; n++) {
    body.push(tabel(isPg ? barisSoalPg(String(n), jumlahOpsi) : barisSoalEssay(String(n)), SKEMA_ISI))
    body.push(PEMISAH)
  }

  const sect =
    '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/>' +
    '<w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="567" w:footer="567" w:gutter="0"/></w:sectPr>'

  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    `<w:document xmlns:w="${W_NS}" xmlns:r="${R_NS}" xmlns:wp="${WP_NS}" xmlns:a="${A_NS}" xmlns:pic="${PIC_NS}">` +
    `<w:body>${body.join('')}${sect}</w:body></w:document>`
  )
}

// ───────────── gambar contoh (PNG sederhana, dibuat dari kode) ─────────────
// Tanpa file aset & tanpa paket tambahan: segitiga biru di atas latar putih,
// ditulis sebagai PNG dengan blok deflate "stored" (tanpa kompresi).

const W_NS_IMG = 'rIdContohGambar'
const R_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const WP_NS = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing'
const A_NS = 'http://schemas.openxmlformats.org/drawingml/2006/main'
const PIC_NS = 'http://schemas.openxmlformats.org/drawingml/2006/picture'

const IMG_W = 260
const IMG_H = 150

let _crcTable: Uint32Array | null = null
function crc32(buf: Uint8Array): number {
  if (!_crcTable) {
    _crcTable = new Uint32Array(256)
    for (let n = 0; n < 256; n++) {
      let c = n
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      _crcTable[n] = c >>> 0
    }
  }
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = _crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function adler32(buf: Uint8Array): number {
  let a = 1, b = 0
  for (let i = 0; i < buf.length; i++) {
    a = (a + buf[i]) % 65521
    b = (b + a) % 65521
  }
  return ((b << 16) | a) >>> 0
}

function u32(n: number): number[] {
  return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]
}

function chunkPng(tipe: string, data: Uint8Array): number[] {
  const t = Array.from(tipe).map(c => c.charCodeAt(0))
  const body = new Uint8Array(t.length + data.length)
  body.set(t, 0)
  body.set(data, t.length)
  return [...u32(data.length), ...Array.from(body), ...u32(crc32(body))]
}

function buatPngContoh(): Uint8Array {
  // Segitiga: titik puncak atas, dua titik alas.
  const P = [[130, 14], [236, 136], [24, 136]]
  const sisi = (ax: number, ay: number, bx: number, by: number, px: number, py: number) =>
    (bx - ax) * (py - ay) - (by - ay) * (px - ax)
  const jarakKeGaris = (ax: number, ay: number, bx: number, by: number, px: number, py: number) =>
    Math.abs(sisi(ax, ay, bx, by, px, py)) / Math.hypot(bx - ax, by - ay)

  const raw = new Uint8Array(IMG_H * (1 + IMG_W * 3))
  let o = 0
  for (let y = 0; y < IMG_H; y++) {
    raw[o++] = 0 // filter: none
    for (let x = 0; x < IMG_W; x++) {
      let rgb = [255, 255, 255]
      const d1 = sisi(P[0][0], P[0][1], P[1][0], P[1][1], x, y)
      const d2 = sisi(P[1][0], P[1][1], P[2][0], P[2][1], x, y)
      const d3 = sisi(P[2][0], P[2][1], P[0][0], P[0][1], x, y)
      const dalam = (d1 >= 0 && d2 >= 0 && d3 >= 0) || (d1 <= 0 && d2 <= 0 && d3 <= 0)
      const tepi = Math.min(
        jarakKeGaris(P[0][0], P[0][1], P[1][0], P[1][1], x, y),
        jarakKeGaris(P[1][0], P[1][1], P[2][0], P[2][1], x, y),
        jarakKeGaris(P[2][0], P[2][1], P[0][0], P[0][1], x, y)
      )
      if (dalam) rgb = tepi <= 3 ? [30, 79, 156] : [191, 215, 245]
      // bingkai tipis abu-abu
      if (x === 0 || y === 0 || x === IMG_W - 1 || y === IMG_H - 1) rgb = [200, 205, 215]
      raw[o++] = rgb[0]; raw[o++] = rgb[1]; raw[o++] = rgb[2]
    }
  }

  // zlib: header 78 01, blok stored (maks 65535 byte per blok), adler32
  const z: number[] = [0x78, 0x01]
  for (let i = 0; i < raw.length; i += 65535) {
    const bagian = raw.subarray(i, Math.min(i + 65535, raw.length))
    const akhir = i + 65535 >= raw.length ? 1 : 0
    const len = bagian.length
    z.push(akhir, len & 255, len >>> 8, ~len & 255, (~len >>> 8) & 255)
    for (let k = 0; k < bagian.length; k++) z.push(bagian[k])
  }
  z.push(...u32(adler32(raw)))

  const ihdr = new Uint8Array([...u32(IMG_W), ...u32(IMG_H), 8, 2, 0, 0, 0])
  return new Uint8Array([
    137, 80, 78, 71, 13, 10, 26, 10,
    ...chunkPng('IHDR', ihdr),
    ...chunkPng('IDAT', new Uint8Array(z)),
    ...chunkPng('IEND', new Uint8Array(0)),
  ])
}

// Gambar sebaris (inline) yang merujuk relasi rIdContohGambar.
const EMU = 9525
const RUN_GAMBAR_CONTOH =
  '<w:r><w:drawing>' +
  `<wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${IMG_W * EMU}" cy="${IMG_H * EMU}"/>` +
  '<wp:docPr id="1" name="Gambar contoh" descr="Contoh gambar: segitiga"/>' +
  '<wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr>' +
  `<a:graphic><a:graphicData uri="${PIC_NS}"><pic:pic>` +
  '<pic:nvPicPr><pic:cNvPr id="1" name="contoh.png"/><pic:cNvPicPr/></pic:nvPicPr>' +
  `<pic:blipFill><a:blip r:embed="${W_NS_IMG}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
  `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${IMG_W * EMU}" cy="${IMG_H * EMU}"/></a:xfrm>` +
  '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>' +
  '</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>'

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
  '<Default Extension="png" ContentType="image/png"/>' +
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
  `<Relationship Id="${W_NS_IMG}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/contoh.png"/>` +
  '</Relationships>'

/** Membuat file template .docx sebagai Blob (untuk diunduh di browser). */
export async function buatTemplateDocx(opsi: OpsiTemplate): Promise<Blob> {
  const zip = new JSZip()
  zip.file('[Content_Types].xml', CONTENT_TYPES)
  zip.file('_rels/.rels', ROOT_RELS)
  zip.file('word/document.xml', dokumen(opsi))
  zip.file('word/styles.xml', STYLES)
  zip.file('word/_rels/document.xml.rels', DOC_RELS)
  zip.file('word/media/contoh.png', buatPngContoh())
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
  zip.file('word/media/contoh.png', buatPngContoh())
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })
}

export function namaFileTemplate(jenis: JenisTemplate): string {
  return jenis === 'pg' ? 'Template-Impor-Soal-Pilihan-Ganda.docx' : 'Template-Impor-Soal-Essay.docx'
}
