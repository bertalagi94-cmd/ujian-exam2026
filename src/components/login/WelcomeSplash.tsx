'use client'

// ── Welcome Splash "EXAMFLOW" ────────────────────────────────────────────
// Layar sambutan singkat yang tampil SEBELUM halaman login dirender penuh.
// Teks "EXAMFLOW" muncul huruf demi huruf secara perlahan (staggered),
// disusul tagline kecil + garis bawah yang tumbuh, lalu seluruh layar
// memudar dengan lembut untuk membuka halaman login. Ukuran & jarak huruf
// memakai clamp()/vw supaya proporsinya tetap pas baik di HP maupun di
// layar besar (laptop/komputer), tanpa perlu breakpoint terpisah.
import { useEffect, useState } from 'react'
import { GraduationCap } from 'lucide-react'

const LETTERS = ['E', 'X', 'A', 'M', 'F', 'L', 'O', 'W']

// Total durasi (ms) sebelum splash mulai memudar, dan durasi fade-out-nya.
// Dihitung agar animasi terakhir (underline/tagline) sempat selesai dulu
// sebelum layar mulai menghilang.
const HOLD_MS = 2500
const FADE_OUT_MS = 650

export default function WelcomeSplash({ onFinish }: { onFinish: () => void }) {
  const [closing, setClosing] = useState(false)

  useEffect(() => {
    const t1 = setTimeout(() => setClosing(true), HOLD_MS)
    const t2 = setTimeout(onFinish, HOLD_MS + FADE_OUT_MS)
    return () => { clearTimeout(t1); clearTimeout(t2) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div
      className={`examflow-splash fixed inset-0 z-[200] flex items-center justify-center overflow-hidden ${closing ? 'examflow-splash-out' : ''}`}
      role="status"
      aria-label="Memuat EXAMFLOW"
    >
      {/* Latar gradasi navy → teal yang tenang, dengan kilau lembut yang
          bergerak sangat pelan supaya kesannya kalem, bukan ramai. */}
      <div className="absolute inset-0 -z-10" style={{
        background: 'linear-gradient(135deg, #050b1c 0%, #0a2340 32%, #0c3a5e 62%, #0e4a63 100%)',
      }} />
      <div className="examflow-orb examflow-orb-1" aria-hidden="true" />
      <div className="examflow-orb examflow-orb-2" aria-hidden="true" />
      <div className="examflow-orb examflow-orb-3" aria-hidden="true" />
      {/* Vignette halus supaya teks di tengah lebih menonjol */}
      <div className="absolute inset-0" style={{
        background: 'radial-gradient(ellipse at center, transparent 35%, rgba(2,8,20,0.55) 100%)',
      }} />

      <div className="relative flex flex-col items-center px-6 text-center">
        <div className="examflow-badge mb-4 sm:mb-5 flex items-center justify-center rounded-2xl"
          style={{
            width: 'clamp(44px, 8vw, 64px)',
            height: 'clamp(44px, 8vw, 64px)',
            background: 'linear-gradient(135deg, rgba(56,189,248,0.18), rgba(20,184,166,0.18))',
            border: '1px solid rgba(148,222,255,0.35)',
            boxShadow: '0 0 30px rgba(56,189,248,0.25)',
          }}
        >
          <GraduationCap
            className="text-sky-200"
            style={{ width: 'clamp(22px, 4vw, 32px)', height: 'clamp(22px, 4vw, 32px)' }}
          />
        </div>

        <h1
          className="examflow-title font-extrabold flex select-none"
          style={{
            fontSize: 'clamp(2.25rem, 9vw, 5rem)',
            letterSpacing: 'clamp(0.08em, 1.2vw, 0.16em)',
          }}
        >
          {LETTERS.map((ch, i) => (
            <span
              key={i}
              className="examflow-letter inline-block"
              style={{ animationDelay: `${220 + i * 95}ms` }}
            >
              {ch}
            </span>
          ))}
        </h1>

        <div className="examflow-underline-track mt-3 sm:mt-4 overflow-hidden rounded-full"
          style={{ width: 'clamp(120px, 30vw, 220px)', height: 3 }}
        >
          <div className="examflow-underline h-full w-full rounded-full" />
        </div>

        <p className="examflow-subtitle mt-4 sm:mt-5 text-slate-300"
          style={{ fontSize: 'clamp(0.75rem, 2vw, 0.95rem)', letterSpacing: '0.04em' }}
        >
          Ujian Digital, Lebih Mudah &amp; Adil
        </p>
      </div>
    </div>
  )
}
