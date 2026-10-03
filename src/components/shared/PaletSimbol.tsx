'use client'

// Palet simbol untuk pembuatan soal (matematika, fisika, kimia/IPAS).
//
// CARA PAKAI: taruh <PaletSimbol /> di dalam <form> soal. Komponen ini
// melacak kolom teks yang terakhir difokuskan di form itu (teks pertanyaan,
// opsi A–E, pembahasan) lalu menyisipkan simbol di posisi kursor kolom tsb.
//
// KENAPA UNICODE, BUKAN LaTeX: simbol disimpan sebagai karakter biasa di
// kolom teks yang sudah ada. Tidak ada perubahan skema DB, tidak ada library
// render tambahan, layar ujian siswa tidak perlu diubah, dan otomatis jalan
// offline (tidak ada font/JS tambahan yang harus di-cache). Batasnya:
// pecahan bertingkat & akar panjang ditulis satu baris, mis. (a+b)/c.
//
// DESAIN UNTUK HP:
//  - Tombol simbol mencegah perpindahan fokus (onMouseDown preventDefault),
//    jadi keyboard HP tidak menutup dan kursor tidak hilang.
//  - Di layar kecil panel menjadi lembar di bawah layar yang mengikuti
//    tinggi keyboard (visualViewport); di layar lebar panel tampil sejajar
//    di atas form.
//
// Form soal memakai input tak terkontrol (name= + defaultValue), jadi nilai
// ditulis lewat setter native + event 'input' (aman juga bila suatu saat
// kolomnya berubah jadi controlled).

import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Sigma, X } from 'lucide-react'

interface Simbol {
  s: string
  n: string
  lebar?: boolean
}

interface Kategori {
  id: string
  label: string
  items: Simbol[]
}

const NAMA: Record<string, string> = {
  '√': 'akar kuadrat', '∛': 'akar pangkat tiga', '∜': 'akar pangkat empat', '∞': 'tak hingga',
  '∑': 'sigma (jumlah)', '∏': 'perkalian deret', '∫': 'integral', '∮': 'integral lintasan tertutup',
  '∂': 'turunan parsial', '∇': 'nabla', '±': 'plus minus', '∓': 'minus plus', '×': 'kali', '÷': 'bagi',
  '·': 'titik (kali)', '−': 'minus', '≠': 'tidak sama dengan', '≈': 'hampir sama dengan', '≡': 'identik',
  '≅': 'kongruen', '∼': 'sebanding / sebangun', '≤': 'kurang dari atau sama dengan',
  '≥': 'lebih dari atau sama dengan', '≪': 'jauh lebih kecil', '≫': 'jauh lebih besar',
  '°': 'derajat', '′': 'menit busur / aksen', '″': 'detik busur', '‰': 'per mil', '∠': 'sudut',
  '⊥': 'tegak lurus', '∥': 'sejajar', '△': 'segitiga', '∈': 'elemen', '∉': 'bukan elemen',
  '⊂': 'himpunan bagian', '⊃': 'superset', '⊆': 'himpunan bagian atau sama', '⊇': 'superset atau sama',
  '∪': 'gabungan', '∩': 'irisan', '∅': 'himpunan kosong', '∀': 'untuk semua', '∃': 'terdapat',
  '¬': 'negasi', '∧': 'dan', '∨': 'atau', '⇒': 'maka', '⇔': 'jika dan hanya jika', '→': 'panah kanan',
  '←': 'panah kiri', '↔': 'panah dua arah', '↑': 'panah atas', '↓': 'panah bawah', '⇌': 'reaksi setimbang',
  '∴': 'oleh karena itu', '∵': 'karena', 'ℕ': 'bilangan asli', 'ℤ': 'bilangan bulat',
  'ℚ': 'bilangan rasional', 'ℝ': 'bilangan real', 'ℂ': 'bilangan kompleks',
  '⌊': 'pembulatan bawah kiri', '⌋': 'pembulatan bawah kanan', '⌈': 'pembulatan atas kiri', '⌉': 'pembulatan atas kanan',
  '∝': 'sebanding dengan', 'ℓ': 'l kecil (panjang)', 'ħ': 'h-bar', 'Å': 'angstrom', 'µ': 'mikro',
  '♂': 'jantan / laki-laki', '♀': 'betina / perempuan',
  'π': 'pi', 'Δ': 'delta (perubahan)', 'Ω': 'omega besar / ohm', '%': 'persen', '=': 'sama dengan',
  '<': 'kurang dari', '>': 'lebih dari', '⁺': 'pangkat plus', '⁻': 'pangkat minus', '₊': 'indeks plus', '₋': 'indeks minus',
  '½': 'setengah', '¼': 'seperempat', '¾': 'tiga perempat', '⅓': 'sepertiga', '⅔': 'dua pertiga',
}

function dariDaftar(daftar: string): Simbol[] {
  return daftar.split(' ').filter(Boolean).map((c) => ({ s: c, n: NAMA[c] ?? c }))
}

const YUNANI_KECIL = 'α β γ δ ε ζ η θ ι κ λ μ ν ξ ο π ρ σ τ υ φ χ ψ ω'.split(' ')
const YUNANI_NAMA = 'alfa beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi omikron pi rho sigma tau upsilon phi chi psi omega'.split(' ')
const YUNANI_BESAR = 'Γ Δ Θ Λ Ξ Π Σ Φ Ψ Ω'.split(' ')
const YUNANI_BESAR_NAMA = 'gamma delta theta lambda xi pi sigma phi psi omega'.split(' ')

const ITEMS_YUNANI: Simbol[] = [
  ...YUNANI_KECIL.map((c, i) => ({ s: c, n: YUNANI_NAMA[i] })),
  ...YUNANI_BESAR.map((c, i) => ({ s: c, n: `${YUNANI_BESAR_NAMA[i]} besar` })),
]

function snippet(daftar: string): Simbol[] {
  return daftar.split(' ').filter(Boolean).map((c) => ({ s: c, n: c, lebar: true }))
}

const KATEGORI: Kategori[] = [
  {
    id: 'mat',
    label: 'Matematika',
    items: dariDaftar(
      '× ÷ ± ∓ · − = ≠ ≈ ≡ ≅ ∼ ≤ ≥ < > ≪ ≫ √ ∛ ∜ ∞ π ∑ ∏ ∫ ∮ ∂ ∇ ° ′ ″ % ‰ ' +
      '∠ ⊥ ∥ △ ∈ ∉ ⊂ ⊃ ⊆ ⊇ ∪ ∩ ∅ ∀ ∃ ¬ ∧ ∨ ⇒ ⇔ → ← ↔ ∴ ∵ ℕ ℤ ℚ ℝ ℂ ⌊ ⌋ ⌈ ⌉ ' +
      '½ ⅓ ⅔ ¼ ¾ ⅕ ⅖ ⅗ ⅘ ⅙ ⅚ ⅛ ⅜ ⅝ ⅞'
    ),
  },
  {
    id: 'pi',
    label: 'Pangkat & Indeks',
    items: dariDaftar(
      '⁰ ¹ ² ³ ⁴ ⁵ ⁶ ⁷ ⁸ ⁹ ⁺ ⁻ ⁼ ⁽ ⁾ ⁿ ⁱ ' +
      '₀ ₁ ₂ ₃ ₄ ₅ ₆ ₇ ₈ ₉ ₊ ₋ ₌ ₍ ₎ ₙ ₓ ₐ ₘ'
    ),
  },
  { id: 'yun', label: 'Huruf Yunani', items: ITEMS_YUNANI },
  {
    id: 'fis',
    label: 'Fisika',
    items: [
      ...dariDaftar('Δ ∝ ≈ ± × · ∥ ⊥ → ← ↑ ↓ ↔ ° ℓ ħ Å µ Ω ∞ √ ≤ ≥'),
      ...snippet('m/s m/s² km/jam kg·m/s N/m² N·m W/m² J/(kg·K) m³ cm³ °C'),
    ],
  },
  {
    id: 'kim',
    label: 'Kimia & IPAS',
    items: [
      ...dariDaftar('→ ⇌ ↑ ↓ ⁺ ⁻ ²⁺ ³⁺ ²⁻ ♂ ♀ ° ‰ µ ≈ Δ'),
      ...snippet('H₂O CO₂ O₂ H₂ N₂ NH₃ CH₄ HCl NaOH NaCl H₂SO₄ CaCO₃ C₆H₁₂O₆ °C'),
    ],
  },
]

// Pemetaan untuk tombol "jadikan pangkat / indeks" pada teks yang diblok.
const PANGKAT: Record<string, string> = {
  '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹',
  '+': '⁺', '-': '⁻', '−': '⁻', '=': '⁼', '(': '⁽', ')': '⁾', n: 'ⁿ', i: 'ⁱ',
}
const INDEKS: Record<string, string> = {
  '0': '₀', '1': '₁', '2': '₂', '3': '₃', '4': '₄', '5': '₅', '6': '₆', '7': '₇', '8': '₈', '9': '₉',
  '+': '₊', '-': '₋', '−': '₋', '=': '₌', '(': '₍', ')': '₎',
  a: 'ₐ', n: 'ₙ', x: 'ₓ', m: 'ₘ',
}

type KolomTeks = HTMLInputElement | HTMLTextAreaElement

function bisaDiisi(t: EventTarget | null): t is KolomTeks {
  if (t instanceof HTMLTextAreaElement) return !t.readOnly && !t.disabled
  if (t instanceof HTMLInputElement) return t.type === 'text' && !t.readOnly && !t.disabled
  return false
}

function labelKolom(el: KolomTeks): string {
  const nama = el.name || ''
  if (nama === 'teks') return 'Teks pertanyaan'
  if (nama === 'pembahasan') return 'Pembahasan'
  const m = /^opsi_([a-e])$/.exec(nama)
  if (m) return `Opsi ${m[1].toUpperCase()}`
  return nama || 'kolom ini'
}

function tulisNilai(el: KolomTeks, nilai: string) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set
  if (setter) setter.call(el, nilai)
  else el.value = nilai
  el.dispatchEvent(new Event('input', { bubbles: true }))
}

export function PaletSimbol({ className = '' }: { className?: string }) {
  const akarRef = useRef<HTMLDivElement>(null)
  const formRef = useRef<HTMLFormElement | null>(null)
  const terakhirRef = useRef<KolomTeks | null>(null)
  // true bila kolom target pernah benar-benar difokuskan guru (kursornya bermakna).
  // false bila kita memilih kolom bawaan sendiri -> sisipkan di akhir, bukan di posisi 0.
  const dariFokusRef = useRef(false)

  const [terbuka, setTerbuka] = useState(false)
  const [kategoriId, setKategoriId] = useState('mat')
  const [targetLabel, setTargetLabel] = useState('Teks pertanyaan')
  const [pesan, setPesan] = useState('')
  const [layarKecil, setLayarKecil] = useState(false)
  const [geserKeyboard, setGeserKeyboard] = useState(0)

  // Lacak kolom teks terakhir yang difokuskan di form pemilik komponen ini.
  useEffect(() => {
    const form = akarRef.current?.closest('form') ?? null
    formRef.current = form
    if (!form) return
    const onFocusIn = (e: FocusEvent) => {
      if (bisaDiisi(e.target)) {
        terakhirRef.current = e.target
        dariFokusRef.current = true
        setTargetLabel(labelKolom(e.target))
        setPesan('')
      }
    }
    form.addEventListener('focusin', onFocusIn)
    return () => form.removeEventListener('focusin', onFocusIn)
  }, [])

  // Deteksi layar kecil (lembar bawah) vs layar lebar (panel sejajar).
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 639px)')
    const update = () => setLayarKecil(mq.matches)
    update()
    mq.addEventListener('change', update)
    return () => mq.removeEventListener('change', update)
  }, [])

  // Di HP: angkat lembar mengikuti tinggi keyboard virtual.
  useEffect(() => {
    if (!terbuka || !layarKecil) { setGeserKeyboard(0); return }
    const vv = window.visualViewport
    if (!vv) return
    const update = () => setGeserKeyboard(Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop)))
    update()
    vv.addEventListener('resize', update)
    vv.addEventListener('scroll', update)
    return () => {
      vv.removeEventListener('resize', update)
      vv.removeEventListener('scroll', update)
    }
  }, [terbuka, layarKecil])

  useEffect(() => {
    if (!terbuka) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setTerbuka(false) }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [terbuka])

  const ambilTarget = useCallback((): KolomTeks | null => {
    const terakhir = terakhirRef.current
    if (terakhir && terakhir.isConnected) return terakhir
    const form = formRef.current
    if (!form) return null
    const bawaan =
      form.querySelector<HTMLTextAreaElement>('textarea[name="teks"]') ??
      form.querySelector<HTMLTextAreaElement>('textarea') ??
      form.querySelector<HTMLInputElement>('input[type="text"]')
    if (bawaan) {
      terakhirRef.current = bawaan
      dariFokusRef.current = false
      setTargetLabel(labelKolom(bawaan))
    }
    return bawaan
  }, [])

  const sisipkan = useCallback((teks: string) => {
    const el = ambilTarget()
    if (!el) return
    const pakaiKursor = dariFokusRef.current || document.activeElement === el
    const awal = pakaiKursor ? (el.selectionStart ?? el.value.length) : el.value.length
    const akhir = pakaiKursor ? (el.selectionEnd ?? awal) : awal
    tulisNilai(el, el.value.slice(0, awal) + teks + el.value.slice(akhir))
    const pos = awal + teks.length
    try {
      el.focus({ preventScroll: true })
      el.setSelectionRange(pos, pos)
    } catch { /* abaikan: sebagian tipe input tidak mendukung selection */ }
    setPesan('')
  }, [ambilTarget])

  const ubahPilihan = useCallback((peta: Record<string, string>, nama: string) => {
    const el = ambilTarget()
    if (!el) return
    const awal = el.selectionStart ?? 0
    const akhir = el.selectionEnd ?? 0
    if (awal === akhir) {
      setPesan(`Blok dulu teks yang ingin dijadikan ${nama}, lalu tekan tombol ini.`)
      return
    }
    const asal = el.value.slice(awal, akhir)
    let tidakTerubah = 0
    const hasil = Array.from(asal).map((c) => {
      const p = peta[c]
      if (p === undefined) { if (c.trim() !== '') tidakTerubah++; return c }
      return p
    }).join('')
    tulisNilai(el, el.value.slice(0, awal) + hasil + el.value.slice(akhir))
    try {
      el.focus({ preventScroll: true })
      el.setSelectionRange(awal, awal + hasil.length)
    } catch { /* abaikan */ }
    setPesan(tidakTerubah > 0 ? `${tidakTerubah} karakter tidak punya bentuk ${nama} dan dibiarkan apa adanya.` : '')
  }, [ambilTarget])

  const kategori = KATEGORI.find((k) => k.id === kategoriId) ?? KATEGORI[0]

  // Cegah tombol mengambil fokus dari kolom teks (menjaga keyboard HP & kursor).
  const jagaFokus = (e: React.MouseEvent | React.PointerEvent) => e.preventDefault()

  const panel = (
    <div
      className={
        layarKecil
          ? 'fixed inset-x-0 z-[70] bg-white border-t border-slate-200 rounded-t-2xl shadow-card-lg'
          : 'bg-white border border-slate-200 rounded-xl shadow-card mt-2'
      }
      style={layarKecil ? { bottom: geserKeyboard } : undefined}
      role="region"
      aria-label="Palet simbol"
      onMouseDown={jagaFokus}
    >
      <div className="flex items-center gap-1 px-2 pt-2">
        <div className="flex-1 flex gap-1 overflow-x-auto" role="tablist">
          {KATEGORI.map((k) => (
            <button
              key={k.id}
              type="button"
              role="tab"
              aria-selected={k.id === kategoriId}
              onMouseDown={jagaFokus}
              onClick={() => setKategoriId(k.id)}
              className={`whitespace-nowrap px-3 py-1.5 rounded-lg text-xs font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ${
                k.id === kategoriId ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              {k.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          onMouseDown={jagaFokus}
          onClick={() => setTerbuka(false)}
          className="btn-ghost btn-icon btn-sm flex-shrink-0"
          aria-label="Tutup palet simbol"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <p className="px-3 pt-2 text-xs text-slate-500">
        Simbol masuk ke: <span className="font-medium text-slate-700">{targetLabel}</span>
      </p>

      <div className={`p-2 overflow-y-auto ${layarKecil ? 'max-h-[34vh]' : 'max-h-56'}`}>
        {kategori.id === 'pi' && (
          <div className="flex flex-wrap gap-2 mb-2">
            <button type="button" onMouseDown={jagaFokus} onClick={() => ubahPilihan(PANGKAT, 'pangkat')}
              className="btn-secondary btn-sm">Jadikan pangkat (x²)</button>
            <button type="button" onMouseDown={jagaFokus} onClick={() => ubahPilihan(INDEKS, 'indeks')}
              className="btn-secondary btn-sm">Jadikan indeks (H₂O)</button>
          </div>
        )}
        <div className="flex flex-wrap gap-1">
          {kategori.items.map((it, i) => (
            <button
              key={`${it.s}-${i}`}
              type="button"
              title={it.n}
              aria-label={it.n}
              onMouseDown={jagaFokus}
              onClick={() => sisipkan(it.s)}
              className={`h-10 ${it.lebar ? 'px-3' : 'min-w-[2.5rem] px-1'} rounded-lg border border-slate-200 bg-white text-base text-slate-800 hover:bg-brand-50 hover:border-brand-300 active:bg-brand-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500`}
            >
              {it.s}
            </button>
          ))}
        </div>
      </div>

      {pesan && <p className="px-3 pb-2 text-xs text-amber-600" role="status">{pesan}</p>}
    </div>
  )

  return (
    <div ref={akarRef} className={className}>
      <button
        type="button"
        onMouseDown={jagaFokus}
        onClick={() => { ambilTarget(); setTerbuka((v) => !v) }}
        aria-expanded={terbuka}
        className={terbuka ? 'btn-primary btn-sm' : 'btn-secondary btn-sm'}
      >
        <Sigma className="w-3.5 h-3.5" /> Simbol
      </button>
      {terbuka && (layarKecil ? createPortal(panel, document.body) : panel)}
      {/* Ruang kosong agar isi form paling bawah tetap bisa digulir ke atas lembar. */}
      {terbuka && layarKecil && <div aria-hidden style={{ height: '46vh' }} />}
    </div>
  )
}
