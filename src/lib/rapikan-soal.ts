// Perapi teks soal saat di-paste (matematika / fisika / kimia).
// Membuang pembungkus \[ \], \( \), $$ $$, menyatukan rumus jadi satu baris,
// dan mengubah LaTeX dasar ke Unicode (^3 -> ³, \frac{a}{b} -> a/b, dst.).
// Teks biasa tanpa tanda rumus dikembalikan apa adanya.

const SUP: Record<string, string> = {
  '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹',
  '+': '⁺', '-': '⁻', '−': '⁻', '=': '⁼', '(': '⁽', ')': '⁾', n: 'ⁿ', i: 'ⁱ',
}
const SUB: Record<string, string> = {
  '0': '₀', '1': '₁', '2': '₂', '3': '₃', '4': '₄', '5': '₅', '6': '₆', '7': '₇', '8': '₈', '9': '₉',
  '+': '₊', '-': '₋', '−': '₋', '=': '₌', '(': '₍', ')': '₎',
  a: 'ₐ', e: 'ₑ', o: 'ₒ', x: 'ₓ', h: 'ₕ', k: 'ₖ', l: 'ₗ', m: 'ₘ', n: 'ₙ', p: 'ₚ', s: 'ₛ', t: 'ₜ',
}

const SIMBOL: Record<string, string> = {
  // huruf Yunani
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', varepsilon: 'ε', zeta: 'ζ', eta: 'η',
  theta: 'θ', vartheta: 'θ', iota: 'ι', kappa: 'κ', lambda: 'λ', mu: 'μ', nu: 'ν', xi: 'ξ', pi: 'π',
  rho: 'ρ', sigma: 'σ', tau: 'τ', upsilon: 'υ', phi: 'φ', varphi: 'φ', chi: 'χ', psi: 'ψ', omega: 'ω',
  Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ', Lambda: 'Λ', Xi: 'Ξ', Pi: 'Π', Sigma: 'Σ', Phi: 'Φ', Psi: 'Ψ', Omega: 'Ω',
  // operator & relasi
  times: '×', div: '÷', cdot: '·', pm: '±', mp: '∓', leq: '≤', le: '≤', geq: '≥', ge: '≥',
  neq: '≠', ne: '≠', approx: '≈', equiv: '≡', cong: '≅', sim: '∼', ll: '≪', gg: '≫', propto: '∝',
  infty: '∞', circ: '°', degree: '°', angle: '∠', perp: '⊥', parallel: '∥', triangle: '△',
  // himpunan & logika
  in: '∈', notin: '∉', subset: '⊂', supset: '⊃', subseteq: '⊆', supseteq: '⊇', cup: '∪', cap: '∩',
  emptyset: '∅', varnothing: '∅', forall: '∀', exists: '∃', neg: '¬', land: '∧', lor: '∨',
  Rightarrow: '⇒', Leftrightarrow: '⇔', rightarrow: '→', to: '→', leftarrow: '←', leftrightarrow: '↔',
  therefore: '∴', because: '∵',
  // kalkulus
  sum: '∑', prod: '∏', int: '∫', oint: '∮', partial: '∂', nabla: '∇',
  ldots: '…', dots: '…', cdots: '⋯',
}

const BB: Record<string, string> = { N: 'ℕ', Z: 'ℤ', Q: 'ℚ', R: 'ℝ', C: 'ℂ' }
// Perintah yang cukup diambil isinya saja.
const BUNGKUS = new Set([
  'text', 'textbf', 'textit', 'mathrm', 'mathbf', 'mathit', 'mathcal', 'mathsf', 'operatorname',
  'mbox', 'boldsymbol', 'overline', 'underline', 'vec', 'hat', 'bar', 'widehat', 'overrightarrow',
])
// Nama fungsi: cukup buang garis miringnya.
const FUNGSI = new Set([
  'sin', 'cos', 'tan', 'cot', 'sec', 'csc', 'arcsin', 'arccos', 'arctan', 'sinh', 'cosh', 'tanh',
  'log', 'ln', 'lim', 'max', 'min', 'exp', 'det', 'sup', 'inf', 'gcd', 'mod',
])

// Isi sederhana = tidak perlu kurung saat dijadikan pembilang/penyebut/akar.
const sederhana = (x: string) => /^[A-Za-z0-9\u00C0-\u024F\u0370-\u03FF\u00B2\u00B3\u00B9\u2070-\u209F.,°]+$/.test(x)
const kurung = (x: string) => (sederhana(x) ? x : `(${x})`)

// Baca satu argumen LaTeX mulai dari indeks i: {...}, \perintah, atau satu karakter.
function bacaArg(s: string, i: number): [string, number] {
  while (s[i] === ' ') i++
  if (i >= s.length) return ['', i]
  if (s[i] === '{') {
    let depth = 0
    for (let j = i; j < s.length; j++) {
      if (s[j] === '{') depth++
      else if (s[j] === '}') {
        depth--
        if (depth === 0) return [s.slice(i + 1, j), j + 1]
      }
    }
    return [s.slice(i + 1), s.length] // kurung kurawal tidak berpasangan
  }
  if (s[i] === '\\') {
    const m = /^\\(?:[A-Za-z]+|.)/.exec(s.slice(i))
    if (m) return [m[0], i + m[0].length]
  }
  return [s[i], i + 1]
}

function konversi(s: string): string {
  let out = ''
  let i = 0
  while (i < s.length) {
    const c = s[i]

    if (c === '\\') {
      const m = /^\\([A-Za-z]+)/.exec(s.slice(i))
      if (!m) {
        // garis miring + simbol: \\  \,  \;  \{  \%  dst.
        const n = s[i + 1] ?? ''
        i += 2
        if (n === '\\') out += ' '
        else if (n === ',' || n === ';' || n === ':' || n === ' ') out += ' '
        else if (n === '!') out += ''
        else if ('{}%$&#_'.includes(n)) out += n
        else if (n === '|') out += '‖'
        else out += '\\' + n
        continue
      }
      const cmd = m[1]
      i += m[0].length

      if (cmd === 'frac' || cmd === 'dfrac' || cmd === 'tfrac') {
        const [a, j] = bacaArg(s, i)
        const [b, k] = bacaArg(s, j)
        i = k
        out += `${kurung(konversi(a))}/${kurung(konversi(b))}`
      } else if (cmd === 'sqrt') {
        let n = ''
        if (s[i] === '[') {
          const end = s.indexOf(']', i)
          if (end > i) { n = s.slice(i + 1, end).trim(); i = end + 1 }
        }
        const [a, j] = bacaArg(s, i)
        i = j
        const akar = n === '' || n === '2' ? '√' : n === '3' ? '∛' : n === '4' ? '∜' : konversi(`^{${n}}`) + '√'
        out += akar + kurung(konversi(a))
      } else if (cmd === 'left' || cmd === 'right') {
        if (s[i] === '.') i++ // \left. / \right. = pembatas kosong
      } else if (cmd === 'mathbb') {
        const [a, j] = bacaArg(s, i)
        i = j
        out += BB[a] ?? a
      } else if (BUNGKUS.has(cmd)) {
        const [a, j] = bacaArg(s, i)
        i = j
        out += konversi(a)
      } else if (cmd === 'quad' || cmd === 'qquad') {
        out += ' '
      } else if (FUNGSI.has(cmd)) {
        out += cmd
      } else if (SIMBOL[cmd] !== undefined) {
        out += SIMBOL[cmd]
      } else {
        // Perintah tak dikenal (mis. \begin{cases}): biarkan utuh.
        out += '\\' + cmd
        if (s[i] === '{') {
          const [a, j] = bacaArg(s, i)
          i = j
          out += `{${konversi(a)}}`
        }
      }
      continue
    }

    if (c === '^' || c === '_') {
      const [arg, j] = bacaArg(s, i + 1)
      i = j
      const a = konversi(arg)
      const peta = c === '^' ? SUP : SUB
      const huruf = Array.from(a)
      if (a === '°') out += '°' // 30^\circ -> 30°
      else if (huruf.length > 0 && huruf.every((h) => peta[h] !== undefined)) out += huruf.map((h) => peta[h]).join('')
      else out += c + kurung(a)
      continue
    }

    if (c === '{' || c === '}') { i++; continue } // kurung kelompok LaTeX

    out += c
    i++
  }
  return out
}

const rapatkan = (x: string) => x.replace(/\s+/g, ' ').trim()
const rumus = (x: string) => konversi(rapatkan(x))

export interface OpsiRapikan {
  /** true untuk kolom satu baris (opsi A–E): semua enter dijadikan spasi. */
  satuBaris?: boolean
}

export function rapikanTeksSoal(asal: string, opsi: OpsiRapikan = {}): string {
  let t = asal
    .replace(/\r\n?/g, '\n')
    .replace(/[\u200b-\u200d\ufeff]/g, '')
    .replace(/\u00a0/g, ' ')

  // 1) Rumus berpembungkus: dijadikan satu baris dan digabung dengan teks sekitarnya.
  const blok = (re: RegExp) => {
    t = t.replace(re, (_m, isi: string) => ` ${rumus(isi)} `)
  }
  blok(/[ \t]*\n?[ \t]*\\\[([\s\S]*?)\\\][ \t]*\n?[ \t]*/g)
  blok(/[ \t]*\n?[ \t]*\$\$([\s\S]*?)\$\$[ \t]*\n?[ \t]*/g)
  blok(/\\\(([\s\S]*?)\\\)/g)
  // $...$ hanya jika isinya jelas rumus (hindari salah kena tulisan harga).
  t = t.replace(/\$([^$\n]+?)\$/g, (m, isi: string) => (/[\\^_{}]/.test(isi) ? rumus(isi) : m))

  // 2) LaTeX tanpa pembungkus (\frac, \times, x^{2}, ...).
  if (/\\[A-Za-z]+|[\^_]\{/.test(t)) t = konversi(t)

  // 3) Potongan pendek yang terpisah per baris (hasil salin rumus yang dirender).
  const baris = t.split('\n').map((b) => b.trim()).filter(Boolean)
  const pendek = baris.filter((b) => b.length <= 3).length
  if (baris.length >= 4 && pendek / baris.length >= 0.75 && baris.join('').length <= 300) {
    t = baris.join('')
  }

  // 4) Rapikan spasi.
  t = t
    .split('\n')
    .map((b) => b.replace(/[ \t]{2,}/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

  return opsi.satuBaris ? rapatkan(t) : t
}
