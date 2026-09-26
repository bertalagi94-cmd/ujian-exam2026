'use client'

// ── Welcome Splash "EXAMFLOW" ────────────────────────────────────────────
// Layar sambutan singkat SEBELUM halaman login dirender. Gaya sengaja
// dibuat clean/corporate (bukan flashy): 2 warna brand saja, gerakan
// halus & presisi, progress bar tipis sebagai indikator "memuat", lalu
// fade-out singkat membuka halaman login. Total durasi di layar ± 2.3s
// (lihat TOTAL_MS di bawah — ubah di sini kalau mau lebih panjang/pendek).
import { useEffect, useState } from 'react'
import { GraduationCap } from 'lucide-react'

const LETTERS = ['E', 'X', 'A', 'M', 'F', 'L', 'O', 'W']
const LETTER_STAGGER_MS = 55
const LETTER_START_MS = 150
const LETTER_DURATION_MS = 480

// Total waktu splash tampil sebelum mulai memudar, dan lama fade-out-nya.
const HOLD_MS = 1750
const FADE_OUT_MS = 500
// Total durasi splash di layar (fade-in + hold + fade-out) ≈ 0.35 + HOLD_MS/1000 + FADE_OUT_MS/1000 detik.

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
      {/* Latar gradasi navy → biru gelap, flat & clean */}
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

        <h1
          className="examflow-title font-bold whitespace-nowrap select-none text-center"
          style={{
            fontSize: 'clamp(2rem, 8vw, 4.25rem)',
            letterSpacing: 'clamp(0.05em, 0.9vw, 0.1em)',
          }}
        >
          {LETTERS.map((ch, i) => {
            const pos = LETTERS.length > 1 ? (i / (LETTERS.length - 1)) * 100 : 50
            return (
              <span
                key={i}
                className="examflow-letter inline-block"
                style={{
                  animationDelay: `${LETTER_START_MS + i * LETTER_STAGGER_MS}ms`,
                  backgroundPosition: `${pos}% 50%`,
                }}
              >
                {ch}
              </span>
            )
          })}
        </h1>

        <p className="examflow-subtitle mt-3 sm:mt-3.5 text-slate-400 font-medium"
          style={{ fontSize: 'clamp(0.7rem, 1.7vw, 0.85rem)', animationDelay: `${lastLetterEnd + 60}ms` }}
        >
          Sistem Ujian Digital
        </p>

        <div className="examflow-progress-track mt-6 sm:mt-7 overflow-hidden rounded-full"
          style={{ width: 'clamp(96px, 22vw, 160px)', height: 2 }}
        >
          <div className="examflow-progress h-full rounded-full" />
        </div>
      </div>
    </div>
  )
}
