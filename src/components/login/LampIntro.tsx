'use client'

// ── Lamp Intro ───────────────────────────────────────────────────────────────
// Layar pembuka "lampu berdiri" yang menutupi halaman login SEKALI SEHARI.
//
//   gelap + lampu redup → tali ditarik (klik) → bohlam menyala → cahaya melebar
//   dari bohlam sampai menutup layar → lampu memudar → layar ini memudar dan
//   halaman login tampil di bawahnya.
//
// Halaman login (src/app/login/page.tsx) TIDAK diubah: komponen ini hanya
// lapisan di atasnya, dipasang di RootLayout. Keputusan "tampil atau tidak"
// dibuat lebih awal oleh script kecil di <body> (lihat lamp-intro-gate.ts) lewat
// atribut <html data-lamp="1">; komponen ini hanya menjalankan animasinya.
//
// Hanya aktif di "/" dan "/login". Halaman lain (terutama /siswa/ujian) tidak
// pernah tertutup lampu.
import { useEffect, useRef, useState } from 'react'
import { usePathname } from 'next/navigation'
import { LAMP_KEY } from './lamp-intro-gate'
import './lamp-intro.css'

// Geometri SVG (viewBox 240×520) dan perilaku tali.
const VB_H = 520
const BULB = { x: 120, y: 158 }
const THRESHOLD = 32 // tarikan minimal (satuan viewBox) supaya lampu menyala
const MAX_PULL = 46
const HINT_DELAY_MS = 10000
const HINT_TEXT = 'Ayo tarik ke bawah talinya biar lampunya nyala 😃'

function todayKey(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function LampStage({ onDone }: { onDone: () => void }) {
  const rootRef = useRef<HTMLDivElement>(null)
  const ambientRef = useRef<HTMLDivElement>(null)
  const vignetteRef = useRef<HTMLDivElement>(null)
  const floodRef = useRef<HTMLDivElement>(null)
  const hintRef = useRef<HTMLDivElement>(null)
  const hintTextRef = useRef<HTMLSpanElement>(null)
  const lampRef = useRef<SVGSVGElement>(null)
  const swayRef = useRef<SVGGElement>(null)
  const cordRef = useRef<SVGGElement>(null)
  const cordLineRef = useRef<SVGLineElement>(null)
  const cordEndRef = useRef<SVGGElement>(null)
  const litRef = useRef<SVGGElement>(null)
  const beamRef = useRef<SVGGElement>(null)

  useEffect(() => {
    const root = rootRef.current
    const ambient = ambientRef.current
    const vignette = vignetteRef.current
    const flood = floodRef.current
    const hintEl = hintRef.current
    const hintText = hintTextRef.current
    const lamp = lampRef.current
    const sway = swayRef.current
    const cord = cordRef.current
    const cordLine = cordLineRef.current
    const cordEnd = cordEndRef.current
    const lit = litRef.current
    const beam = beamRef.current
    if (!root || !ambient || !vignette || !flood || !hintEl || !hintText || !lamp ||
        !sway || !cord || !cordLine || !cordEnd || !lit || !beam) return

    // Tidak jatuh tempo (sudah tampil hari ini, atau navigasi sisi-client ke
    // /login): jangan tampilkan apa pun.
    if (document.documentElement.getAttribute('data-lamp') !== '1') {
      onDone()
      return
    }

    const reduce = !!window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const K = reduce ? 0.4 : 1

    let phase: 'idle' | 'lit' = 'idle'
    let pull = 0
    let vel = 0
    let raf = 0
    let dragging = false
    let startY = 0
    let moved = 0
    let triggered = false
    let hintTimer = 0
    let finished = false
    let ctx: AudioContext | null = null
    const anims: Animation[] = []
    const timers: number[] = []
    const inerted: Element[] = []

    // ── Halaman di belakang tidak bisa difokus/diklik selama lampu tampil ──
    function lockBackground() {
      ;(document.activeElement as HTMLElement | null)?.blur?.()
      Array.from(document.body.children).forEach(el => {
        if (el === root || el.hasAttribute('inert')) return
        el.setAttribute('inert', '')
        inerted.push(el)
      })
    }
    function unlockBackground() {
      inerted.splice(0).forEach(el => el.removeAttribute('inert'))
    }
    lockBackground()

    function render() {
      cordLine!.setAttribute('y2', String(252 + pull))
      cordEnd!.setAttribute('transform', `translate(0 ${pull})`)
    }
    const swayOn = () => { if (!reduce) sway!.classList.add('is-swaying') }
    const swayOff = () => sway!.classList.remove('is-swaying')
    const scale = () => lamp!.getBoundingClientRect().height / VB_H

    // ── Bunyi klik (Web Audio, tanpa file suara) ──
    function audio(): AudioContext | null {
      try {
        const AC = window.AudioContext ||
          (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
        if (!AC) return null
        if (!ctx) ctx = new AC()
        if (ctx.state === 'suspended') void ctx.resume()
        return ctx
      } catch { return null }
    }
    function tick(c: AudioContext, at: number, freq: number, gain: number, dur: number) {
      const len = Math.floor(c.sampleRate * dur)
      const buf = c.createBuffer(1, len, c.sampleRate)
      const d = buf.getChannelData(0)
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3)
      const src = c.createBufferSource()
      src.buffer = buf
      const bp = c.createBiquadFilter()
      bp.type = 'bandpass'
      bp.frequency.value = freq
      bp.Q.value = 1.3
      const g = c.createGain()
      g.gain.value = gain
      src.connect(bp); bp.connect(g); g.connect(c.destination)
      src.start(at)
    }
    function clickSound() {
      const c = audio()
      if (!c) return
      const t = c.currentTime
      tick(c, t, 3200, 0.55, 0.05)
      const o = c.createOscillator()
      const g = c.createGain()
      o.type = 'sine'
      o.frequency.setValueAtTime(190, t)
      o.frequency.exponentialRampToValueAtTime(55, t + 0.09)
      g.gain.setValueAtTime(0.35, t)
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.11)
      o.connect(g); g.connect(c.destination)
      o.start(t); o.stop(t + 0.12)
      tick(c, t + 0.06, 2400, 0.22, 0.04)
    }

    // ── Tali: kembali seperti pegas, atau ditarik otomatis saat diketuk ──
    function springBack() {
      cancelAnimationFrame(raf)
      let last = performance.now()
      const step = (now: number) => {
        const dt = Math.min(0.032, (now - last) / 1000)
        last = now
        vel += (-260 * pull - 14 * vel) * dt
        pull += vel * dt
        render()
        if (Math.abs(pull) < 0.05 && Math.abs(vel) < 0.05) {
          pull = 0; vel = 0; render()
          if (phase === 'idle') swayOn()
          return
        }
        raf = requestAnimationFrame(step)
      }
      raf = requestAnimationFrame(step)
    }
    function pullTo(target: number, ms: number, done: () => void) {
      cancelAnimationFrame(raf)
      const from = pull
      const t0 = performance.now()
      const step = (now: number) => {
        const p = Math.min(1, (now - t0) / ms)
        const e = 1 - Math.pow(1 - p, 2)
        pull = from + (target - from) * e
        render()
        if (p < 1) raf = requestAnimationFrame(step)
        else done()
      }
      raf = requestAnimationFrame(step)
    }

    // ── Petunjuk setelah 10 detik tanpa tarikan ──
    function hideHint() {
      clearTimeout(hintTimer)
      hintEl!.classList.remove('show')
    }
    function armHint() {
      clearTimeout(hintTimer)
      hintTimer = window.setTimeout(() => {
        if (phase !== 'idle' || dragging) return
        hintText!.textContent = HINT_TEXT
        hintEl!.classList.add('show')
      }, HINT_DELAY_MS)
    }

    // ── Sekali sehari: dicatat saat tali ditarik ──
    function markSeen() {
      try { localStorage.setItem(LAMP_KEY, todayKey()) } catch { /* abaikan */ }
    }

    function anim(el: Element, kf: Keyframe[], opt: KeyframeAnimationOptions): Animation {
      const a = el.animate(kf, { fill: 'forwards', ...opt })
      anims.push(a)
      return a
    }
    function later(fn: () => void, ms: number) {
      timers.push(window.setTimeout(fn, ms))
    }

    // Selesai: layar lampu dilepas, halaman login sepenuhnya milik pengguna.
    function finish() {
      if (finished) return
      finished = true
      unlockBackground()
      document.documentElement.removeAttribute('data-lamp')
      onDone()
    }

    // ── Urutan menyala ──
    function lightUp() {
      if (phase !== 'idle') return
      phase = 'lit'
      hideHint()
      markSeen()
      clickSound()

      const r = lamp!.getBoundingClientRect()
      const s = r.height / VB_H
      const X = r.left + BULB.x * s
      const Y = r.top + BULB.y * s
      root!.style.setProperty('--fx', `${X}px`)
      root!.style.setProperty('--fy', `${Y}px`)
      // Sisi layar terjauh dari bohlam; bagian pekat lingkaran = 60% jari-jari.
      const Rmax = Math.hypot(Math.max(X, window.innerWidth - X), Math.max(Y, window.innerHeight - Y)) + 40
      const Rel = Rmax / 0.6
      flood!.style.width = `${Rel * 2}px`
      flood!.style.height = `${Rel * 2}px`
      flood!.style.left = `${X - Rel}px`
      flood!.style.top = `${Y - Rel}px`

      const warm: Keyframe[] = reduce
        ? [{ opacity: 0 }, { opacity: 1 }]
        : [{ opacity: 0 }, { opacity: 0.5, offset: 0.1 }, { opacity: 0.32, offset: 0.2 }, { opacity: 1 }]
      anim(lit!, warm, { duration: 1500 * K, easing: 'ease-out' })
      anim(beam!, warm, { duration: 1800 * K, easing: 'ease-out' })
      anim(lamp!, [{ filter: 'brightness(.78)' }, { filter: 'brightness(1)' }], { duration: 1200 * K, easing: 'ease-out' })
      anim(ambient!, [{ opacity: 0 }, { opacity: 1 }], { duration: 1500 * K, delay: 150 * K, easing: 'ease-in-out' })
      anim(vignette!, [{ opacity: 1 }, { opacity: 0 }], { duration: 2200 * K, delay: 200 * K, easing: 'ease-in-out' })

      // Cahaya melebar dari bohlam; lampu memudar pelan saat tertelan cahaya.
      later(() => {
        flood!.style.visibility = 'visible'
        anim(flood!, [
          { transform: 'scale(.02)', opacity: 0 },
          { transform: 'scale(.12)', opacity: 1, offset: 0.1 },
          { transform: 'scale(1)', opacity: 1 },
        ], { duration: 2800 * K, easing: 'cubic-bezier(.33, 0, .2, 1)' })
        anim(lamp!, [{ opacity: 1 }, { opacity: 0 }], { duration: 1200 * K, delay: 900 * K, easing: 'ease-in-out' })
      }, 900 * K)

      // Login muncul saat cahaya hampir menutup layar (tumpang tindih, tanpa jeda).
      later(() => {
        unlockBackground()
        root!.style.pointerEvents = 'none' // login sudah bisa disentuh selagi layar memudar
        const a = anim(root!, [{ opacity: 1 }, { opacity: 0 }], { duration: 1200 * K, easing: 'ease-in-out' })
        a.onfinish = finish
      }, 3100 * K)

      // Pengaman: apa pun yang terjadi, layar lampu tidak boleh menggantung.
      later(finish, (3100 + 1200) * K + 600)
    }

    // ── Interaksi tali: jari/mouse (drag), ketuk, atau keyboard ──
    function tapPull() {
      if (phase !== 'idle') return
      swayOff(); audio(); hideHint()
      pullTo(THRESHOLD + 6, 150, () => { lightUp(); springBack() })
    }
    const onPointerDown = (e: PointerEvent) => {
      if (phase !== 'idle') return
      audio(); hideHint()
      dragging = true; triggered = false; moved = 0; startY = e.clientY
      cancelAnimationFrame(raf); vel = 0; swayOff()
      try { cord!.setPointerCapture(e.pointerId) } catch { /* abaikan */ }
      e.preventDefault()
    }
    const onPointerMove = (e: PointerEvent) => {
      if (!dragging) return
      const dy = (e.clientY - startY) / scale()
      moved = Math.max(moved, Math.abs(dy))
      pull = Math.max(0, Math.min(MAX_PULL, dy))
      render()
      if (!triggered && pull >= THRESHOLD) { triggered = true; lightUp() }
    }
    const endDrag = () => {
      if (!dragging) return
      dragging = false
      if (triggered) { springBack(); return }
      if (moved < 6) { tapPull(); return }
      springBack(); armHint()
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); tapPull() }
    }
    cord.addEventListener('pointerdown', onPointerDown)
    cord.addEventListener('pointermove', onPointerMove)
    cord.addEventListener('pointerup', endDrag)
    cord.addEventListener('pointercancel', endDrag)
    cord.addEventListener('keydown', onKeyDown)

    render()
    swayOn()
    armHint()

    return () => {
      cord.removeEventListener('pointerdown', onPointerDown)
      cord.removeEventListener('pointermove', onPointerMove)
      cord.removeEventListener('pointerup', endDrag)
      cord.removeEventListener('pointercancel', endDrag)
      cord.removeEventListener('keydown', onKeyDown)
      timers.forEach(clearTimeout)
      clearTimeout(hintTimer)
      cancelAnimationFrame(raf)
      anims.forEach(a => { a.onfinish = null; a.cancel() })
      unlockBackground()
      if (ctx) { try { void ctx.close() } catch { /* abaikan */ } }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div ref={rootRef} className="lamp-root" role="dialog" aria-modal="true" aria-label="Layar pembuka: tarik tali lampu untuk masuk">
      <div ref={ambientRef} className="lamp-ambient" />

      <svg ref={lampRef} className="lamp-svg" viewBox="0 0 240 520" role="group"
        aria-label="Lampu berdiri yang gelap. Tarik talinya untuk menyalakan.">
        <defs>
          <linearGradient id="lampShadeDark" x1="0" x2="1">
            <stop offset="0" stopColor="#1c1915" /><stop offset=".45" stopColor="#3b342b" /><stop offset="1" stopColor="#17140f" />
          </linearGradient>
          <linearGradient id="lampShadeLit" x1="0" x2="1">
            <stop offset="0" stopColor="#f1b25e" /><stop offset=".45" stopColor="#ffe6b8" /><stop offset="1" stopColor="#e9a043" />
          </linearGradient>
          <linearGradient id="lampPole" x1="0" x2="1">
            <stop offset="0" stopColor="#101012" /><stop offset=".5" stopColor="#4b4b52" /><stop offset="1" stopColor="#101012" />
          </linearGradient>
          <radialGradient id="lampBase" cx=".5" cy=".3" r=".8">
            <stop offset="0" stopColor="#3a3a40" /><stop offset="1" stopColor="#0d0d10" />
          </radialGradient>
          <radialGradient id="lampGlow" cx=".5" cy=".5" r=".5">
            <stop offset="0" stopColor="#fff0c8" stopOpacity="1" />
            <stop offset=".35" stopColor="#ffcf82" stopOpacity=".55" />
            <stop offset="1" stopColor="#ffb347" stopOpacity="0" />
          </radialGradient>
          <linearGradient id="lampCone" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#ffd896" stopOpacity=".62" />
            <stop offset=".7" stopColor="#ffc56e" stopOpacity=".14" />
            <stop offset="1" stopColor="#ffc56e" stopOpacity="0" />
          </linearGradient>
          <radialGradient id="lampPool" cx=".5" cy=".5" r=".5">
            <stop offset="0" stopColor="#ffd896" stopOpacity=".55" />
            <stop offset="1" stopColor="#ffd896" stopOpacity="0" />
          </radialGradient>
        </defs>

        {/* cahaya ke lantai (muncul setelah menyala) */}
        <g ref={beamRef} className="lamp-beam">
          <path d="M48 152 L192 152 L330 484 L -90 484 Z" fill="url(#lampCone)" />
          <ellipse cx="120" cy="482" rx="170" ry="20" fill="url(#lampPool)" />
        </g>

        {/* badan lampu */}
        <ellipse cx="120" cy="486" rx="54" ry="9" fill="#000" opacity=".5" />
        <path d="M70 486 Q72 466 120 462 Q168 466 170 486 Z" fill="url(#lampBase)" stroke="rgba(255,255,255,.07)" />
        <rect x="117" y="40" width="6" height="428" fill="url(#lampPole)" />
        <rect x="114" y="300" width="12" height="7" rx="1.5" fill="#6f5626" />
        <rect x="114" y="330" width="12" height="4" rx="1.5" fill="#6f5626" />

        {/* kap lampu gelap */}
        <path d="M85 40 L155 40 L196 150 Q120 162 44 150 Z" fill="url(#lampShadeDark)" stroke="rgba(255,255,255,.09)" />
        <ellipse cx="120" cy="150" rx="76" ry="7" fill="#0b0a08" />
        <circle cx="120" cy="154" r="11" fill="#3a352c" />

        {/* kap lampu menyala */}
        <g ref={litRef} className="lamp-lit">
          <path d="M85 40 L155 40 L196 150 Q120 162 44 150 Z" fill="url(#lampShadeLit)" />
          <ellipse cx="120" cy="150" rx="76" ry="7" fill="#ffe9c0" />
          <circle cx="120" cy="158" r="62" fill="url(#lampGlow)" />
          <circle cx="120" cy="154" r="11" fill="#fff6dc" />
        </g>

        {/* tali */}
        <g ref={swayRef} className="lamp-sway">
          <g ref={cordRef} className="lamp-cord" role="button" tabIndex={0} aria-label="Tarik tali lampu untuk menyalakan">
            <line ref={cordLineRef} x1="170" y1="150" x2="170" y2="252" stroke="#8a7a5c" strokeWidth="1.6" strokeLinecap="round" />
            <g ref={cordEndRef}>
              <circle className="lamp-pulse" cx="170" cy="262" r="12" fill="#ffcf82" />
              <rect x="166" y="250" width="8" height="24" rx="4" fill="#a8935f" />
              <rect x="167.5" y="252" width="2" height="18" rx="1" fill="#d8c48e" opacity=".55" />
              <circle className="lamp-hit" cx="170" cy="262" r="28" />
            </g>
          </g>
        </g>
      </svg>

      <div ref={vignetteRef} className="lamp-vignette" />
      <div ref={hintRef} className="lamp-hint" role="status"><span ref={hintTextRef} /></div>
      <div ref={floodRef} className="lamp-flood" />
    </div>
  )
}

export default function LampIntro() {
  const pathname = usePathname()
  const [gone, setGone] = useState(false)
  const onEntry = pathname === '/login' || pathname === '/'

  // Pindah ke halaman lain (mis. APK meneruskan "/" ke halaman ujian): lepaskan
  // penanda supaya layar lampu tidak pernah menahan halaman itu.
  useEffect(() => {
    if (!onEntry) document.documentElement.removeAttribute('data-lamp')
  }, [onEntry])

  if (!onEntry || gone) return null
  return <LampStage onDone={() => setGone(true)} />
}
