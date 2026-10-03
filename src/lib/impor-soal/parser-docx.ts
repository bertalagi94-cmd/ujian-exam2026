// src/lib/impor-soal/parser-docx.ts
//
// ── PEMBACA FILE WORD (.docx) UNTUK IMPOR SOAL ─────────────────────────────
// Berjalan di BROWSER guru (DOMParser + JSZip). Alasannya: guru bisa melihat
// pratinjau dan daftar kesalahan SEBELUM apa pun disimpan, dan gambar di
// dalam .docx bisa langsung diunggah lewat endpoint upload yang sudah ada
// (/api/guru/soal/upload) tanpa perlu parser XML di server.
//
// Kode ini hanya memakai API DOM dasar (childNodes, localName, attributes)
// sehingga juga jalan di Node untuk pengujian (mis. dengan @xmldom/xmldom).
//
// ATURAN BACA (selaras dengan template di template-docx.ts)
//  • Setiap TABEL = satu soal. Baris dikenali dari LABEL di sel pertama
//    (baris pertama label saja), bukan dari posisi baris.
//  • Sel kanan boleh berisi teks, gambar, atau keduanya. Hanya GAMBAR
//    PERTAMA per sel yang dipakai (aplikasi menyimpan 1 gambar per
//    soal/opsi); sisanya dilaporkan sebagai peringatan.
//  • Superscript/subscript Word (x², H₂O) diubah menjadi karakter Unicode;
//    persamaan Word (OMML) diratakan menjadi teks linear.
//  • Tabel contoh (No berisi "CONTOH") dan tabel yang seluruhnya kosong
//    dilewati. Tabel tanpa baris "Soal" diabaikan.

import JSZip from 'jszip'

export type JenisImpor = 'pg' | 'essay'
export type HurufOpsi = 'a' | 'b' | 'c' | 'd' | 'e'
export const SEMUA_HURUF: HurufOpsi[] = ['a', 'b', 'c', 'd', 'e']

export interface GambarRef {
  /** Path di dalam zip, mis. word/media/image1.png */
  path: string
  mime: string
}

export interface OpsiTerbaca {
  teks: string
  gambar: GambarRef | null
}

export interface SoalPgTerbaca {
  /** Urutan tabel soal yang diproses (1, 2, 3 …). */
  urutan: number
  /** Isi sel "No" di dokumen (apa adanya), untuk membantu guru mencari tabelnya. */
  nomorDokumen: string
  teks: string
  gambarSoal: GambarRef | null
  opsi: Record<HurufOpsi, OpsiTerbaca>
  kunci: string
  pembahasan: string
  galat: string[]
  peringatan: string[]
}

export interface SoalEssayTerbaca {
  urutan: number
  nomorDokumen: string
  teks: string
  gambar: GambarRef | null
  /** null = belum diisi di dokumen. */
  bobot: number | null
  galat: string[]
  peringatan: string[]
}

export interface RingkasanBaca {
  tabelTotal: number
  tabelContoh: number
  tabelKosong: number
  tabelTidakDikenali: number
}

export interface HasilBacaPg {
  jenis: 'pg'
  soal: SoalPgTerbaca[]
  jumlahOpsi: 4 | 5
  ringkasan: RingkasanBaca
  peringatanUmum: string[]
  ambilBytes: (path: string) => Promise<Uint8Array | null>
}

export interface HasilBacaEssay {
  jenis: 'essay'
  soal: SoalEssayTerbaca[]
  ringkasan: RingkasanBaca
  peringatanUmum: string[]
  ambilBytes: (path: string) => Promise<Uint8Array | null>
}

export interface OpsiBaca {
  /** Paket PG tujuan sudah punya soal dengan jumlah opsi ini → dokumen WAJIB ikut. */
  jumlahOpsiPaksa?: 4 | 5 | null
  /** Untuk pengujian di Node. Default: DOMParser milik browser. */
  buatDom?: (xml: string) => Document
}

export const BATAS_SOAL_PER_IMPOR = 200

// ───────────────────────── helper DOM ─────────────────────────

type N = Element

function ln(n: Node): string {
  const e = n as Element
  return e.localName || (e.nodeName || '').split(':').pop() || ''
}

function anak(n: Node): N[] {
  const out: N[] = []
  const kids = n.childNodes
  for (let i = 0; i < kids.length; i++) {
    if (kids[i].nodeType === 1) out.push(kids[i] as N)
  }
  return out
}

function anakNamed(n: Node, nama: string): N[] {
  return anak(n).filter(c => ln(c) === nama)
}

function turunan(n: Node, nama: string, hasil: N[] = []): N[] {
  for (const c of anak(n)) {
    if (ln(c) === nama) hasil.push(c)
    turunan(c, nama, hasil)
  }
  return hasil
}

function attrLocal(el: N, nama: string): string | null {
  const attrs = el.attributes
  if (!attrs) return null
  for (let i = 0; i < attrs.length; i++) {
    const a = attrs[i]
    const lokal = a.localName || a.name.split(':').pop()
    if (lokal === nama) return a.value
  }
  return null
}

// ───────────────────────── Unicode sup/sub ─────────────────────────

const SUP: Record<string, string> = {
  '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹',
  '+': '⁺', '-': '⁻', '−': '⁻', '=': '⁼', '(': '⁽', ')': '⁾', n: 'ⁿ', i: 'ⁱ',
}
const SUB: Record<string, string> = {
  '0': '₀', '1': '₁', '2': '₂', '3': '₃', '4': '₄', '5': '₅', '6': '₆', '7': '₇', '8': '₈', '9': '₉',
  '+': '₊', '-': '₋', '−': '₋', '=': '₌', '(': '₍', ')': '₎',
  a: 'ₐ', e: 'ₑ', o: 'ₒ', x: 'ₓ', h: 'ₕ', k: 'ₖ', l: 'ₗ', m: 'ₘ', n: 'ₙ', p: 'ₚ', s: 'ₛ', t: 'ₜ',
}

function naikTurun(teks: string, mode: 'sup' | 'sub'): string {
  if (!teks) return ''
  const peta = mode === 'sup' ? SUP : SUB
  let out = ''
  for (const ch of teks) {
    const m = peta[ch]
    if (!m) {
      // Ada karakter yang tidak punya padanan Unicode → pakai notasi linear.
      const t = teks.trim()
      return mode === 'sup' ? `^(${t})` : `_(${t})`
    }
    out += m
  }
  return out
}

// ───────────────────────── Persamaan Word (OMML) ─────────────────────────

const OMML_ABAIKAN = new Set([
  'rPr', 'ctrlPr', 'fPr', 'dPr', 'radPr', 'naryPr', 'sSupPr', 'sSubPr', 'sSubSupPr', 'accPr',
  'barPr', 'funcPr', 'boxPr', 'groupChrPr', 'eqArrPr', 'mPr', 'limLowPr', 'limUppPr', 'phantPr',
])

function mathTeks(n: N): string {
  const nama = ln(n)
  if (OMML_ABAIKAN.has(nama)) return ''
  const sub = (k: string) => anakNamed(n, k).map(mathTeks).join('')

  switch (nama) {
    case 't':
      return n.textContent ?? ''
    case 'sSup':
      return sub('e') + naikTurun(sub('sup'), 'sup')
    case 'sSub':
      return sub('e') + naikTurun(sub('sub'), 'sub')
    case 'sSubSup':
      return sub('e') + naikTurun(sub('sub'), 'sub') + naikTurun(sub('sup'), 'sup')
    case 'f': {
      const a = sub('num')
      const b = sub('den')
      const bungkus = (s: string) => (/^[\w.,]+$/.test(s) ? s : `(${s})`)
      return `${bungkus(a)}/${bungkus(b)}`
    }
    case 'rad': {
      const deg = sub('deg')
      return `${deg ? naikTurun(deg, 'sup') : ''}√(${sub('e')})`
    }
    case 'nary': {
      const chr = anakNamed(n, 'naryPr')[0]
      const c = chr ? anakNamed(chr, 'chr')[0] : undefined
      const simbol = (c && attrLocal(c, 'val')) || '∫'
      const bawah = sub('sub')
      const atas = sub('sup')
      return `${simbol}${bawah ? `_(${bawah})` : ''}${atas ? `^(${atas})` : ''}${sub('e')}`
    }
    case 'd': {
      const pr = anakNamed(n, 'dPr')[0]
      const val = (k: string, def: string) => {
        const el = pr ? anakNamed(pr, k)[0] : undefined
        const v = el ? attrLocal(el, 'val') : null
        return v === null || v === undefined ? def : v
      }
      const buka = val('begChr', '(')
      const tutup = val('endChr', ')')
      const pisah = val('sepChr', '|')
      return buka + anakNamed(n, 'e').map(mathTeks).join(pisah) + tutup
    }
    case 'func':
      return sub('fName') + sub('e')
    default:
      return anak(n).map(mathTeks).join('')
  }
}

// ───────────────────────── konteks baca ─────────────────────────

const MIME_DARI_EKSTENSI: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  jpe: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  tif: 'image/tiff',
  tiff: 'image/tiff',
  emf: 'image/x-emf',
  wmf: 'image/x-wmf',
  svg: 'image/svg+xml',
}

function mimeDari(path: string): string {
  const ext = (path.split('.').pop() || '').toLowerCase()
  return MIME_DARI_EKSTENSI[ext] ?? 'application/octet-stream'
}

function normalisasiPath(basis: string, target: string): string {
  const mentah = target.startsWith('/') ? target.slice(1) : `${basis}/${target}`
  const out: string[] = []
  for (const bagian of mentah.split('/')) {
    if (!bagian || bagian === '.') continue
    if (bagian === '..') out.pop()
    else out.push(bagian)
  }
  return out.join('/')
}

interface Konteks {
  rels: Map<string, string>
  zip: JSZip
  peringatan: string[]
}

interface IsiSel {
  teks: string
  gambar: GambarRef[]
  adaMath: boolean
}

const PERINGATAN_OBJEK =
  'Ada objek yang bukan gambar biasa (diagram/bentuk, kotak teks, grafik, atau persamaan dari program lain) dan tidak ikut terimpor. Ubah menjadi gambar PNG/JPG lalu sisipkan lewat Sisipkan ▸ Gambar.'

function cariGambarDiRun(el: N, ktx: Konteks, keluar: GambarRef[]) {
  // DrawingML: <a:blip r:embed="rIdX"/>  | VML lama: <v:imagedata r:id="rIdX"/>
  const kandidat = [
    ...turunan(el, 'blip').map(b => attrLocal(b, 'embed')),
    ...turunan(el, 'imagedata').map(b => attrLocal(b, 'id')),
  ]
  const id = kandidat.find(Boolean)
  if (!id) {
    if (!ktx.peringatan.includes(PERINGATAN_OBJEK)) ktx.peringatan.push(PERINGATAN_OBJEK)
    return
  }
  const target = ktx.rels.get(id)
  if (!target) {
    ktx.peringatan.push('Ada gambar yang tidak bisa dibaca (referensi gambar tidak ditemukan di file).')
    return
  }
  const path = normalisasiPath('word', target)
  if (!ktx.zip.file(path)) {
    ktx.peringatan.push('Ada gambar yang tidak bisa dibaca (berkas gambar tidak ada di dalam file).')
    return
  }
  keluar.push({ path, mime: mimeDari(path) })
}

function pilihAlternate(n: N): N[] {
  // mc:AlternateContent: pakai <mc:Choice> saja; <mc:Fallback> berisi duplikat.
  const choice = anakNamed(n, 'Choice')[0]
  if (choice) return anak(choice)
  const fb = anakNamed(n, 'Fallback')[0]
  return fb ? anak(fb) : []
}

function bacaRun(r: N, ktx: Konteks, isi: IsiSel): string {
  let mode: 'sup' | 'sub' | null = null
  const rpr = anakNamed(r, 'rPr')[0]
  if (rpr) {
    const va = anakNamed(rpr, 'vertAlign')[0]
    const v = va ? attrLocal(va, 'val') : null
    if (v === 'superscript') mode = 'sup'
    else if (v === 'subscript') mode = 'sub'
  }
  let teks = ''
  const proses = (kids: N[]) => {
    for (const c of kids) {
      switch (ln(c)) {
        case 't':
          teks += c.textContent ?? ''
          break
        case 'tab':
        case 'ptab':
          teks += ' '
          break
        case 'br': {
          const tipe = attrLocal(c, 'type')
          if (tipe !== 'page' && tipe !== 'column') teks += '\n'
          break
        }
        case 'cr':
          teks += '\n'
          break
        case 'noBreakHyphen':
          teks += '-'
          break
        case 'drawing':
        case 'pict':
        case 'object':
          cariGambarDiRun(c, ktx, isi.gambar)
          break
        case 'AlternateContent':
          proses(pilihAlternate(c))
          break
        default:
          break
      }
    }
  }
  proses(anak(r))
  return mode ? naikTurun(teks, mode) : teks
}

function bacaInline(parent: N, ktx: Konteks, isi: IsiSel): string {
  let out = ''
  for (const c of anak(parent)) {
    switch (ln(c)) {
      case 'r':
        out += bacaRun(c, ktx, isi)
        break
      case 'hyperlink':
      case 'ins':
      case 'smartTag':
      case 'fldSimple':
      case 'customXml':
      case 'dir':
      case 'bdo':
        out += bacaInline(c, ktx, isi)
        break
      case 'sdt': {
        const konten = anakNamed(c, 'sdtContent')[0]
        if (konten) out += bacaInline(konten, ktx, isi)
        break
      }
      case 'oMathPara':
      case 'oMath':
        isi.adaMath = true
        out += mathTeks(c)
        break
      case 'AlternateContent':
        for (const x of pilihAlternate(c)) {
          if (ln(x) === 'r') out += bacaRun(x, ktx, isi)
        }
        break
      default:
        break // pPr, del, bookmark, proofErr, dst. diabaikan
    }
  }
  return out
}

function bacaBlok(parent: N, ktx: Konteks, isi: IsiSel, baris: string[]) {
  for (const c of anak(parent)) {
    switch (ln(c)) {
      case 'p':
        baris.push(bacaInline(c, ktx, isi))
        break
      case 'sdt': {
        const konten = anakNamed(c, 'sdtContent')[0]
        if (konten) bacaBlok(konten, ktx, isi, baris)
        break
      }
      case 'tbl':
        // Tabel di dalam sel: ratakan isinya agar tidak hilang diam-diam.
        for (const tr of anakNamed(c, 'tr')) {
          for (const tc of anakNamed(tr, 'tc')) bacaBlok(tc, ktx, isi, baris)
        }
        break
      default:
        break
    }
  }
}

function bersihkan(s: string): string {
  return s
    .replace(/\u00a0/g, ' ')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
    .split('\n')
    .map(l => l.replace(/[ \t]+$/g, '').replace(/^[ \t]+/g, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function bacaSel(tc: N, ktx: Konteks): IsiSel {
  const isi: IsiSel = { teks: '', gambar: [], adaMath: false }
  const baris: string[] = []
  bacaBlok(tc, ktx, isi, baris)
  isi.teks = bersihkan(baris.join('\n'))
  return isi
}

// ───────────────────────── pengenalan label ─────────────────────────

type Label = 'no' | 'soal' | 'kunci' | 'pembahasan' | 'bobot' | HurufOpsi | null

function kenaliLabel(teks: string): Label {
  const n = teks.split('\n')[0].toLowerCase().replace(/[^a-z]/g, '')
  if (!n) return null
  if (n === 'no' || n.startsWith('nomor')) return 'no'
  if (n === 'soal' || n.startsWith('pertanyaan') || n === 'butirsoal') return 'soal'
  if (n.startsWith('kunci') || n === 'jawaban' || n === 'jawabanbenar') return 'kunci'
  if (n.startsWith('pembahasan') || n.startsWith('penjelasan')) return 'pembahasan'
  if (n.startsWith('bobot') || n.startsWith('skor')) return 'bobot'
  const m = n.match(/^(?:opsi|pilihan)?([a-e])$/)
  if (m) return m[1] as HurufOpsi
  return null
}

interface TabelTerbaca {
  isi: Map<Exclude<Label, null>, IsiSel>
  duplikat: string[]
}

function bacaTabel(tbl: N, ktx: Konteks): TabelTerbaca {
  const isi = new Map<Exclude<Label, null>, IsiSel>()
  const duplikat: string[] = []
  for (const tr of anakNamed(tbl, 'tr')) {
    const sel = anakNamed(tr, 'tc')
    if (sel.length < 2) continue
    const label = kenaliLabel(bacaSel(sel[0], ktx).teks)
    if (!label) continue
    if (isi.has(label)) {
      duplikat.push(label)
      continue
    }
    // Jika guru menggabung/memecah sel sehingga ada >2 kolom, gabungkan semua
    // sel di kanan label supaya isinya tidak hilang.
    const gabung: IsiSel = { teks: '', gambar: [], adaMath: false }
    const potongan: string[] = []
    for (const s of sel.slice(1)) {
      const x = bacaSel(s, ktx)
      if (x.teks) potongan.push(x.teks)
      gabung.gambar.push(...x.gambar)
      gabung.adaMath = gabung.adaMath || x.adaMath
    }
    gabung.teks = potongan.join('\n')
    isi.set(label, gabung)
  }
  return { isi, duplikat }
}

function kumpulkanTabel(parent: N, hasil: N[] = []): N[] {
  for (const c of anak(parent)) {
    const nama = ln(c)
    if (nama === 'tbl') hasil.push(c)
    else if (nama === 'sdt') {
      const k = anakNamed(c, 'sdtContent')[0]
      if (k) kumpulkanTabel(k, hasil)
    } else if (nama === 'customXml') kumpulkanTabel(c, hasil)
  }
  return hasil
}

// ───────────────────────── antarmuka utama ─────────────────────────

function pilihGambar(
  sel: IsiSel | undefined,
  konteksNama: string,
  peringatan: string[]
): GambarRef | null {
  if (!sel || sel.gambar.length === 0) return null
  if (sel.gambar.length > 1) {
    peringatan.push(`${konteksNama}: ada ${sel.gambar.length} gambar, hanya gambar pertama yang dipakai.`)
  }
  return sel.gambar[0]
}

function kosong(sel?: IsiSel): boolean {
  return !sel || (!sel.teks && sel.gambar.length === 0)
}

function parseKunci(teks: string): { huruf: string | null; banyak: boolean } {
  const token = teks.toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean)
  const kandidat = [...new Set(token.filter(t => /^[A-E]$/.test(t)))]
  if (kandidat.length === 0) return { huruf: null, banyak: false }
  return { huruf: kandidat[0], banyak: kandidat.length > 1 }
}

function parseBobot(teks: string): number | null | 'salah' {
  const t = teks.trim()
  if (!t) return null
  const m = t.replace(',', '.').match(/\d+(\.\d+)?/)
  if (!m) return 'salah'
  const angka = Number(m[0])
  return Number.isFinite(angka) ? angka : 'salah'
}

async function bukaDokumen(data: ArrayBuffer | Uint8Array, opsi?: OpsiBaca) {
  let zip: JSZip
  try {
    zip = await JSZip.loadAsync(data)
  } catch {
    throw new Error('File tidak bisa dibuka. Pastikan file berformat .docx (bukan .doc atau file yang rusak).')
  }
  const berkasDoc = zip.file('word/document.xml')
  if (!berkasDoc) {
    throw new Error('File ini bukan dokumen Word (.docx) yang valid.')
  }
  const xmlDoc = await berkasDoc.async('string')
  const xmlRels = (await zip.file('word/_rels/document.xml.rels')?.async('string')) ?? ''

  const buatDom =
    opsi?.buatDom ??
    ((xml: string) => {
      if (typeof DOMParser === 'undefined') throw new Error('DOMParser tidak tersedia')
      return new DOMParser().parseFromString(xml, 'application/xml')
    })

  const dom = buatDom(xmlDoc)
  if (dom.getElementsByTagName('parsererror').length > 0) {
    throw new Error('Isi dokumen Word tidak bisa dibaca (XML rusak). Coba buka lalu simpan ulang file di Word.')
  }

  const rels = new Map<string, string>()
  if (xmlRels) {
    const domRels = buatDom(xmlRels)
    const daftar = domRels.getElementsByTagName('Relationship')
    for (let i = 0; i < daftar.length; i++) {
      const r = daftar[i] as N
      const mode = r.getAttribute('TargetMode')
      const id = r.getAttribute('Id')
      const target = r.getAttribute('Target')
      if (id && target && mode !== 'External') rels.set(id, target)
    }
  }

  const body = turunan(dom.documentElement, 'body')[0] ?? dom.documentElement
  const tabel = kumpulkanTabel(body)
  return { zip, rels, tabel }
}

function buatAmbilBytes(zip: JSZip) {
  const cache = new Map<string, Uint8Array | null>()
  return async (path: string): Promise<Uint8Array | null> => {
    if (cache.has(path)) return cache.get(path) ?? null
    const f = zip.file(path)
    const bytes = f ? await f.async('uint8array') : null
    cache.set(path, bytes)
    return bytes
  }
}

const MIME_LANGSUNG = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp'])
export function gambarLangsungDidukung(mime: string): boolean {
  return MIME_LANGSUNG.has(mime)
}

/** Baca template soal PILIHAN GANDA. */
export async function bacaDocxPg(data: ArrayBuffer | Uint8Array, opsi?: OpsiBaca): Promise<HasilBacaPg> {
  const { zip, rels, tabel } = await bukaDokumen(data, opsi)
  const peringatanUmum: string[] = []
  const ktx: Konteks = { rels, zip, peringatan: peringatanUmum }
  const ringkasan: RingkasanBaca = { tabelTotal: tabel.length, tabelContoh: 0, tabelKosong: 0, tabelTidakDikenali: 0 }
  const soal: SoalPgTerbaca[] = []
  let adaBobotLabel = false

  for (const t of tabel) {
    const { isi, duplikat } = bacaTabel(t, ktx)
    if (!isi.has('soal')) {
      ringkasan.tabelTidakDikenali++
      continue
    }
    if (isi.has('bobot')) adaBobotLabel = true
    const nomorDok = isi.get('no')?.teks ?? ''
    if (/contoh/i.test(nomorDok)) {
      ringkasan.tabelContoh++
      continue
    }
    const semuaKosong = [...isi.entries()]
      .filter(([k]) => k !== 'no')
      .every(([, v]) => kosong(v))
    if (semuaKosong) {
      ringkasan.tabelKosong++
      continue
    }

    const urutan = soal.length + 1
    const galat: string[] = []
    const peringatan: string[] = duplikat.map(d => `Baris "${d.toUpperCase()}" muncul lebih dari sekali; hanya yang pertama dipakai.`)

    const selSoal = isi.get('soal')!
    const gambarSoal = pilihGambar(selSoal, 'Soal', peringatan)
    const opsiBaca = {} as Record<HurufOpsi, OpsiTerbaca>
    for (const h of SEMUA_HURUF) {
      const sel = isi.get(h)
      opsiBaca[h] = {
        teks: sel?.teks ?? '',
        gambar: pilihGambar(sel, `Opsi ${h.toUpperCase()}`, peringatan),
      }
    }
    const selKunci = isi.get('kunci')
    const k = parseKunci(selKunci?.teks ?? '')
    if (k.banyak) galat.push('Kunci berisi lebih dari satu huruf. Isi satu huruf saja.')
    soal.push({
      urutan,
      nomorDokumen: nomorDok,
      teks: selSoal.teks,
      gambarSoal,
      opsi: opsiBaca,
      kunci: k.huruf ?? '',
      pembahasan: isi.get('pembahasan')?.teks ?? '',
      galat,
      peringatan,
    })
  }

  if (soal.length === 0 && adaBobotLabel) {
    peringatanUmum.push('File ini sepertinya template ESSAY (ada baris Bobot). Gunakan template Pilihan Ganda untuk soal PG.')
  }

  // ── Tentukan jumlah opsi paket: ikut paket tujuan kalau sudah ada soalnya,
  // kalau tidak, 5 bila ada opsi E yang terisi di dokumen, selain itu 4.
  const adaE = soal.some(s => s.opsi.e.teks || s.opsi.e.gambar)
  const paksa = opsi?.jumlahOpsiPaksa ?? null
  const jumlahOpsi: 4 | 5 = paksa ?? (adaE ? 5 : 4)

  for (const s of soal) {
    if (!s.teks && !s.gambarSoal) s.galat.push('Soal belum diisi (teks atau gambar).')
    const huruf = SEMUA_HURUF.slice(0, jumlahOpsi)
    const kurang = huruf.filter(h => !s.opsi[h].teks && !s.opsi[h].gambar)
    if (kurang.length > 0) s.galat.push(`Opsi ${kurang.map(h => h.toUpperCase()).join(', ')} belum diisi (teks atau gambar).`)
    if (paksa === 4 && (s.opsi.e.teks || s.opsi.e.gambar)) {
      s.peringatan.push('Opsi E diabaikan karena paket tujuan memakai 4 opsi (A–D).')
    }
    if (!s.kunci) s.galat.push('Kunci jawaban belum diisi.')
    else if (!huruf.map(h => h.toUpperCase()).includes(s.kunci)) {
      s.galat.push(`Kunci "${s.kunci}" tidak sesuai: soal ini punya opsi ${huruf[0].toUpperCase()}–${huruf[huruf.length - 1].toUpperCase()}.`)
    }
  }

  if (soal.length > BATAS_SOAL_PER_IMPOR) {
    peringatanUmum.push(`Maksimal ${BATAS_SOAL_PER_IMPOR} soal per sekali impor (file berisi ${soal.length}). Bagi menjadi beberapa file.`)
  }

  return { jenis: 'pg', soal, jumlahOpsi, ringkasan, peringatanUmum, ambilBytes: buatAmbilBytes(zip) }
}

/** Baca template soal ESSAY. */
export async function bacaDocxEssay(data: ArrayBuffer | Uint8Array, opsi?: OpsiBaca): Promise<HasilBacaEssay> {
  const { zip, rels, tabel } = await bukaDokumen(data, opsi)
  const peringatanUmum: string[] = []
  const ktx: Konteks = { rels, zip, peringatan: peringatanUmum }
  const ringkasan: RingkasanBaca = { tabelTotal: tabel.length, tabelContoh: 0, tabelKosong: 0, tabelTidakDikenali: 0 }
  const soal: SoalEssayTerbaca[] = []
  let adaOpsiLabel = false

  for (const t of tabel) {
    const { isi, duplikat } = bacaTabel(t, ktx)
    if (!isi.has('soal')) {
      ringkasan.tabelTidakDikenali++
      continue
    }
    if (SEMUA_HURUF.some(h => isi.has(h))) adaOpsiLabel = true
    const nomorDok = isi.get('no')?.teks ?? ''
    if (/contoh/i.test(nomorDok)) {
      ringkasan.tabelContoh++
      continue
    }
    if (kosong(isi.get('soal')) && kosong(isi.get('bobot'))) {
      ringkasan.tabelKosong++
      continue
    }

    const galat: string[] = []
    const peringatan: string[] = duplikat.map(d => `Baris "${d.toUpperCase()}" muncul lebih dari sekali; hanya yang pertama dipakai.`)
    const selSoal = isi.get('soal')!
    const gambar = pilihGambar(selSoal, 'Soal', peringatan)
    if (!selSoal.teks && !gambar) galat.push('Soal belum diisi (teks atau gambar).')

    const b = parseBobot(isi.get('bobot')?.teks ?? '')
    let bobot: number | null = null
    if (b === 'salah') galat.push('Bobot harus berupa angka (mis. 10 atau 20).')
    else if (b !== null && b <= 0) galat.push('Bobot harus lebih dari 0.')
    else bobot = b

    soal.push({
      urutan: soal.length + 1,
      nomorDokumen: nomorDok,
      teks: selSoal.teks,
      gambar,
      bobot,
      galat,
      peringatan,
    })
  }

  if (soal.length === 0 && adaOpsiLabel) {
    peringatanUmum.push('File ini sepertinya template PILIHAN GANDA (ada baris opsi A–E). Gunakan template Essay untuk soal essay.')
  }
  if (soal.length > BATAS_SOAL_PER_IMPOR) {
    peringatanUmum.push(`Maksimal ${BATAS_SOAL_PER_IMPOR} soal per sekali impor (file berisi ${soal.length}). Bagi menjadi beberapa file.`)
  }

  return { jenis: 'essay', soal, ringkasan, peringatanUmum, ambilBytes: buatAmbilBytes(zip) }
}
