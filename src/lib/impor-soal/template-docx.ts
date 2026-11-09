// src/lib/impor-soal/template-docx.ts
//
// ── PEMBUAT TEMPLATE WORD (.docx) UNTUK IMPOR SOAL ─────────────────────────
// Dibuat langsung dari XML OOXML + JSZip (JSZip sudah jadi dependensi repo),
// jadi TIDAK ada paket npm baru dan tidak butuh koneksi server — template
// dibuat di browser guru saat tombol "Unduh Template" ditekan.
//
// DESAIN TEMPLATE
//  • HALAMAN 1 = petunjuk singkat + satu tabel CONTOH. HALAMAN 2 dst. = tabel
//    soal untuk diisi guru.
//  • SATU TABEL PER NOMOR SOAL, dua kolom: kiri = nama baris (No / Soal /
//    Gambar Soal / A / B / … / Kunci), kanan = isian guru. Parser membaca
//    LABEL di kolom kiri, bukan posisi baris.
//  • Gambar soal punya BARIS SENDIRI ("Gambar Soal"), terpisah dari baris
//    "Soal". Parser tetap menerima gambar yang disisipkan di sel Soal
//    (file lama), tapi baris Gambar Soal yang diutamakan.
//  • TERKUNCI: dokumen memakai proteksi penyuntingan Word ("Read only" tanpa
//    kata sandi) dengan pengecualian (permStart/permEnd) HANYA di sel isian
//    kuning. Petunjuk, contoh, nomor, dan nama baris tidak bisa diubah atau
//    dihapus. Tanpa kata sandi: guru yang butuh membukanya cukup klik
//    Review ▸ Restrict Editing ▸ Stop Protection.
//  • OPSI JAWABAN PG punya dua mode (OpsiTemplate.modeOpsi):
//      - 'sekaligus' (bawaan): SATU sel isian "Pilihan Jawaban". Guru menempel
//        semua pilihan (A–E) sekaligus, satu pilihan per baris; huruf "A." /
//        "B)" di depan boleh ada, boleh tidak. Parser memecahnya per baris.
//        Alasan: proteksi Word mengunci baris di antara sel isian, sehingga
//        tempelan beberapa baris ke A–E (baris terpisah) tidak bisa dilakukan
//        sekali jalan.
//      - 'terpisah': baris A, B, C, D, (E) sendiri-sendiri (cara lama).
//  • Warna hanya tampilan: biru = nama baris (terkunci), kuning = tempat
//    mengisi, oranye = tabel CONTOH (tidak diimpor).
//  • Petunjuk kecil di bawah nama baris TIDAK ikut terbaca — parser hanya
//    memakai baris pertama label.
//  • Tabel dengan "No" berisi kata CONTOH dilewati saat impor, begitu juga
//    tabel yang seluruhnya kosong.

import JSZip from 'jszip'

export type JenisTemplate = 'pg' | 'essay'
export type ModeOpsi = 'sekaligus' | 'terpisah'

export interface OpsiTemplate {
  jenis: JenisTemplate
  /** Jumlah tabel soal kosong yang disediakan (1–200). */
  jumlah: number
  /** Jumlah opsi PG: 4 (A–D) atau 5 (A–E). Diabaikan untuk essay. */
  jumlahOpsi?: 4 | 5
  /**
   * Cara mengisi opsi PG. 'sekaligus' (bawaan) = satu sel "Pilihan Jawaban" untuk
   * menempel semua opsi sekaligus; 'terpisah' = satu baris per huruf (A, B, C …).
   */
  modeOpsi?: ModeOpsi
  /** Identitas paket — dicetak di bagian atas halaman 1 (terkunci). */
  namaMapel?: string
  namaKelas?: string
}

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'

// Lebar halaman A4 dengan margin 2 cm: 11906 - 2*1134 = 9638 twips.
const LEBAR_TABEL = 9638
const LEBAR_LABEL = 2300
const LEBAR_ISI = LEBAR_TABEL - LEBAR_LABEL

// ── UKURAN GAMBAR YANG DITEMPEL ──────────────────────────────────────────────
// Word tidak punya pengaturan dokumen "batasi ukuran gambar yang di-paste".
// Yang pasti dilakukan Word: gambar yang ditempel/disisipkan ke dalam tabel
// disesuaikan ke LEBAR ISI SEL (lebar sel dikurangi margin kiri-kanan), tinggi
// mengikuti sehingga proporsional. Maka baris yang boleh berisi gambar (Gambar
// Soal dan opsi A–E) diberi margin kanan besar: warna kuning tetap selebar sel,
// tetapi area isinya sempit. Ubah LEBAR_AREA_GAMBAR untuk menyesuaikan ukuran
// (1 cm = 567 twips; 3700 ≈ 6,5 cm). Hanya tampilan di Word: parser tidak
// membaca ukuran gambar, dan di aplikasi gambar sudah dibatasi sendiri.
const MARGIN_SEL = 100 // sama dengan tblCellMar kiri/kanan di tabel()
const LEBAR_AREA_GAMBAR = 3700
const MARGIN_KANAN_AREA_GAMBAR = LEBAR_ISI - MARGIN_SEL - LEBAR_AREA_GAMBAR

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

interface ParaOpt { pb?: boolean; keepNext?: boolean; jc?: 'left' | 'center'; after?: number; before?: number; shade?: string }

function para(runs: string, o: ParaOpt = {}): string {
  const ppr =
    (o.keepNext ? '<w:keepNext/>' : '') +
    (o.pb ? '<w:pageBreakBefore/>' : '') +
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

function tc(width: number, content: string, shade?: string, marginKanan?: number): string {
  // Urutan anak tcPr menurut skema OOXML: tcW, shd, tcMar.
  return (
    `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/>` +
    (shade ? `<w:shd w:val="clear" w:color="auto" w:fill="${shade}"/>` : '') +
    (marginKanan !== undefined
      ? `<w:tcMar><w:left w:w="${MARGIN_SEL}" w:type="dxa"/><w:right w:w="${marginKanan}" w:type="dxa"/></w:tcMar>`
      : '') +
    `</w:tcPr>${content}</w:tc>`
  )
}

// Rentang yang BOLEH disunting di dokumen terproteksi (lihat PROTEKSI di bawah).
let _permId = 0
const permStart = () => `<w:permStart w:id="${++_permId}" w:edGrp="everyone"/>`
const permEnd = () => `<w:permEnd w:id="${_permId}"/>`

interface BarisSpec {
  label: string
  petunjuk?: string
  /** Isi awal sel kanan (kosong untuk tabel soal sungguhan). */
  isi?: string[]
  /** Paragraf XML siap pakai untuk sel kanan (dipakai tabel CONTOH, mis. berisi gambar). */
  isiParas?: string[]
  /** Baris nomor: sel kanan abu-abu, terkunci (tidak perlu diubah). */
  nomor?: boolean
  /** Baris yang boleh berisi gambar: area isi dipersempit agar gambar tempelan mengecil proporsional. */
  areaGambar?: boolean
  /** Ini baris terakhir tabel — paragraf tidak diberi keepNext. */
  terakhir?: boolean
}

function baris(b: BarisSpec, sk: Skema, bisaDisunting: boolean): string {
  const kn = !b.terakhir
  // Paragraf PERTAMA di kolom kiri = nama baris (dibaca parser). Petunjuk di
  // paragraf kedua tidak dibaca parser.
  const kiri =
    para(run(b.label, { b: true, color: sk.labelTeks }), { keepNext: kn, before: 40, after: b.petunjuk ? 0 : 40 }) +
    (b.petunjuk
      ? para(run(b.petunjuk, { i: true, color: sk.hint, sz: 16 }), { keepNext: kn, after: 40 })
      : '')
  let isiParas = b.isiParas ?? (b.isi && b.isi.length ? b.isi : ['']).map(t =>
    para(t ? run(t) : '', { keepNext: kn, before: 40, after: 40 })
  )
  // Hanya sel isian kuning yang dibuka dari proteksi: penanda rentang disisipkan
  // di paragraf pertama (awal) dan paragraf terakhir (akhir) sel itu.
  if (bisaDisunting && !b.nomor) {
    const ps = permStart(), pe = permEnd()
    const mid = (x: string) => x
    isiParas = isiParas.map((x, i) => {
      let y = mid(x)
      if (i === 0) y = y.replace(/^<w:p>(<w:pPr>.*?<\/w:pPr>)?/, m => m + ps)
      if (i === isiParas.length - 1) y = y.replace(/<\/w:p>$/, pe + '</w:p>')
      return y
    })
  }
  return (
    '<w:tr><w:trPr><w:cantSplit/></w:trPr>' +
    tc(LEBAR_LABEL, kiri, sk.label) +
    tc(
      LEBAR_ISI,
      isiParas.join(''),
      b.nomor ? sk.no : sk.isi,
      b.areaGambar ? MARGIN_KANAN_AREA_GAMBAR : undefined
    ) +
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

const HINT_NO = 'otomatis, terkunci'
const HINT_SOAL = 'ketik pertanyaan'
const HINT_GAMBAR = 'jika ada gambar: Sisipkan ▸ Gambar'
const HINT_PILIHAN = 'tempel semua opsi sekaligus, 1 opsi per baris'

interface ContohPg {
  soal: string[]                 // paragraf XML
  gambar: string[]               // paragraf XML (berisi gambar)
  opsi: Record<string, string[]>
  kunci: string
  pembahasan: string[]
}

const paraContoh = (runs: string) => para(runs, { keepNext: true, before: 40, after: 40 })

function barisSoalPg(nomor: string, jumlahOpsi: 4 | 5, mode: ModeOpsi, contoh?: ContohPg): string[] {
  const huruf = ['A', 'B', 'C', 'D', 'E'].slice(0, jumlahOpsi)
  // Baris opsi: satu sel "Pilihan Jawaban" (tempel sekaligus) atau A, B, C … terpisah.
  const barisOpsi: BarisSpec[] =
    mode === 'sekaligus'
      ? [{
          label: 'Pilihan Jawaban',
          petunjuk: HINT_PILIHAN,
          isiParas: contoh ? huruf.map(h => paraContoh(run(`${h}. ${(contoh.opsi[h] ?? [''])[0]}`))) : undefined,
          areaGambar: true,
        }]
      : huruf.map(h => ({
          label: h,
          petunjuk: h === 'A' ? 'teks atau gambar' : undefined,
          isi: contoh?.opsi[h],
          areaGambar: true,
        }))
  const rows: BarisSpec[] = [
    { label: 'No', petunjuk: HINT_NO, isi: [nomor], nomor: true },
    { label: 'Soal', petunjuk: HINT_SOAL, isiParas: contoh?.soal },
    { label: 'Gambar Soal', petunjuk: HINT_GAMBAR, isiParas: contoh?.gambar, areaGambar: true },
    ...barisOpsi,
    { label: 'Kunci', petunjuk: `satu huruf ${huruf[0]}–${huruf[huruf.length - 1]}`, isi: contoh ? [contoh.kunci] : undefined },
    { label: 'Pembahasan', petunjuk: 'boleh kosong', isi: contoh?.pembahasan },
  ]
  rows[rows.length - 1].terakhir = true
  return rows.map(r => baris(r, contoh ? SKEMA_CONTOH : SKEMA_ISI, !contoh))
}

function dataContohPg(jumlahOpsi: 4 | 5): ContohPg {
  const opsi: Record<string, string[]> = { A: ['2'], B: ['3'], C: ['4'], D: ['5'] }
  if (jumlahOpsi === 5) opsi.E = ['6']
  return {
    soal: [paraContoh(run('Berapa banyak sisi bangun datar pada gambar?'))],
    gambar: [paraContoh(RUN_GAMBAR_CONTOH)],
    opsi,
    kunci: 'B',
    pembahasan: ['Segitiga memiliki 3 sisi.'],
  }
}

interface ContohEssay { soal: string[]; gambar: string[]; bobot: string }

function barisSoalEssay(nomor: string, contoh?: ContohEssay): string[] {
  const rows: BarisSpec[] = [
    { label: 'No', petunjuk: HINT_NO, isi: [nomor], nomor: true },
    { label: 'Soal', petunjuk: HINT_SOAL, isiParas: contoh?.soal },
    { label: 'Gambar Soal', petunjuk: HINT_GAMBAR, isiParas: contoh?.gambar, areaGambar: true },
    {
      label: 'Bobot',
      petunjuk: 'skor maksimal, angka > 0',
      isi: contoh ? [contoh.bobot] : undefined,
      terakhir: true,
    },
  ]
  return rows.map(r => baris(r, contoh ? SKEMA_CONTOH : SKEMA_ISI, !contoh))
}

function dataContohEssay(): ContohEssay {
  return {
    soal: [paraContoh(run('Sebutkan nama bangun datar pada gambar dan jelaskan cirinya.'))],
    gambar: [paraContoh(RUN_GAMBAR_CONTOH)],
    bobot: '10',
  }
}

function blokJudul(teks: string): string {
  return para(run(teks, { b: true, sz: 30, color: WARNA_HEADER }), { jc: 'center', after: 120 })
}

function blokInfoPaket(o: OpsiTemplate, jumlah: number): string {
  const sel = (label: string, nilai: string) =>
    run(`${label}: `, { sz: 20, color: WARNA_PETUNJUK }) + run(nilai, { b: true, sz: 22 })
  const spasi = run('      ')
  return para(
    sel('Mapel', o.namaMapel || '-') + spasi + sel('Kelas', o.namaKelas || '-') + spasi + sel('Jumlah soal', String(jumlah)),
    { shade: 'F3F4F6', jc: 'center', before: 0, after: 100 }
  )
}

function blokPetunjuk(jenis: JenisTemplate, jumlahOpsi: 4 | 5, mode: ModeOpsi): string {
  const huruf = jumlahOpsi === 5 ? 'E' : 'D'
  const langkahOpsi = mode === 'sekaligus'
    ? `Pilihan jawaban: salin semua pilihan A–${huruf} dari Word Anda, lalu TEMPEL SEKALIGUS di baris \"Pilihan Jawaban\" (satu pilihan per baris). Huruf \"A.\" \"B.\" di depan boleh ada, boleh tidak. Kunci: satu huruf saja, mis. B.`
    : `Pilihan jawaban: isi baris A–${huruf} satu per satu (boleh teks atau gambar). Kunci: satu huruf saja, mis. B.`
  const langkah = jenis === 'pg'
    ? [
        'Isi hanya kolom KUNING. Nama baris (kolom biru) sudah terkunci.',
        'Soal: ketik pertanyaan di baris "Soal". Kalau ada gambar, sisipkan di baris "Gambar Soal" (bukan di baris Soal). Tidak ada gambar? Kosongkan.',
        langkahOpsi,
        'Gambar PNG/JPG, maks. 2 MB, satu gambar per baris. Simpan sebagai .docx, lalu unggah di menu Impor dari Word.',
      ]
    : [
        'Isi hanya kolom KUNING. Nama baris (kolom biru) sudah terkunci.',
        'Soal: ketik pertanyaan di baris "Soal". Kalau ada gambar, sisipkan di baris "Gambar Soal" (bukan di baris Soal). Tidak ada gambar? Kosongkan.',
        'Bobot: skor maksimal soal itu, angka lebih dari 0 (mis. 10).',
        'Gambar PNG/JPG, maks. 2 MB, satu gambar per baris. Simpan sebagai .docx, lalu unggah di menu Impor dari Word.',
      ]
  return (
    para(run('CARA PAKAI', { b: true, color: 'FFFFFF', sz: 22 }), { shade: SKEMA_ISI.label, before: 0, after: 0, keepNext: true }) +
    langkah.map((t, i) =>
      para(run(`${i + 1}. `, { b: true, sz: 20 }) + run(t, { sz: 20 }), { shade: 'EEF4FF', before: 20, after: 20 })
    ).join('') +
    para(
      run('Warna:  ', { b: true, sz: 18 }) +
      run(' BIRU ', { b: true, color: 'FFFFFF', shade: SKEMA_ISI.label, sz: 18 }) + run(' terkunci    ', { sz: 18 }) +
      run(' KUNING ', { b: true, shade: SKEMA_ISI.isi, sz: 18 }) + run(' tempat mengisi    ', { sz: 18 }) +
      run(' ORANYE ', { b: true, color: 'FFFFFF', shade: SKEMA_CONTOH.label, sz: 18 }) + run(' contoh (tidak diimpor)', { sz: 18 }),
      { before: 80, after: 60 }
    )
  )
}

function dokumen(opsi: OpsiTemplate): string {
  _permId = 0
  const jumlah = Math.max(1, Math.min(200, Math.floor(opsi.jumlah) || 10))
  const jumlahOpsi: 4 | 5 = opsi.jumlahOpsi === 5 ? 5 : 4
  const isPg = opsi.jenis === 'pg'
  const mode: ModeOpsi = opsi.modeOpsi === 'terpisah' ? 'terpisah' : 'sekaligus'

  const body: string[] = []
  // ── HALAMAN 1: petunjuk singkat + contoh ──
  body.push(blokJudul(isPg ? 'TEMPLATE IMPOR SOAL PILIHAN GANDA' : 'TEMPLATE IMPOR SOAL ESSAY'))
  body.push(blokInfoPaket(opsi, jumlah))
  body.push(blokPetunjuk(opsi.jenis, jumlahOpsi, mode))
  body.push(
    para(run('CONTOH PENGISIAN — tidak perlu diisi, tidak ikut diimpor', { b: true, color: 'FFFFFF', sz: 20 }), {
      shade: SKEMA_CONTOH.label, before: 60, after: 0, keepNext: true,
    })
  )
  body.push(
    tabel(
      isPg
        ? barisSoalPg('CONTOH', jumlahOpsi, mode, dataContohPg(jumlahOpsi))
        : barisSoalEssay('CONTOH', dataContohEssay()),
      SKEMA_CONTOH
    )
  )

  // ── HALAMAN 2 dst.: tabel soal untuk diisi ──
  body.push(para(run('DAFTAR SOAL — isi di tabel kuning di bawah ini', { b: true, sz: 26, color: WARNA_HEADER }), { pb: true, before: 0, after: 120, keepNext: true }))
  for (let n = 1; n <= jumlah; n++) {
    body.push(tabel(isPg ? barisSoalPg(String(n), jumlahOpsi, mode) : barisSoalEssay(String(n)), SKEMA_ISI))
    body.push(PEMISAH)
  }

  const sect =
    '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/>' +
    '<w:pgMar w:top="1000" w:right="1134" w:bottom="1000" w:left="1134" w:header="567" w:footer="567" w:gutter="0"/></w:sectPr>'

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

const IMG_W = 200
const IMG_H = 105

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
  const P = [[100, 10], [182, 96], [18, 96]]
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

// PROTEKSI: dokumen "read only" tanpa kata sandi. Hanya rentang permStart/permEnd
// (sel isian kuning) yang bisa disunting; sisanya terkunci.
const SETTINGS =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  `<w:settings xmlns:w="${W_NS}"><w:documentProtection w:edit="readOnly" w:enforcement="1"/></w:settings>`

const CONTENT_TYPES =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
  '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
  '<Default Extension="xml" ContentType="application/xml"/>' +
  '<Default Extension="png" ContentType="image/png"/>' +
  '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
  '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
  '<Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>' +
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
  '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/>' +
  `<Relationship Id="${W_NS_IMG}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/contoh.png"/>` +
  '</Relationships>'

function bangunZip(opsi: OpsiTemplate): JSZip {
  const zip = new JSZip()
  zip.file('[Content_Types].xml', CONTENT_TYPES)
  zip.file('_rels/.rels', ROOT_RELS)
  zip.file('word/document.xml', dokumen(opsi))
  zip.file('word/styles.xml', STYLES)
  zip.file('word/settings.xml', SETTINGS)
  zip.file('word/_rels/document.xml.rels', DOC_RELS)
  zip.file('word/media/contoh.png', buatPngContoh())
  return zip
}

/** Membuat file template .docx sebagai Blob (untuk diunduh di browser). */
export async function buatTemplateDocx(opsi: OpsiTemplate): Promise<Blob> {
  return bangunZip(opsi).generateAsync({
    type: 'blob',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    compression: 'DEFLATE',
  })
}

/** Versi Buffer/Uint8Array — dipakai untuk pengujian di Node. */
export async function buatTemplateDocxBytes(opsi: OpsiTemplate): Promise<Uint8Array> {
  return bangunZip(opsi).generateAsync({ type: 'uint8array', compression: 'DEFLATE' })
}

/** Nama file unduhan: "Mapel - Kelas X - Soal Pilihan Ganda.docx" (karakter terlarang dibuang). */
export function namaFileTemplate(jenis: JenisTemplate, namaMapel?: string, namaKelas?: string): string {
  const bersih = (t: string) => t.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '').replace(/\s+/g, ' ').trim().slice(0, 60)
  const jenisTeks = jenis === 'pg' ? 'Soal Pilihan Ganda' : 'Soal Essay'
  const mapel = bersih(namaMapel ?? '')
  const kelas = bersih(namaKelas ?? '')
  const bagian = [mapel, kelas ? `Kelas ${kelas}` : '', jenisTeks].filter(Boolean)
  return `${bagian.join(' - ')}.docx`
}
