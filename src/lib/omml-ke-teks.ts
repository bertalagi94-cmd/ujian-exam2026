// src/lib/omml-ke-teks.ts
//
// ── PERSAMAAN WORD (OMML) → TEKS SATU BARIS (Unicode) ──────────────────────
// Dipakai di dua tempat supaya hasilnya SAMA:
//   1. Impor template Word  (src/lib/impor-soal/parser-docx.ts)
//   2. Tempel (paste) dari Word ke kolom soal  (src/lib/tempel-word.ts)
//
// Aplikasi menyimpan soal sebagai teks biasa, jadi rumus bertingkat tidak
// bisa tampil persis seperti di Word. Tujuan modul ini: hasilnya TIDAK
// MENYESATKAN. Struktur yang dulu hilang diam-diam (matriks jadi "1234",
// sistem persamaan menyatu, vektor/garis atas hilang, "sinx" tanpa spasi)
// sekarang ditulis dengan notasi satu baris yang lazim, dan bagian yang
// tampilannya tetap berbeda dari Word dilaporkan lewat `catatan` supaya guru
// bisa memeriksanya di pratinjau (atau memakai gambar).
//
// Hanya memakai API DOM dasar (childNodes, localName, attributes), jadi juga
// jalan di Node untuk pengujian.

type N = Element

/** Jenis catatan yang bisa muncul → dipetakan ke kalimat peringatan di bawah. */
export type JenisCatatanRumus = 'matriks' | 'sistem' | 'aksen' | 'binom' | 'bertumpuk'

export const PESAN_CATATAN_RUMUS: Record<JenisCatatanRumus, string> = {
  matriks:
    'Ada matriks/determinan yang diubah menjadi satu baris, mis. [1, 2; 3, 4] (baris dipisah titik koma). Periksa di pratinjau; untuk tampilan persis seperti di Word, sisipkan sebagai gambar.',
  sistem:
    'Ada sistem persamaan yang ditulis berderet dipisah titik koma. Periksa di pratinjau; untuk tampilan bersusun seperti di Word, sisipkan sebagai gambar.',
  aksen:
    'Ada tanda di atas/bawah huruf (vektor, garis atas, topi) yang ditulis dengan karakter gabungan. Tampilannya bisa berbeda antar perangkat; periksa di pratinjau.',
  binom:
    'Ada rumus kombinasi/binomial (dua angka bertumpuk tanpa garis) yang ditulis C(n, r). Pastikan maksudnya sesuai.',
  bertumpuk:
    'Ada rumus yang bertumpuk (mis. limit dengan batas di bawah/atas) yang ditulis satu baris. Periksa di pratinjau.',
}

export interface KonteksRumus {
  catatan: Set<JenisCatatanRumus>
}

export function buatKonteksRumus(): KonteksRumus {
  return { catatan: new Set() }
}

// ───────────────────────── helper DOM ─────────────────────────

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

// ───────────────────────── Unicode naik/turun ─────────────────────────

const SUP: Record<string, string> = {
  '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹',
  '+': '⁺', '-': '⁻', '−': '⁻', '=': '⁼', '(': '⁽', ')': '⁾', n: 'ⁿ', i: 'ⁱ',
}
const SUB: Record<string, string> = {
  '0': '₀', '1': '₁', '2': '₂', '3': '₃', '4': '₄', '5': '₅', '6': '₆', '7': '₇', '8': '₈', '9': '₉',
  '+': '₊', '-': '₋', '−': '₋', '=': '₌', '(': '₍', ')': '₎',
  a: 'ₐ', e: 'ₑ', o: 'ₒ', x: 'ₓ', h: 'ₕ', k: 'ₖ', l: 'ₗ', m: 'ₘ', n: 'ₙ', p: 'ₚ', s: 'ₛ', t: 'ₜ',
}

/** Kembalikan null bila ada karakter yang tidak punya padanan Unicode. */
function coba(teks: string, peta: Record<string, string>): string | null {
  let out = ''
  for (const ch of teks) {
    const m = peta[ch]
    if (!m) return null
    out += m
  }
  return out
}

const huruf = (s: string) => Array.from(s)

// Isi "sederhana" = tidak perlu kurung saat jadi pembilang/penyebut/akar/batas.
const sederhana = (s: string) => /^[\p{L}\p{N}\p{M}.,°]+$/u.test(s)
const kurung = (s: string) => (sederhana(s) ? s : `(${s})`)

/** Pangkat/indeks. Bila salah satu sisi tidak bisa jadi Unicode, pakai ^(..) / _(..). */
function pangkat(teks: string, mode: 'sup' | 'sub', paksaNotasi = false): string {
  const t = teks.trim()
  if (!t) return ''
  if (!paksaNotasi) {
    const u = coba(t, mode === 'sup' ? SUP : SUB)
    if (u !== null) return u
  }
  // Satu huruf/angka boleh tanpa kurung (x^a); dua karakter atau lebih diberi
  // kurung supaya tidak ambigu (e^(2x), bukan e^2x).
  const isi = huruf(t).length === 1 && sederhana(t) ? t : `(${t})`
  return mode === 'sup' ? `^${isi}` : `_${isi}`
}

// ───────────────────────── aksen ─────────────────────────

const AKSEN: Record<string, string> = {
  '\u0302': '\u0302', '^': '\u0302', 'ˆ': '\u0302',
  '\u0303': '\u0303', '~': '\u0303', '˜': '\u0303',
  '\u0304': '\u0304', '¯': '\u0304', '‾': '\u0304', '\u0305': '\u0305',
  '\u0307': '\u0307', '˙': '\u0307',
  '\u0308': '\u0308', '¨': '\u0308',
  '\u0301': '\u0301', '´': '\u0301',
  '\u0300': '\u0300', '`': '\u0300',
  '\u030c': '\u030c', 'ˇ': '\u030c',
  '\u0306': '\u0306', '˘': '\u0306',
  '\u20d7': '\u20d7', '→': '\u20d7',
  '\u20d6': '\u20d6', '←': '\u20d6',
  '\u20e1': '\u20e1', '↔': '\u20e1',
}

function beriAksen(dasar: string, chr: string | null, ktx: KonteksRumus): string {
  if (!dasar) return ''
  const kunci = chr === null || chr === '' ? '\u0302' : chr
  const tanda = AKSEN[kunci] ?? (kunci.length === 1 && /\p{M}/u.test(kunci) ? kunci : null)
  if (!tanda) return dasar // lambang aneh: jangan merusak isinya
  ktx.catatan.add('aksen')
  const h = huruf(dasar)
  // Garis atas: terapkan ke tiap huruf supaya garisnya menyambung.
  if (tanda === '\u0304' || tanda === '\u0305') return h.map(c => (/\s/.test(c) ? c : c + '\u0305')).join('')
  // Satu huruf: tanda tepat di atasnya. Beberapa huruf: tanda di huruf terakhir.
  return dasar + tanda
}

// ───────────────────────── konversi utama ─────────────────────────

const INVISIBLE = /[\u2061-\u2064\u200b-\u200d\ufeff]/g

function nilaiAttr(pr: N | undefined, k: string, def: string | null): string | null {
  if (!pr) return def
  const el = anakNamed(pr, k)[0]
  if (!el) return def
  const v = attrLocal(el, 'val')
  return v === null || v === undefined ? def : v
}

function gabungFungsi(nama: string, isi: string): string {
  if (!nama) return isi
  if (!isi) return nama
  // sin x, log₂ x, lim_(x→0) f(x): beri spasi, kecuali argumen langsung berkurung.
  // Nama yang berakhir kurung (mis. lim_(x→0)) tetap diberi spasi sebelum badan.
  return isi.startsWith('(') && !nama.endsWith(')') ? nama + isi : `${nama} ${isi}`
}

function sisipSpasiBadan(kepala: string, badan: string): string {
  if (!badan) return kepala
  return badan.startsWith('(') ? kepala + badan : `${kepala} ${badan}`
}

export function ommlKeTeks(n: Node, ktx: KonteksRumus = buatKonteksRumus()): string {
  const nama = ln(n)
  // Semua elemen properti (rPr, fPr, dPr, sSupPr, ...) tidak berisi teks.
  if (/Pr$/.test(nama)) return ''
  const sub = (k: string) => anakNamed(n as N, k).map(c => ommlKeTeks(c, ktx)).join('')
  const semua = () => anak(n).map(c => ommlKeTeks(c, ktx)).join('')

  switch (nama) {
    case 't':
      // Word menyisipkan karakter tak terlihat (⁡ ⁢ ⁣ ⁤) di sekitar fungsi/perkalian.
      return (n.textContent ?? '').replace(INVISIBLE, '')

    case 'oMathPara': {
      const bagian = anakNamed(n as N, 'oMath').map(c => ommlKeTeks(c, ktx)).filter(Boolean)
      return bagian.length ? bagian.join(' ') : semua()
    }

    case 'sSup':
      return sub('e') + pangkat(sub('sup'), 'sup')
    case 'sSub':
      return sub('e') + pangkat(sub('sub'), 'sub')
    case 'sSubSup': {
      const bawah = sub('sub')
      const atas = sub('sup')
      // Bila salah satu sisi butuh notasi ^( ) / _( ), pakai notasi untuk keduanya
      // supaya tidak tercampur (mis. x_(i)² yang ambigu).
      const adaNotasi = (!!bawah.trim() && coba(bawah.trim(), SUB) === null) || (!!atas.trim() && coba(atas.trim(), SUP) === null)
      return sub('e') + pangkat(bawah, 'sub', adaNotasi) + pangkat(atas, 'sup', adaNotasi)
    }
    case 'sPre': {
      // Awalan: isotop kimia ¹⁴₆C. Urutan di XML: sub, sup, e.
      const bawah = sub('sub')
      const atas = sub('sup')
      return pangkat(atas, 'sup') + pangkat(bawah, 'sub') + sub('e')
    }

    case 'f': {
      const a = sub('num')
      const b = sub('den')
      const tipe = nilaiAttr(anakNamed(n as N, 'fPr')[0], 'type', 'bar')
      if (tipe === 'noBar') {
        ktx.catatan.add('binom')
        return `C(${a}, ${b})`
      }
      return `${kurung(a)}/${kurung(b)}`
    }

    case 'rad': {
      const deg = sub('deg').trim()
      const tersembunyi = nilaiAttr(anakNamed(n as N, 'radPr')[0], 'degHide', null)
      const e = sub('e')
      const isi = sederhana(e) ? e : `(${e})`
      if (!deg || tersembunyi === '1' || tersembunyi === 'on' || tersembunyi === 'true' || deg === '2') return `√${isi}`
      if (deg === '3') return `∛${isi}`
      if (deg === '4') return `∜${isi}`
      return `${pangkat(deg, 'sup')}√${isi}`
    }

    case 'nary': {
      const pr = anakNamed(n as N, 'naryPr')[0]
      const simbol = nilaiAttr(pr, 'chr', '∫') ?? '∫'
      const batas = (op: string, x: string) => (x.trim() ? op + kurung(x.trim()) : '')
      const kepala = `${simbol}${batas('_', sub('sub'))}${batas('^', sub('sup'))}`
      return sisipSpasiBadan(kepala, sub('e'))
    }

    case 'd': {
      const pr = anakNamed(n as N, 'dPr')[0]
      const buka = nilaiAttr(pr, 'begChr', '(') ?? ''
      const tutup = nilaiAttr(pr, 'endChr', ')') ?? ''
      const pisah = nilaiAttr(pr, 'sepChr', '|') ?? ''
      const dalam = anakNamed(n as N, 'e').map(c => ommlKeTeks(c, ktx)).join(pisah)
      // Kombinasi C(n, r) sudah berkurung sendiri: jangan dobel.
      if (buka === '(' && tutup === ')' && /^C\(.*\)$/.test(dalam)) return dalam
      return buka + dalam + tutup
    }

    case 'func':
      return gabungFungsi(sub('fName'), sub('e'))

    case 'limLow': {
      const lim = sub('lim').trim()
      ktx.catatan.add('bertumpuk')
      return sub('e') + (lim ? `_${kurung(lim)}` : '')
    }
    case 'limUpp': {
      const lim = sub('lim').trim()
      ktx.catatan.add('bertumpuk')
      return sub('e') + (lim ? `^${kurung(lim)}` : '')
    }

    case 'm': {
      ktx.catatan.add('matriks')
      const baris = anakNamed(n as N, 'mr').map(mr =>
        anakNamed(mr, 'e').map(c => ommlKeTeks(c, ktx).trim()).join(', ')
      )
      return baris.join('; ')
    }

    case 'eqArr': {
      ktx.catatan.add('sistem')
      const baris = anakNamed(n as N, 'e')
        .map(c => ommlKeTeks(c, ktx).replace(/&/g, '').trim())
        .filter(Boolean)
      return baris.join('; ')
    }

    case 'acc': {
      const chr = nilaiAttr(anakNamed(n as N, 'accPr')[0], 'chr', null)
      return beriAksen(sub('e'), chr, ktx)
    }

    case 'bar': {
      const pos = nilaiAttr(anakNamed(n as N, 'barPr')[0], 'pos', 'top')
      const e = sub('e')
      ktx.catatan.add('aksen')
      const tanda = pos === 'bot' ? '\u0332' : '\u0305'
      return huruf(e).map(c => (/\s/.test(c) ? c : c + tanda)).join('')
    }

    case 'phant':
      return '' // elemen tak terlihat (hanya pengatur jarak)

    case 'r':
      // Teks di dalam run matematika; abaikan properti, ambil <m:t>.
      return anakNamed(n as N, 't').map(c => ommlKeTeks(c, ktx)).join('')

    default:
      // borderBox, box, groupChr, oMath, e, num, den, … : ambil isinya saja.
      return semua()
  }
}
