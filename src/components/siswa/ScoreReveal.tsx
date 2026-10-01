'use client'

// ─────────────────────────────────────────────────────────────────────────────
// ScoreReveal — animasi pengumuman nilai setelah ujian online selesai.
//
// Alur (total ± 17 detik):
//   1. COUNT   : hitung mundur 10 → 0 (cincin progres, pop angka, status teks).
//   2. REVEAL  : kilatan cahaya → nilai muncul BESAR di tengah layar,
//                naik dari 0 ke nilai akhir (count-up) + confetti bila lulus.
//   3. SHRINK  : nilai mengecil & "terbang" ke kotak "Nilai" pada kartu hasil
//                (teknik FLIP: ukuran & posisi dihitung dari elemen target),
//                overlay memudar → tampilan akhir sama seperti sebelumnya.
//
// Menghormati prefers-reduced-motion: animasi dilewati, hasil langsung tampil.
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useMemo, useRef, useState, type RefObject } from 'react'

type Stage = 'count' | 'reveal' | 'shrink'

interface Props {
  nilai: number
  lulus: boolean
  namaMapel?: string
  /** Elemen angka "Nilai" di kartu hasil — tujuan animasi mengecil. */
  targetRef: RefObject<HTMLElement>
  /** Dipanggil saat fase mengecil mulai (kartu hasil mulai muncul). */
  onShrinkStart: () => void
  /** Dipanggil saat semua animasi selesai (overlay dilepas). */
  onDone: () => void
}

const DURASI_COUNTUP = 1500
const TAHAN_SETELAH_REVEAL = 1500
const DURASI_SHRINK = 1100

const PESAN_HITUNG = (n: number) =>
  n >= 7 ? 'Memeriksa jawabanmu…' : n >= 4 ? 'Menghitung skor…' : n >= 1 ? 'Menyusun hasil…' : 'Siap!'

const CONFETTI_COLORS = ['#34d399', '#60a5fa', '#fbbf24', '#f472b6', '#a78bfa', '#ffffff']

const CSS = `
@keyframes sr-pop      { 0% { transform: scale(1.9); opacity: 0; filter: blur(8px); } 35% { transform: scale(0.96); opacity: 1; filter: blur(0); } 100% { transform: scale(1); opacity: 1; } }
@keyframes sr-ring     { from { stroke-dashoffset: 0; } to { stroke-dashoffset: 691.2; } }
@keyframes sr-ping     { 0% { transform: scale(0.75); opacity: 0.55; } 100% { transform: scale(1.55); opacity: 0; } }
@keyframes sr-spin     { to { transform: rotate(360deg); } }
@keyframes sr-blob1    { 0%,100% { transform: translate(0,0) scale(1); } 50% { transform: translate(60px,-40px) scale(1.2); } }
@keyframes sr-blob2    { 0%,100% { transform: translate(0,0) scale(1); } 50% { transform: translate(-70px,50px) scale(1.15); } }
@keyframes sr-flash    { 0% { opacity: 0.95; transform: scale(0.2); } 100% { opacity: 0; transform: scale(2.6); } }
@keyframes sr-burst    { 0% { opacity: 0.8; transform: scale(0.3); } 100% { opacity: 0; transform: scale(2.2); } }
@keyframes sr-score-in { 0% { transform: scale(0.35); opacity: 0; filter: blur(14px); } 60% { transform: scale(1.08); opacity: 1; filter: blur(0); } 100% { transform: scale(1); opacity: 1; } }
@keyframes sr-fade-up  { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: translateY(0); } }
@keyframes sr-fall     { 0% { transform: translate3d(0,-12vh,0) rotate(0deg); opacity: 1; } 100% { transform: translate3d(var(--sr-dx),108vh,0) rotate(var(--sr-rot)); opacity: 0.9; } }
@keyframes sr-twinkle  { 0%,100% { opacity: 0.25; } 50% { opacity: 0.9; } }
`

export default function ScoreReveal({ nilai, lulus, namaMapel, targetRef, onShrinkStart, onDone }: Props) {
  const [stage, setStage] = useState<Stage>('count')
  const [count, setCount] = useState(10)
  const [tampil, setTampil] = useState('0')
  const [selesaiCountUp, setSelesaiCountUp] = useState(false)
  const [xf, setXf] = useState<{ dx: number; dy: number; s: number } | null>(null)
  const bigRef = useRef<HTMLDivElement>(null)

  // Callback dibungkus ref supaya efek di bawah tidak ter-restart tiap render induk.
  const cb = useRef({ onShrinkStart, onDone })
  cb.current = { onShrinkStart, onDone }

  const glow = lulus ? 'rgba(52,211,153,0.75)' : 'rgba(251,191,36,0.65)'
  const aksen = lulus ? '#34d399' : '#fbbf24'

  const confetti = useMemo(
    () =>
      Array.from({ length: 46 }, (_, i) => ({
        id: i,
        left: Math.random() * 100,
        delay: Math.random() * 0.9,
        dur: 2.6 + Math.random() * 2,
        dx: (Math.random() - 0.5) * 220,
        rot: 360 + Math.random() * 720,
        w: 6 + Math.random() * 7,
        h: 10 + Math.random() * 8,
        color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
        round: i % 4 === 0,
      })),
    [],
  )

  const bintang = useMemo(
    () =>
      Array.from({ length: 28 }, (_, i) => ({
        id: i,
        left: Math.random() * 100,
        top: Math.random() * 100,
        size: 2 + Math.random() * 3,
        dur: 2 + Math.random() * 3,
        delay: Math.random() * 3,
      })),
    [],
  )

  // ── Awal: lewati animasi bila pengguna minta gerakan dikurangi; kunci scroll ──
  useEffect(() => {
    if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      cb.current.onShrinkStart()
      cb.current.onDone()
      return
    }
    window.scrollTo(0, 0)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [])

  // ── Fase 1: hitung mundur 10 → 0 ──
  useEffect(() => {
    if (stage !== 'count') return
    const t = setTimeout(
      () => {
        if (count > 0) setCount(c => c - 1)
        else setStage('reveal')
      },
      count === 0 ? 800 : 1000,
    )
    return () => clearTimeout(t)
  }, [stage, count])

  // ── Fase 2: count-up nilai 0 → nilai akhir, tahan sebentar, lalu mengecil ──
  useEffect(() => {
    if (stage !== 'reveal') return
    let raf = 0
    let tahan: ReturnType<typeof setTimeout> | undefined
    const desimal = Number.isInteger(nilai) ? 0 : 1
    const mulai = performance.now()

    const tick = (now: number) => {
      const p = Math.min(1, (now - mulai) / DURASI_COUNTUP)
      const eased = 1 - Math.pow(2, -10 * p) // easeOutExpo
      if (p < 1) {
        setTampil((nilai * eased).toFixed(desimal))
        raf = requestAnimationFrame(tick)
      } else {
        setTampil(String(nilai)) // sama persis dengan yang tampil di kartu
        setSelesaiCountUp(true)
        tahan = setTimeout(mulaiShrink, TAHAN_SETELAH_REVEAL)
      }
    }
    raf = requestAnimationFrame(tick)

    return () => {
      cancelAnimationFrame(raf)
      if (tahan) clearTimeout(tahan)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage, nilai])

  // ── Fase 3: FLIP — hitung posisi & skala menuju kotak "Nilai" di kartu ──
  function mulaiShrink() {
    const big = bigRef.current
    const target = targetRef.current
    if (big && target) {
      const r = target.getBoundingClientRect()
      const bigPx = parseFloat(getComputedStyle(big).fontSize) || 160
      const targetPx = parseFloat(getComputedStyle(target).fontSize) || 30
      setXf({
        dx: r.left + r.width / 2 - window.innerWidth / 2,
        dy: r.top + r.height / 2 - window.innerHeight / 2,
        s: targetPx / bigPx,
      })
    } else {
      setXf({ dx: 0, dy: 0, s: 0.2 })
    }
    setStage('shrink')
    cb.current.onShrinkStart()
    setTimeout(() => cb.current.onDone(), DURASI_SHRINK + 100)
  }

  const mengecil = stage === 'shrink'

  return (
    <>
      <style>{CSS}</style>

      {/* ── Latar overlay ── */}
      <div
        className="fixed inset-0 z-[100] overflow-hidden select-none"
        aria-live="polite"
        style={{
          background: 'radial-gradient(circle at 50% 38%, #3730a3 0%, #1e1b4b 42%, #0a0920 100%)',
          opacity: mengecil ? 0 : 1,
          transition: `opacity ${DURASI_SHRINK - 150}ms ease ${mengecil ? 150 : 0}ms`,
          pointerEvents: mengecil ? 'none' : 'auto',
        }}
      >
        {/* aurora */}
        <div
          className="absolute -top-24 -left-24 w-[420px] h-[420px] rounded-full"
          style={{ background: 'radial-gradient(circle, rgba(99,102,241,0.55), transparent 70%)', animation: 'sr-blob1 9s ease-in-out infinite', filter: 'blur(20px)' }}
        />
        <div
          className="absolute -bottom-28 -right-20 w-[460px] h-[460px] rounded-full"
          style={{
            background: lulus
              ? 'radial-gradient(circle, rgba(16,185,129,0.4), transparent 70%)'
              : 'radial-gradient(circle, rgba(236,72,153,0.38), transparent 70%)',
            animation: 'sr-blob2 11s ease-in-out infinite',
            filter: 'blur(24px)',
          }}
        />
        {/* bintang kecil */}
        {bintang.map(b => (
          <span
            key={b.id}
            className="absolute rounded-full bg-white"
            style={{
              left: `${b.left}%`,
              top: `${b.top}%`,
              width: b.size,
              height: b.size,
              animation: `sr-twinkle ${b.dur}s ease-in-out ${b.delay}s infinite`,
            }}
          />
        ))}

        {/* ═════════ FASE 1 — HITUNG MUNDUR ═════════ */}
        {stage === 'count' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center px-6 text-center">
            <p className="text-indigo-200/80 text-xs sm:text-sm font-semibold tracking-[0.3em] uppercase mb-8">
              Ujian selesai
            </p>

            <div className="relative w-[260px] h-[260px] sm:w-[300px] sm:h-[300px]">
              {/* halo berputar */}
              <div
                className="absolute inset-[-14px] rounded-full opacity-70"
                style={{
                  background: 'conic-gradient(from 0deg, transparent 0deg, rgba(129,140,248,0.0) 120deg, rgba(56,189,248,0.8) 300deg, transparent 360deg)',
                  filter: 'blur(14px)',
                  animation: 'sr-spin 2.4s linear infinite',
                }}
              />
              {/* gelombang tiap detik */}
              <div
                key={`ping-${count}`}
                className="absolute inset-0 rounded-full border-2 border-sky-300/60"
                style={{ animation: 'sr-ping 1s ease-out' }}
              />

              <svg viewBox="0 0 260 260" className="absolute inset-0 w-full h-full -rotate-90">
                <defs>
                  <linearGradient id="sr-grad" x1="0" y1="0" x2="1" y2="1">
                    <stop offset="0%" stopColor="#818cf8" />
                    <stop offset="100%" stopColor="#38bdf8" />
                  </linearGradient>
                </defs>
                <circle cx="130" cy="130" r="110" fill="rgba(255,255,255,0.04)" stroke="rgba(255,255,255,0.12)" strokeWidth="8" />
                <circle
                  key={`ring-${count}`}
                  cx="130"
                  cy="130"
                  r="110"
                  fill="none"
                  stroke="url(#sr-grad)"
                  strokeWidth="8"
                  strokeLinecap="round"
                  strokeDasharray="691.2"
                  style={{
                    strokeDashoffset: 0,
                    animation: count > 0 ? 'sr-ring 1s linear forwards' : undefined,
                    ...(count === 0 ? { strokeDashoffset: 691.2 } : {}),
                    filter: 'drop-shadow(0 0 8px rgba(56,189,248,0.8))',
                  }}
                />
              </svg>

              <div className="absolute inset-0 flex items-center justify-center">
                <span
                  key={`num-${count}`}
                  className="font-extrabold text-white tabular-nums leading-none"
                  style={{
                    fontSize: 'clamp(5.5rem, 22vw, 8.5rem)',
                    textShadow: '0 0 30px rgba(129,140,248,0.9), 0 0 70px rgba(56,189,248,0.5)',
                    animation: 'sr-pop 0.55s cubic-bezier(.2,.9,.3,1.2) both',
                  }}
                >
                  {count}
                </span>
              </div>
            </div>

            {/* titik progres 10 → 0 */}
            <div className="flex items-center gap-1.5 mt-8">
              {Array.from({ length: 11 }, (_, i) => {
                const lewat = i >= count // titik kanan padam lebih dulu = waktu berkurang
                return (
                  <span
                    key={i}
                    className="rounded-full transition-all duration-500"
                    style={{
                      width: lewat ? 6 : 8,
                      height: lewat ? 6 : 8,
                      background: lewat ? 'rgba(255,255,255,0.18)' : '#a5b4fc',
                      boxShadow: lewat ? 'none' : '0 0 8px rgba(165,180,252,0.9)',
                    }}
                  />
                )
              })}
            </div>

            <p key={PESAN_HITUNG(count)} className="mt-6 text-indigo-100/90 text-sm sm:text-base font-medium" style={{ animation: 'sr-fade-up 0.4s ease-out both' }}>
              {PESAN_HITUNG(count)}
            </p>
          </div>
        )}

        {/* ═════════ FASE 2 — EFEK REVEAL ═════════ */}
        {stage !== 'count' && (
          <>
            {/* kilatan & gelombang saat nilai muncul */}
            <div
              className="absolute left-1/2 top-1/2 w-[70vmin] h-[70vmin] -ml-[35vmin] -mt-[35vmin] rounded-full pointer-events-none"
              style={{ background: 'radial-gradient(circle, rgba(255,255,255,0.95), transparent 65%)', animation: 'sr-flash 0.9s ease-out both' }}
            />
            <div
              className="absolute left-1/2 top-1/2 w-[60vmin] h-[60vmin] -ml-[30vmin] -mt-[30vmin] rounded-full pointer-events-none"
              style={{ border: `3px solid ${aksen}`, boxShadow: `0 0 40px ${glow}`, animation: 'sr-burst 1.3s ease-out 0.15s both' }}
            />
            <div
              className="absolute left-1/2 top-1/2 w-[60vmin] h-[60vmin] -ml-[30vmin] -mt-[30vmin] rounded-full pointer-events-none"
              style={{ border: `2px solid ${aksen}`, animation: 'sr-burst 1.6s ease-out 0.45s both' }}
            />

            {/* label atas */}
            <p
              className="absolute left-0 right-0 text-center text-indigo-100/90 text-xs sm:text-sm font-semibold tracking-[0.35em] uppercase"
              style={{ top: 'calc(50% - min(24vw, 8.5rem) - 2rem)', animation: 'sr-fade-up 0.6s ease-out 0.3s both' }}
            >
              Nilai Kamu
            </p>

            {/* pesan bawah (muncul setelah count-up selesai) */}
            {selesaiCountUp && (
              <div
                className="absolute left-0 right-0 text-center px-6"
                style={{ top: 'calc(50% + min(19vw, 6.5rem) + 1rem)', animation: 'sr-fade-up 0.5s ease-out both' }}
              >
                <p className="text-white text-lg sm:text-xl font-bold">
                  {lulus ? 'Selamat, kamu lulus! 🎉' : 'Tetap semangat, terus belajar! 💪'}
                </p>
                {namaMapel && <p className="text-indigo-200/80 text-sm mt-1">{namaMapel}</p>}
              </div>
            )}

            {/* confetti — hanya bila lulus */}
            {lulus &&
              confetti.map(c => (
                <span
                  key={c.id}
                  className="absolute top-0 pointer-events-none"
                  style={{
                    left: `${c.left}%`,
                    width: c.w,
                    height: c.round ? c.w : c.h,
                    background: c.color,
                    borderRadius: c.round ? '9999px' : 2,
                    ['--sr-dx' as string]: `${c.dx}px`,
                    ['--sr-rot' as string]: `${c.rot}deg`,
                    animation: `sr-fall ${c.dur}s cubic-bezier(.25,.6,.5,1) ${0.35 + c.delay}s both`,
                  }}
                />
              ))}
          </>
        )}
      </div>

      {/* ═════════ ANGKA NILAI BESAR — terpisah dari overlay agar tidak ikut memudar ═════════ */}
      {stage !== 'count' && (
        <div
          ref={bigRef}
          className="fixed z-[101] left-1/2 top-1/2 font-bold tabular-nums whitespace-nowrap pointer-events-none"
          style={{
            fontSize: 'min(34vw, 11rem)',
            lineHeight: 1,
            color: mengecil ? '#0f172a' : '#ffffff',
            textShadow: mengecil ? '0 0 0 rgba(0,0,0,0)' : `0 0 36px ${glow}, 0 0 90px ${glow}`,
            transform: mengecil && xf
              ? `translate(calc(-50% + ${xf.dx}px), calc(-50% + ${xf.dy}px)) scale(${xf.s})`
              : 'translate(-50%, -50%) scale(1)',
            transformOrigin: 'center center',
            transition: mengecil
              ? `transform ${DURASI_SHRINK}ms cubic-bezier(.65,0,.2,1), color ${DURASI_SHRINK}ms ease, text-shadow ${DURASI_SHRINK * 0.7}ms ease`
              : 'none',
            willChange: 'transform',
          }}
        >
          <span className="inline-block" style={{ animation: 'sr-score-in 0.7s cubic-bezier(.2,.9,.3,1.15) both' }}>
            {tampil}
          </span>
        </div>
      )}
    </>
  )
}
