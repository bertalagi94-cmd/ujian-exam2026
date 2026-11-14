// src/lib/tempel-word.ts
//
// ── TEMPEL (PASTE) DARI WORD: PERTAHANKAN RUMUS ────────────────────────────
// Saat guru menyalin soal dari Word lalu menempelnya ke kolom soal, browser
// biasanya hanya menerima TEKS DATAR (text/plain). Untuk persamaan Word itu
// berarti strukturnya hilang: "−b±√(b²−4ac) / 2a" menjadi kira-kira
// "−b±b2−4ac2a".
//
// Padahal Word juga menaruh versi HTML di clipboard, dan di dalamnya
// persamaan masih lengkap dalam format OMML (di dalam komentar kondisional
// <!--[if gte msEquation 12]> … <![endif]-->). Modul ini membaca OMML itu dan
// mengubahnya dengan konverter YANG SAMA dengan impor template Word
// (src/lib/omml-ke-teks.ts), jadi hasil tempel dan hasil impor konsisten.
//
// Aman bila tidak cocok: kalau HTML clipboard bukan dari Word atau tidak berisi
// persamaan, fungsi mengembalikan null dan alur tempel lama (text/plain) tetap
// dipakai persis seperti sebelumnya.

import { ommlKeTeks, buatKonteksRumus, PESAN_CATATAN_RUMUS } from '@/lib/omml-ke-teks'

export interface HasilTempelWord {
  teks: string
  /** Peringatan tentang rumus yang tampilannya tidak persis sama dengan di Word. */
  catatan: string[]
  jumlahRumus: number
}

const NS_M = 'http://schemas.openxmlformats.org/officeDocument/2006/math'
const NS_W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'

const escHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

const BLOK = new Set([
  'P', 'DIV', 'LI', 'TR', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'BLOCKQUOTE', 'UL', 'OL', 'TABLE', 'SECTION', 'ARTICLE',
])
const LEWATI = new Set(['STYLE', 'SCRIPT', 'HEAD', 'TITLE', 'META', 'LINK', 'XML'])

/** Ubah satu blok OMML (string) menjadi teks. null bila XML-nya tidak bisa dibaca. */
function konversiBlokOmml(xml: string, catatan: Set<string>): string | null {
  try {
    const bersih = xml.replace(/&nbsp;/g, ' ')
    const bungkus = `<akar xmlns:m="${NS_M}" xmlns:w="${NS_W}">${bersih}</akar>`
    const dom = new DOMParser().parseFromString(bungkus, 'application/xml')
    if (dom.getElementsByTagName('parsererror').length > 0) return null
    const ktx = buatKonteksRumus()
    let hasil = ''
    const anak = dom.documentElement.childNodes
    for (let i = 0; i < anak.length; i++) {
      const c = anak[i]
      if (c.nodeType !== 1) continue
      const nama = (c as Element).localName
      if (nama === 'oMath' || nama === 'oMathPara') hasil += (hasil ? ' ' : '') + ommlKeTeks(c, ktx)
    }
    for (const k of ktx.catatan) catatan.add(PESAN_CATATAN_RUMUS[k])
    return hasil.trim()
  } catch {
    return null
  }
}

function jalan(node: Node, out: string[]) {
  if (node.nodeType === 3) {
    out.push((node.nodeValue ?? '').replace(/\s+/g, ' '))
    return
  }
  if (node.nodeType !== 1) return
  const el = node as Element
  const tag = el.tagName.toUpperCase()
  if (LEWATI.has(tag)) return
  if (el.hasAttribute('data-rumus-word')) {
    out.push(el.textContent ?? '')
    return
  }
  if (tag === 'BR') {
    out.push('\n')
    return
  }
  const blok = BLOK.has(tag)
  if (blok) out.push('\n')
  for (let i = 0; i < el.childNodes.length; i++) jalan(el.childNodes[i], out)
  if (blok) out.push('\n')
  else if (tag === 'TD' || tag === 'TH') out.push(' ')
}

/**
 * Baca HTML clipboard dari Word. Mengembalikan null bila tidak ada persamaan
 * Word di dalamnya (supaya pemanggil memakai teks datar seperti biasa).
 */
export function teksDariHtmlWord(htmlAsal: string): HasilTempelWord | null {
  if (!htmlAsal || typeof DOMParser === 'undefined') return null
  if (!/msEquation|<m:oMath/i.test(htmlAsal)) return null

  let html = htmlAsal
  // Hanya bagian yang benar-benar disalin (Word membungkusnya dengan penanda ini).
  const awal = html.indexOf('<!--StartFragment-->')
  const akhir = html.indexOf('<!--EndFragment-->')
  if (awal >= 0 && akhir > awal) html = html.slice(awal + '<!--StartFragment-->'.length, akhir)

  const catatan = new Set<string>()
  let jumlah = 0
  let gagal = false

  // Persamaan + cadangan teks/gambar milik Word (<![if !msEquation]> … <![endif]>).
  html = html.replace(
    /<!--\[if gte msEquation 12\]>([\s\S]*?)<!\[endif\]-->(?:\s*<!\[if !msEquation\]>[\s\S]*?<!\[endif\]>)?/gi,
    (_m, isi: string) => {
      const t = konversiBlokOmml(isi, catatan)
      if (t === null) { gagal = true; return '' }
      jumlah++
      return `<span data-rumus-word="1">${escHtml(t)}</span>`
    }
  )
  // Persamaan tanpa komentar kondisional (kadang terjadi pada versi Word lain).
  html = html.replace(/<m:oMath(?:Para)?[\s>][\s\S]*?<\/m:oMath(?:Para)?>/gi, (blok: string) => {
    const t = konversiBlokOmml(blok, catatan)
    if (t === null) { gagal = true; return '' }
    jumlah++
    return `<span data-rumus-word="1">${escHtml(t)}</span>`
  })

  if (gagal || jumlah === 0) return null

  const dom = new DOMParser().parseFromString(html, 'text/html')
  const out: string[] = []
  jalan(dom.body, out)

  const teks = out
    .join('')
    .replace(/\u00a0/g, ' ')
    .split('\n')
    .map(b => b.replace(/[ \t]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{2,}/g, '\n') // antarparagraf Word = satu baris baru
    .trim()

  if (!teks) return null
  return { teks, catatan: [...catatan], jumlahRumus: jumlah }
}
