'use client'

// ── Welcome Splash "Smart Exam CBT" ────────────────────────────────────────────
// Layar sambutan SEBELUM halaman login dirender. Tiap huruf "Smart Exam CBT"
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
  { ch: 'S', color: '#38bdf8' }, // sky
  { ch: 'm', color: '#22d3ee' }, // cyan
  { ch: 'a', color: '#2dd4bf' }, // teal
  { ch: 'r', color: '#4ade80' }, // green
  { ch: 't', color: '#a3e635' }, // lime
  { ch: ' ', color: '#ffffff' }, // spasi
  { ch: 'E', color: '#fbbf24' }, // amber
  { ch: 'x', color: '#fb923c' }, // orange
  { ch: 'a', color: '#fb7185' }, // rose
  { ch: 'm', color: '#f472b6' }, // pink
  { ch: ' ', color: '#ffffff' }, // spasi
  { ch: 'C', color: '#e879f9' }, // fuchsia
  { ch: 'B', color: '#c084fc' }, // purple
  { ch: 'T', color: '#a78bfa' }, // violet
]

const LETTER_START_MS = 200
const LETTER_STAGGER_MS = 90
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
      className={`smartexam-splash fixed inset-0 z-[200] flex items-center justify-center overflow-hidden ${closing ? 'smartexam-splash-out' : ''}`}
      role="status"
      aria-label="Memuat Smart Exam CBT"
    >
      {/* Latar gradasi navy → biru gelap, tenang di belakang huruf berwarna */}
      <div className="absolute inset-0 -z-10" style={{
        background: 'linear-gradient(160deg, #050b1a 0%, #0a1f36 45%, #0b2a42 100%)',
      }} />
      <div className="smartexam-grid" aria-hidden="true" />
      <div className="smartexam-orb smartexam-orb-1" aria-hidden="true" />
      <div className="smartexam-orb smartexam-orb-2" aria-hidden="true" />
      <div className="absolute inset-0" style={{
        background: 'radial-gradient(ellipse at center, transparent 40%, rgba(2,8,20,0.55) 100%)',
      }} />

      <div className="relative flex flex-col items-center px-6 text-center">
        <div className="smartexam-badge-ring mb-5 sm:mb-6 flex items-center justify-center rounded-xl"
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
            className="smartexam-title font-bold whitespace-nowrap select-none text-center"
            style={{
              fontSize: 'clamp(1.6rem, 6.4vw, 3.6rem)',
              letterSpacing: 'clamp(0.03em, 0.6vw, 0.07em)',
            }}
          >
            {LETTERS.map((item, i) => (
              <span
                key={i}
                className="smartexam-letter inline-block"
                style={{
                  color: item.color,
                  animationDelay: `${LETTER_START_MS + i * LETTER_STAGGER_MS}ms`,
                }}
              >
                {item.ch === ' ' ? '\u00A0' : item.ch}
              </span>
            ))}
          </h1>
          {/* Sapuan cahaya sekali lewat setelah semua huruf selesai muncul */}
          <span
            className="smartexam-shine"
            aria-hidden="true"
            style={{ animationDelay: `${lastLetterEnd + 150}ms` }}
          />
        </div>

        <p className="smartexam-subtitle mt-3 sm:mt-3.5 text-slate-400 font-medium"
          style={{ fontSize: 'clamp(0.7rem, 1.7vw, 0.85rem)', animationDelay: `${lastLetterEnd + 250}ms` }}
        >
          Sistem Ujian Digital
        </p>

        <div className="smartexam-progress-track mt-6 sm:mt-7 overflow-hidden rounded-full"
          style={{ width: 'clamp(96px, 22vw, 160px)', height: 2 }}
        >
          <div
            className="smartexam-progress h-full rounded-full"
            style={{ animationDuration: `${HOLD_MS - 150}ms` }}
          />
        </div>
      </div>
    </div>
  )
}
