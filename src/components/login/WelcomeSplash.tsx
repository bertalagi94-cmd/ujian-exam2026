'use client'

// ── Welcome Splash "EXAMFLOW" ────────────────────────────────────────────
// Layar sambutan singkat yang tampil SEBELUM halaman login dirender penuh.
// Setiap huruf "EXAMFLOW" terbang masuk satu per satu (flip 3D + blur→fokus),
// dengan gradient yang menyambung mulus antar huruf (bukan warna solid),
// lalu ada satu sapuan cahaya ("shine") melintas di atas judul, dan
// akhirnya seluruh layar memudar untuk membuka halaman login. Semua ukuran
// pakai clamp()/vw supaya proporsinya tetap pas di HP maupun layar besar.
import { useEffect, useState } from 'react'
import { GraduationCap } from 'lucide-react'

const LETTERS = ['E', 'X', 'A', 'M', 'F', 'L', 'O', 'W']
const LETTER_STAGGER_MS = 85
const LETTER_START_MS = 200
const LETTER_DURATION_MS = 620

// Total durasi (ms) sebelum splash mulai memudar, dan durasi fade-out-nya.
// Dihitung supaya shine-sweep & tagline sempat selesai dulu.
const HOLD_MS = 2500
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
      {/* Latar gradasi navy → teal yang tenang */}
      <div className="absolute inset-0 -z-10" style={{
        background: 'linear-gradient(135deg, #050b1c 0%, #0a2340 32%, #0c3a5e 62%, #0e4a63 100%)',
      }} />
      {/* Grid halus melayang pelan — sentuhan "tech" modern, sangat samar */}
      <div className="examflow-grid" aria-hidden="true" />
      <div className="examflow-orb examflow-orb-1" aria-hidden="true" />
      <div className="examflow-orb examflow-orb-2" aria-hidden="true" />
      <div className="examflow-orb examflow-orb-3" aria-hidden="true" />
      {/* Vignette halus supaya teks di tengah lebih menonjol */}
      <div className="absolute inset-0" style={{
        background: 'radial-gradient(ellipse at center, transparent 35%, rgba(2,8,20,0.6) 100%)',
      }} />

      <div className="relative flex flex-col items-center px-6 text-center">
        <div className="examflow-badge-ring mb-5 sm:mb-6 flex items-center justify-center rounded-2xl"
          style={{
            width: 'clamp(46px, 8vw, 66px)',
            height: 'clamp(46px, 8vw, 66px)',
            background: 'linear-gradient(135deg, rgba(56,189,248,0.16), rgba(20,184,166,0.16))',
          }}
        >
          <GraduationCap
            className="text-sky-100 relative z-10"
            style={{ width: 'clamp(22px, 4vw, 32px)', height: 'clamp(22px, 4vw, 32px)' }}
          />
        </div>

        {/* Wrapper relatif untuk menaruh sapuan cahaya (shine) tepat di atas judul */}
        <div className="relative inline-block" style={{ perspective: '700px' }}>
          <h1
            className="examflow-title font-extrabold whitespace-nowrap select-none text-center"
            style={{
              fontSize: 'clamp(2.25rem, 9vw, 5rem)',
              letterSpacing: 'clamp(0.06em, 1.1vw, 0.14em)',
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
          {/* Sapuan cahaya sekali lewat setelah semua huruf selesai muncul */}
          <span
            className="examflow-shine"
            aria-hidden="true"
            style={{ animationDelay: `${lastLetterEnd + 120}ms` }}
          />
        </div>

        <div className="examflow-underline-track mt-3 sm:mt-4 overflow-hidden rounded-full"
          style={{ width: 'clamp(120px, 30vw, 220px)', height: 3, animationDelay: `${lastLetterEnd}ms` }}
        >
          <div className="examflow-underline h-full w-full rounded-full" style={{ animationDelay: `${lastLetterEnd}ms` }} />
        </div>

        <p className="examflow-subtitle mt-4 sm:mt-5 text-slate-300"
          style={{ fontSize: 'clamp(0.75rem, 2vw, 0.95rem)', animationDelay: `${lastLetterEnd + 150}ms` }}
        >
          Ujian Digital, Lebih Mudah &amp; Adil
        </p>
      </div>
    </div>
  )
}
