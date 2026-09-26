'use client'

// ── Welcome Splash "EXAMFLOW" ────────────────────────────────────────────
// Layar sambutan SEBELUM halaman login dirender. Tiap huruf "EXAMFLOW"
// punya warna sendiri (rainbow arc biru→teal→hijau→kuning→oranye→pink→
// fuchsia→ungu) yang "mekar" bersamaan dengan kemunculannya satu per satu,
// disusul satu sapuan cahaya (shine) melintas di atas judul, lalu progress
// bar tipis mengisi selama sisa waktu tampil. Total durasi di layar = 5
// detik persis (HOLD_MS + FADE_OUT_MS di bawah), lalu fade-out halus
// sebelum halaman login terbuka. Semua ukuran pakai clamp()/vw supaya
// proporsinya tetap pas di HP maupun laptop/komputer.
import { useEffect, useState } from 'react'
import { GraduationCap } from 'lucide-react'

const LETTERS: { ch: string; color: string }[] = [
  { ch: 'E', color: '#38bdf8' }, // sky
  { ch: 'X', color: '#2dd4bf' }, // teal
  { ch: 'A', color: '#a3e635' }, // lime
  { ch: 'M', color: '#fbbf24' }, // amber
  { ch: 'F', color: '#fb923c' }, // orange
  { ch: 'L', color: '#f472b6' }, // pink
  { ch: 'O', color: '#e879f9' }, // fuchsia
  { ch: 'W', color: '#a78bfa' }, // violet
]

const LETTER_START_MS = 200
const LETTER_STAGGER_MS = 120
const LETTER_DURATION_MS = 600

// Total splash tampil = HOLD_MS + FADE_OUT_MS = 5000ms (5 detik persis).
const HOLD_MS = 4400
const FADE_OUT_MS = 600

export default function WelcomeSplash({ onFinish }: { onFinish: () => void }) {
  const [closing, setClosing] = useState(false)

  useEffect(() => {
    const t1 = setTimeout(() => setClosing(true), HOLD_MS)
    const t2 = setTimeout(onFinish, HOLD_MS + FADE_OUT_MS)
    return () => { clearTimeout(t1); clearTimeout(t2) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const lastLetterEnd = LETTER_START_MS + (LETTERS.length - 1) * LETTER_STAGGER_MS + LETTER_DURATION_MS

  return (
    <div
      className={`examflow-splash fixed inset-0 z-[200] flex items-center justify-center overflow-hidden ${closing ? 'examflow-splash-out' : ''}`}
      role="status"
      aria-label="Memuat EXAMFLOW"
    >
      {/* Latar gradasi navy → biru gelap, tenang di belakang huruf berwarna */}
      <div className="absolute inset-0 -z-10" style={{
        background: 'linear-gradient(160deg, #050b1a 0%, #0a1f36 45%, #0b2a42 100%)',
      }} />
      <div className="examflow-grid" aria-hidden="true" />
      <div className="examflow-orb examflow-orb-1" aria-hidden="true" />
      <div className="examflow-orb examflow-orb-2" aria-hidden="true" />
      <div className="absolute inset-0" style={{
        background: 'radial-gradient(ellipse at center, transparent 40%, rgba(2,8,20,0.55) 100%)',
      }} />

      <div className="relative flex flex-col items-center px-6 text-center">
        <div className="examflow-badge-ring mb-5 sm:mb-6 flex items-center justify-center rounded-xl"
          style={{
            width: 'clamp(42px, 7vw, 58px)',
            height: 'clamp(42px, 7vw, 58px)',
            background: 'rgba(56,189,248,0.08)',
          }}
        >
          <GraduationCap
            className="text-sky-100 relative z-10"
            style={{ width: 'clamp(20px, 3.6vw, 28px)', height: 'clamp(20px, 3.6vw, 28px)' }}
          />
        </div>

        {/* Wrapper relatif untuk menaruh sapuan cahaya tepat di atas judul */}
        <div className="relative inline-block">
          <h1
            className="examflow-title font-bold whitespace-nowrap select-none text-center"
            style={{
              fontSize: 'clamp(2rem, 8vw, 4.25rem)',
              letterSpacing: 'clamp(0.05em, 0.9vw, 0.1em)',
            }}
          >
            {LETTERS.map((item, i) => (
              <span
                key={i}
                className="examflow-letter inline-block"
                style={{
                  color: item.color,
                  animationDelay: `${LETTER_START_MS + i * LETTER_STAGGER_MS}ms`,
                }}
              >
                {item.ch}
              </span>
            ))}
          </h1>
          {/* Sapuan cahaya sekali lewat setelah semua huruf selesai muncul */}
          <span
            className="examflow-shine"
            aria-hidden="true"
            style={{ animationDelay: `${lastLetterEnd + 150}ms` }}
          />
        </div>

        <p className="examflow-subtitle mt-3 sm:mt-3.5 text-slate-400 font-medium"
          style={{ fontSize: 'clamp(0.7rem, 1.7vw, 0.85rem)', animationDelay: `${lastLetterEnd + 250}ms` }}
        >
          Sistem Ujian Digital
        </p>

        <div className="examflow-progress-track mt-6 sm:mt-7 overflow-hidden rounded-full"
          style={{ width: 'clamp(96px, 22vw, 160px)', height: 2 }}
        >
          <div
            className="examflow-progress h-full rounded-full"
            style={{ animationDuration: `${HOLD_MS - 150}ms` }}
          />
        </div>
      </div>
    </div>
  )
}
