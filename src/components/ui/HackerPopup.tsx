'use client'

import { useEffect, useRef, useState } from 'react'

// ── Types ─────────────────────────────────────────────────────────────────────

export type HackerPopupType = 'backup' | 'restore' | 'reset'

export interface HackerPopupProps {
  open: boolean
  type: HackerPopupType
  /** nama file / label data yang sedang diproses */
  fileName?: string
  /** ukuran data, mis. "84.3 MB" */
  fileSize?: string
  /** 0–100 */
  progress: number
  /** label status tiap tahap, otomatis berganti sesuai progress */
  steps?: string[]
  /** callback saat progress mencapai 100 dan animasi selesai */
  onDone?: () => void
}

// ── Config per tipe ───────────────────────────────────────────────────────────

const CONFIGS = {
  backup: {
    title: 'Backup Data',
    icon: '💾',
    accentClass: 'backup',
    accentHex: '#7c6cf8',
    accentLight: '#b8b0ff',
    burstColor: '#b8b0ff',
    defaultSteps: [
      'Mengumpulkan data...',
      'Mengompres file...',
      'Mengenkripsi data...',
      'Upload ke penyimpanan...',
      'Finalisasi backup...',
      'Selesai ✓',
    ],
    defaultFile: 'smartexam-backup.json',
    defaultSize: '—',
  },
  restore: {
    title: 'Restore Data',
    icon: '♻️',
    accentClass: 'restore',
    accentHex: '#00c48c',
    accentLight: '#5effd3',
    burstColor: '#5effd3',
    defaultSteps: [
      'Memverifikasi file...',
      'Membaca data backup...',
      'Mendekripsi tabel...',
      'Memulihkan database...',
      'Sinkronisasi akhir...',
      'Selesai ✓',
    ],
    defaultFile: 'backup.json',
    defaultSize: '—',
  },
  reset: {
    title: 'Reset Aplikasi',
    icon: '🔄',
    accentClass: 'reset',
    accentHex: '#ff6b4a',
    accentLight: '#ffb09c',
    burstColor: '#ffb09c',
    defaultSteps: [
      'Menghentikan proses...',
      'Menghapus cache...',
      'Menghapus data terpilih...',
      'Membersihkan sisa...',
      'Memverifikasi...',
      'Selesai ✓',
    ],
    defaultFile: 'app_data',
    defaultSize: '—',
  },
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function pad2(n: number) {
  return n.toString().padStart(2, '0')
}
function nowStr() {
  const d = new Date()
  return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()}  ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`
}

// ── Main Component ────────────────────────────────────────────────────────────

export function HackerPopup({
  open,
  type,
  fileName,
  fileSize,
  progress,
  steps,
  onDone,
}: HackerPopupProps) {
  const cfg = CONFIGS[type]
  const resolvedSteps = steps ?? cfg.defaultSteps
  const resolvedFile = fileName ?? cfg.defaultFile
  const resolvedSize = fileSize ?? cfg.defaultSize

  // canvas refs
  const bgRef = useRef<HTMLCanvasElement>(null)
  const pRef = useRef<HTMLCanvasElement>(null)
  const rafRef = useRef<number>(0)
  const pulseTimerRef = useRef<ReturnType<typeof setInterval>>()
  const tsTimerRef = useRef<ReturnType<typeof setInterval>>()

  const [ts, setTs] = useState(nowStr())
  const [done, setDone] = useState(false)
  const [closing, setClosing] = useState(false)

  // Reset state when opened
  useEffect(() => {
    if (open) {
      setDone(false)
      setClosing(false)
    }
  }, [open])

  // Timestamp ticker
  useEffect(() => {
    if (!open) return
    tsTimerRef.current = setInterval(() => setTs(nowStr()), 1000)
    return () => clearInterval(tsTimerRef.current)
  }, [open])

  // Mark done when progress hits 100
  useEffect(() => {
    if (progress >= 100 && open && !done) {
      setDone(true)
      // Close after 2.4s
      setTimeout(() => {
        setClosing(true)
        setTimeout(() => {
          onDone?.()
        }, 350)
      }, 2400)
    }
  }, [progress, open, done, onDone])

  // ── Canvas animation ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!open) return
    const bg = bgRef.current
    const pc = pRef.current
    if (!bg || !pc) return

    const bx = bg.getContext('2d')!
    const px = pc.getContext('2d')!

    function resize() {
      bg.width = bg.offsetWidth
      bg.height = bg.offsetHeight
      pc.width = pc.offsetWidth
      pc.height = pc.offsetHeight
    }
    resize()
    window.addEventListener('resize', resize)

    // Matrix rain
    const CHAR_W = 14
    const chars = 'アイウエオカキクケコサシスセソタチツテトナニヌ0123456789ABCDEF<>{}[]|/\\;:.?!@#$%^&*'
    const cols = Math.ceil(bg.width / CHAR_W)
    const drops = Array.from({ length: cols }, () => Math.random() * -60)

    function drawMatrix() {
      bx.fillStyle = 'rgba(4,6,14,0.16)'
      bx.fillRect(0, 0, bg.width, bg.height)
      bx.font = `13px monospace`
      for (let i = 0; i < drops.length; i++) {
        const ch = chars[Math.floor(Math.random() * chars.length)]
        const bright = Math.random() > 0.92
        bx.fillStyle = bright ? '#ffffff' : Math.random() > 0.5 ? '#1aff8a' : '#1a8fff'
        bx.globalAlpha = bright ? 0.85 : 0.25 + Math.random() * 0.3
        bx.fillText(ch, i * CHAR_W, drops[i] * CHAR_W)
        bx.globalAlpha = 1
        if (drops[i] * CHAR_W > bg.height && Math.random() > 0.975) drops[i] = 0
        drops[i]++
      }
    }

    // Hex grid
    const hexes: { x: number; y: number; r: number; phase: number; speed: number }[] = []
    for (let row = 0; row < 10; row++) {
      for (let col = 0; col < 12; col++) {
        hexes.push({
          x: col * 70 + (row % 2) * 35,
          y: row * 52,
          r: 20,
          phase: Math.random() * Math.PI * 2,
          speed: 0.4 + Math.random() * 0.8,
        })
      }
    }
    function drawHexes(t: number) {
      for (const h of hexes) {
        const a = (Math.sin(t * h.speed * 0.003 + h.phase) * 0.5 + 0.5) * 0.1
        bx.save()
        bx.globalAlpha = a
        bx.strokeStyle = cfg.accentHex
        bx.lineWidth = 0.6
        bx.beginPath()
        for (let i = 0; i < 6; i++) {
          const ang = Math.PI / 6 + (i * Math.PI) / 3
          const fx = h.x + h.r * Math.cos(ang)
          const fy = h.y + h.r * Math.sin(ang)
          i === 0 ? bx.moveTo(fx, fy) : bx.lineTo(fx, fy)
        }
        bx.closePath()
        bx.stroke()
        bx.restore()
      }
    }

    // Pulse rings
    const pulses: { x: number; y: number; r: number; maxR: number; life: number; color: string }[] = []
    function addPulse() {
      pulses.push({
        x: Math.random() * bg.width,
        y: Math.random() * bg.height,
        r: 0,
        maxR: 70 + Math.random() * 60,
        life: 1,
        color: Math.random() > 0.5 ? cfg.accentHex : cfg.accentLight,
      })
    }
    pulseTimerRef.current = setInterval(addPulse, 600)

    function drawPulses() {
      for (let i = pulses.length - 1; i >= 0; i--) {
        const p = pulses[i]
        p.r += 1.6
        p.life = 1 - p.r / p.maxR
        if (p.life <= 0) { pulses.splice(i, 1); continue }
        bx.save()
        bx.globalAlpha = p.life * 0.3
        bx.strokeStyle = p.color
        bx.lineWidth = 1
        bx.beginPath()
        bx.arc(p.x, p.y, p.r, 0, Math.PI * 2)
        bx.stroke()
        bx.restore()
      }
    }

    // Scan lines
    const scanLines = [
      { y: 0, speed: 0.9, color: cfg.accentHex },
      { y: bg.height * 0.45, speed: 0.55, color: cfg.accentLight },
    ]
    function drawScanLines() {
      for (const s of scanLines) {
        bx.save()
        bx.globalAlpha = 0.05
        bx.fillStyle = s.color
        bx.fillRect(0, s.y, bg.width, 2)
        bx.restore()
        s.y += s.speed
        if (s.y > bg.height) s.y = -2
      }
    }

    // Floating nodes
    const nodes = Array.from({ length: 16 }, () => ({
      x: Math.random() * bg.width,
      y: Math.random() * bg.height,
      vx: (Math.random() - 0.5) * 0.45,
      vy: (Math.random() - 0.5) * 0.45,
      r: 1.5 + Math.random() * 3,
      color: Math.random() > 0.5 ? cfg.accentHex : cfg.accentLight,
    }))
    function drawNodes() {
      for (const n of nodes) {
        n.x += n.vx; n.y += n.vy
        if (n.x < 0 || n.x > bg.width) n.vx *= -1
        if (n.y < 0 || n.y > bg.height) n.vy *= -1
        bx.save(); bx.globalAlpha = 0.7
        bx.fillStyle = n.color
        bx.beginPath(); bx.arc(n.x, n.y, n.r, 0, Math.PI * 2); bx.fill()
        bx.restore()
      }
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const dx = nodes[i].x - nodes[j].x, dy = nodes[i].y - nodes[j].y
          const d = Math.sqrt(dx * dx + dy * dy)
          if (d < 130) {
            bx.save(); bx.globalAlpha = (1 - d / 130) * 0.2
            bx.strokeStyle = cfg.accentHex; bx.lineWidth = 0.5
            bx.beginPath(); bx.moveTo(nodes[i].x, nodes[i].y); bx.lineTo(nodes[j].x, nodes[j].y); bx.stroke()
            bx.restore()
          }
        }
      }
    }

    // Burst particles (success)
    const bursts: { x: number; y: number; vx: number; vy: number; r: number; life: number; decay: number; color: string }[] = []
    function triggerBurst() {
      for (let i = 0; i < 32; i++) {
        const ang = Math.random() * Math.PI * 2
        const spd = 2 + Math.random() * 5
        bursts.push({
          x: pc.width / 2, y: pc.height / 2,
          vx: Math.cos(ang) * spd, vy: Math.sin(ang) * spd,
          r: 2 + Math.random() * 3,
          life: 1, decay: 0.013 + Math.random() * 0.018,
          color: Math.random() > 0.5 ? cfg.burstColor : cfg.accentHex,
        })
      }
    }

    let burstFired = false
    function drawBursts() {
      px.clearRect(0, 0, pc.width, pc.height)
      for (let i = bursts.length - 1; i >= 0; i--) {
        const b = bursts[i]
        b.x += b.vx; b.y += b.vy; b.vy += 0.07; b.life -= b.decay
        if (b.life <= 0) { bursts.splice(i, 1); continue }
        px.save(); px.globalAlpha = b.life
        px.fillStyle = b.color
        px.beginPath(); px.arc(b.x, b.y, b.r, 0, Math.PI * 2); px.fill()
        px.restore()
      }
    }

    let t = 0
    function loop() {
      t++
      drawMatrix()
      drawHexes(t)
      drawPulses()
      drawScanLines()
      drawNodes()

      // fire burst once on done
      if (progress >= 100 && !burstFired) {
        burstFired = true
        triggerBurst()
        setTimeout(triggerBurst, 300)
      }
      drawBursts()
      rafRef.current = requestAnimationFrame(loop)
    }
    loop()

    return () => {
      cancelAnimationFrame(rafRef.current)
      clearInterval(pulseTimerRef.current)
      window.removeEventListener('resize', resize)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, type])

  // ── Computed values ───────────────────────────────────────────────────────
  const pct = Math.min(100, Math.max(0, Math.round(progress)))
  const stepIdx = Math.min(
    Math.floor((pct / 100) * (resolvedSteps.length - 1)),
    resolvedSteps.length - 1
  )
  const currentStep = done ? resolvedSteps[resolvedSteps.length - 1] : resolvedSteps[stepIdx]
  const CIRC = 188 // 2π × r=30
  const dashOffset = CIRC - (CIRC * pct) / 100

  if (!open) return null

  return (
    <div
      className={`hacker-overlay${closing ? ' hacker-overlay--closing' : ''}`}
      // screen lock: no pointer events pass through
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(3,5,12,0.75)',
        backdropFilter: 'blur(3px)',
        WebkitBackdropFilter: 'blur(3px)',
        opacity: closing ? 0 : 1,
        transition: 'opacity .35s ease',
        userSelect: 'none',
      }}
    >
      {/* BG canvas – matrix + hex + network */}
      <canvas
        ref={bgRef}
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          pointerEvents: 'none',
        }}
      />
      {/* Particle canvas – bursts */}
      <canvas
        ref={pRef}
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          pointerEvents: 'none',
        }}
      />

      {/* Popup card */}
      <div
        style={{
          position: 'relative',
          zIndex: 2,
          background: 'rgba(10,12,28,0.96)',
          border: '1px solid rgba(255,255,255,0.07)',
          borderRadius: 20,
          padding: '28px 26px 22px',
          width: 320,
          maxWidth: '90vw',
          boxShadow: `0 0 40px 4px ${cfg.accentHex}22`,
          animation: 'hackerCardIn .38s cubic-bezier(.34,1.56,.64,1) forwards',
          overflow: 'hidden',
        }}
      >
        {/* Inner scan line */}
        <div style={{
          position: 'absolute', left: 0, right: 0, height: 2,
          background: `linear-gradient(90deg, transparent, ${cfg.accentHex}88, transparent)`,
          top: 0, animation: 'scanDown 2.2s linear infinite',
          pointerEvents: 'none',
        }} />

        {/* Ring + icon */}
        <div style={{ width: 72, height: 72, margin: '0 auto 14px', position: 'relative' }}>
          <svg viewBox="0 0 72 72" style={{ width: '100%', height: '100%' }}>
            <circle
              cx="36" cy="36" r="30" fill="none"
              stroke="rgba(255,255,255,0.06)" strokeWidth="5"
            />
            <circle
              cx="36" cy="36" r="30" fill="none"
              stroke={cfg.accentHex} strokeWidth="5"
              strokeLinecap="round"
              strokeDasharray={CIRC}
              strokeDashoffset={dashOffset}
              transform="rotate(-90 36 36)"
              style={{ transition: 'stroke-dashoffset .1s linear' }}
            />
          </svg>
          <div style={{
            position: 'absolute', inset: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 26,
          }}>
            {cfg.icon}
          </div>
        </div>

        {/* Title */}
        <p style={{ textAlign: 'center', fontSize: 16, fontWeight: 500, color: '#fff', marginBottom: 3 }}>
          {cfg.title}
        </p>
        {/* Timestamp */}
        <p style={{
          textAlign: 'center', fontSize: 11, color: 'rgba(255,255,255,0.3)',
          fontFamily: 'monospace', marginBottom: 18,
        }}>
          ⏱ {ts}
        </p>

        {/* Data grid */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 14 }}>
          {[
            { label: 'File / Data', value: resolvedFile },
            { label: 'Ukuran', value: resolvedSize },
          ].map(item => (
            <div key={item.label} style={{
              background: 'rgba(255,255,255,0.04)', borderRadius: 10, padding: '9px 11px',
            }}>
              <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 3 }}>
                {item.label}
              </div>
              <div style={{ fontSize: 12, fontWeight: 500, color: '#e0e0f0', wordBreak: 'break-all' }}>
                {item.value}
              </div>
            </div>
          ))}
        </div>

        {/* Progress bar */}
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
          <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)' }}>Progress</span>
          <span style={{ fontSize: 11, fontWeight: 500, color: '#fff' }}>{pct}%</span>
        </div>
        <div style={{
          height: 5, background: 'rgba(255,255,255,0.06)',
          borderRadius: 99, overflow: 'hidden', marginBottom: 14,
        }}>
          <div style={{
            height: '100%',
            width: `${pct}%`,
            borderRadius: 99,
            background: `linear-gradient(90deg, ${cfg.accentHex}, ${cfg.accentLight})`,
            transition: 'width .1s linear',
          }} />
        </div>

        {/* Status badge */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          gap: 7, fontSize: 12, fontWeight: 500,
          padding: '7px 0', borderRadius: 99,
          background: done
            ? `rgba(${type === 'backup' ? '124,108,248' : type === 'restore' ? '0,196,140' : '255,107,74'},.15)`
            : 'rgba(255,255,255,0.05)',
          color: done ? cfg.accentLight : 'rgba(255,255,255,0.55)',
          transition: 'background .3s, color .3s',
        }}>
          <span style={{
            display: 'inline-block',
            width: 6, height: 6, borderRadius: '50%',
            background: cfg.accentHex,
            animation: done ? 'none' : 'dotPulse 1s ease-in-out infinite',
          }} />
          {currentStep}
        </div>
      </div>

      <style>{`
        @keyframes hackerCardIn {
          from { transform: scale(.84) translateY(24px); opacity: 0; }
          to   { transform: scale(1) translateY(0);     opacity: 1; }
        }
        @keyframes scanDown {
          0%   { top: -2px; }
          100% { top: 100%; }
        }
        @keyframes dotPulse {
          0%,100% { opacity:1; transform:scale(1);   }
          50%      { opacity:.3; transform:scale(.6); }
        }
      `}</style>
    </div>
  )
}
