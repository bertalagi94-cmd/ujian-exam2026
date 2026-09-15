'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { Activity, X, Maximize2, Minimize2, RefreshCw, Shield, Database, Users, AlertTriangle, CheckCircle, BarChart3 } from 'lucide-react'

// ─── Types ──────────────────────────────────────────────────────────────────

interface MonitoringData {
  server: {
    status: 'AMAN' | 'NORMAL' | 'WASPADA' | 'BERAT' | 'KRITIS'
    score: number
    dbResponseMs: number
    timestamp: string
  }
  aktivitas: {
    loginHariIni: number
    aktifitas5MenitTerakhir: number
    sesiUjianAktif: number
    pelanggaranHariIni: number
    siswaAktifMengerjakan: number
    submitHariIni: number
  }
  logs: Array<{ id: string; user_id: string; aksi: string; detail: string; created_at: string }>
  sesiAktif: Array<{
    id: string; kelas: string; mapel_id: string; nama_mapel: string
    waktu_mulai: string; jumlah_peserta: number; durasi_menit: number
    durasi_seharusnya: number; terlambat: boolean
  }>
  pelanggaran: Array<{ id: string; nis: string; nama_siswa: string; jenis: string; created_at: string }>
  maintenanceAktif: boolean
}

interface UserNode {
  id: string
  label: string
  role: string
  color: string
  lane: number        // posisi vertikal (0-based)
  enteredAt: number
  aksi: string
  detail: string
}

interface Particle {
  id: string
  userNodeId: string
  progress: number    // 0..1 dari kiri ke kanan
  color: string
  speed: number
  phase: 'to-db' | 'to-proc' | 'to-out'
}

// ─── Konstanta ───────────────────────────────────────────────────────────────

const STATUS_CFG = {
  AMAN:    { color: '#10b981', glow: '#10b98155', label: 'AMAN',    emoji: '✦' },
  NORMAL:  { color: '#3b82f6', glow: '#3b82f655', label: 'NORMAL',  emoji: '●' },
  WASPADA: { color: '#f59e0b', glow: '#f59e0b55', label: 'WASPADA', emoji: '▲' },
  BERAT:   { color: '#f97316', glow: '#f9731655', label: 'BERAT',   emoji: '◆' },
  KRITIS:  { color: '#ef4444', glow: '#ef444455', label: 'KRITIS',  emoji: '⚠' },
}

const ROLE_CFG: Record<string, { color: string; label: string }> = {
  SISWA:    { color: '#6366f1', label: 'Siswa' },
  GURU:     { color: '#10b981', label: 'Guru' },
  ADMIN:    { color: '#f59e0b', label: 'Admin' },
  KEPSEK:   { color: '#ec4899', label: 'Kepsek' },
  PENGAWAS: { color: '#8b5cf6', label: 'Pengawas' },
  SISTEM:   { color: '#64748b', label: 'Sistem' },
}

// PENTING: satu-satunya `aksi` yang benar-benar pernah tercatat ke
// log_aktivitas di seluruh aplikasi ini adalah 'LOGIN' — dipakai untuk
// SEMUA role (siswa, guru, admin, kepsek), lihat src/app/api/auth/login/route.ts.
// Mengecek prefix pada `aksi` (mis. aksi.startsWith('SISWA')) tidak pernah
// cocok karena nilainya selalu literal "LOGIN". Info role yang sebenarnya
// ada di teks `detail`, contoh: "Login sebagai SISWA (Budi)",
// "Login sebagai GURU", "Login sebagai ADMIN", "Login sebagai KEPSEK".
// Jadi role dideteksi dari `detail` dulu, baru fallback ke prefix `aksi`
// untuk jenis log lain yang mungkin ditambahkan di masa depan.
function detectRole(aksi: string, detail?: string): string {
  const d = (detail ?? '').toUpperCase()
  if (d.includes('SISWA')) return 'SISWA'
  if (d.includes('GURU')) return 'GURU'
  if (d.includes('KEPSEK')) return 'KEPSEK'
  if (d.includes('ADMIN')) return 'ADMIN'
  if (d.includes('PENGAWAS')) return 'PENGAWAS'

  if (aksi.startsWith('SISWA') || aksi === 'MULAI_UJIAN' || aksi === 'SUBMIT_UJIAN') return 'SISWA'
  if (aksi.startsWith('GURU') || aksi === 'BUAT_SOAL' || aksi === 'VALIDASI') return 'GURU'
  if (aksi.startsWith('ADMIN')) return 'ADMIN'
  if (aksi.startsWith('PENGAWAS')) return 'PENGAWAS'
  return 'SISTEM'
}

function formatAgo(iso: string) {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (diff < 60) return `${diff}d`
  if (diff < 3600) return `${Math.floor(diff / 60)}m`
  return `${Math.floor(diff / 3600)}j`
}

// ─── SVG Canvas Diagram ───────────────────────────────────────────────────────

interface DiagramProps {
  data: MonitoringData | null
  userNodes: UserNode[]
  particles: Particle[]
  width: number
  height: number
}

function DiagramCanvas({ data, userNodes, particles, width, height }: DiagramProps) {
  const status = data?.server.status ?? 'NORMAL'
  const cfg = STATUS_CFG[status]

  // Layout
  const pad = 24
  const sourceX = pad + 40
  const dbX = width * 0.36
  const procX = width * 0.58
  const outX = width - pad - 48

  const laneCount = Math.max(4, userNodes.length + 1)
  const laneH = Math.min(52, (height - 80) / laneCount)
  const startY = 48 + laneH / 2

  // Output nodes positions
  const outNodes = [
    { label: 'Ujian', icon: '📝', color: '#6366f1', y: height * 0.22 },
    { label: 'Laporan', icon: '📊', color: '#3b82f6', y: height * 0.50 },
    { label: 'Siswa', icon: '👥', color: '#10b981', y: height * 0.78 },
  ]

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{ display: 'block' }}>
      <defs>
        <radialGradient id="dbGrad" cx="50%" cy="30%" r="70%">
          <stop offset="0%" stopColor="#4f8ef7" />
          <stop offset="100%" stopColor="#1a3a7c" />
        </radialGradient>
        <radialGradient id="procGrad" cx="50%" cy="30%" r="70%">
          <stop offset="0%" stopColor={cfg.color} stopOpacity="0.9" />
          <stop offset="100%" stopColor={cfg.color} stopOpacity="0.4" />
        </radialGradient>
        <radialGradient id="outGrad1" cx="50%" cy="30%" r="70%">
          <stop offset="0%" stopColor="#8b6fff" />
          <stop offset="100%" stopColor="#4c2ab8" />
        </radialGradient>
        <radialGradient id="outGrad2" cx="50%" cy="30%" r="70%">
          <stop offset="0%" stopColor="#5b9fff" />
          <stop offset="100%" stopColor="#1a3fa0" />
        </radialGradient>
        <radialGradient id="outGrad3" cx="50%" cy="30%" r="70%">
          <stop offset="0%" stopColor="#06e6a0" />
          <stop offset="100%" stopColor="#065f46" />
        </radialGradient>
        <filter id="glow">
          <feGaussianBlur stdDeviation="3" result="blur" />
          <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
        <filter id="glow-sm">
          <feGaussianBlur stdDeviation="1.5" result="blur" />
          <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
        {/* Gradient lines */}
        <linearGradient id="lineGrad" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.6" />
          <stop offset="100%" stopColor={cfg.color} stopOpacity="0.6" />
        </linearGradient>
        <linearGradient id="outLineGrad" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor={cfg.color} stopOpacity="0.6" />
          <stop offset="100%" stopColor="#6366f1" stopOpacity="0.6" />
        </linearGradient>
      </defs>

      {/* ── Background grid ── */}
      {Array.from({ length: Math.ceil(width / 40) }).map((_, i) => (
        <line key={`gx${i}`} x1={i * 40} y1={0} x2={i * 40} y2={height}
          stroke="rgba(255,255,255,0.03)" strokeWidth={1} />
      ))}
      {Array.from({ length: Math.ceil(height / 40) }).map((_, i) => (
        <line key={`gy${i}`} x1={0} y1={i * 40} x2={width} y2={i * 40}
          stroke="rgba(255,255,255,0.03)" strokeWidth={1} />
      ))}

      {/* ── Trunk line: source → main DB ── */}
      <line x1={sourceX + 32} y1={height / 2} x2={dbX - 36} y2={height / 2}
        stroke="url(#lineGrad)" strokeWidth={1.5} strokeDasharray="6 4" opacity={0.4} />

      {/* ── Lines: main DB → proc center ── */}
      <line x1={dbX + 36} y1={height / 2} x2={procX - 28} y2={height / 2}
        stroke="url(#lineGrad)" strokeWidth={1.5} strokeDasharray="6 4" opacity={0.5} />

      {/* ── Lines: proc → each output ── */}
      {outNodes.map((o) => (
        <line key={o.label}
          x1={procX + 28} y1={height / 2}
          x2={outX - 32} y2={o.y}
          stroke={o.color} strokeWidth={1.2} strokeDasharray="5 4" opacity={0.35} />
      ))}

      {/* ── Lines: output → result icons ── */}
      {outNodes.map((o) => (
        <line key={`r-${o.label}`}
          x1={outX + 32} y1={o.y}
          x2={outX + 70} y2={o.y}
          stroke={o.color} strokeWidth={1.2} opacity={0.4} />
      ))}

      {/* ── User node tracks ── */}
      {userNodes.map((u, idx) => {
        const y = startY + idx * laneH
        return (
          <g key={u.id}>
            {/* track line */}
            <line x1={sourceX + 32} y1={y} x2={dbX - 36} y2={y}
              stroke={u.color} strokeWidth={1} opacity={0.25} strokeDasharray="4 3" />
            {/* user icon box */}
            <rect x={sourceX - 24} y={y - 16} width={32} height={32}
              rx={8} fill={u.color + '22'} stroke={u.color + '66'} strokeWidth={1} />
            <text x={sourceX - 8} y={y + 5} textAnchor="middle" fontSize={13}>
              {u.role === 'SISWA' ? '🎓' : u.role === 'GURU' ? '👨‍🏫' : u.role === 'ADMIN' ? '⚙️' : u.role === 'PENGAWAS' ? '👁️' : '💻'}
            </text>
            {/* name label */}
            <text x={sourceX + 14} y={y - 4} fontSize={9} fill={u.color} fontWeight="700" letterSpacing="0.05em">
              {ROLE_CFG[u.role]?.label ?? 'Sistem'}
            </text>
            <text x={sourceX + 14} y={y + 7} fontSize={8} fill="rgba(255,255,255,0.45)">
              {(() => {
                // Ambil nama dari dalam kurung di `detail` jika ada, mis.
                // "Login sebagai SISWA (Budi)" → "Budi". Kalau tidak ada,
                // tampilkan NIS/username (u.label) — lebih informatif
                // daripada teks aksi generik "LOGIN" yang sama untuk semua orang.
                const m = /\(([^)]+)\)/.exec(u.detail)
                const txt = m ? m[1] : u.label
                return txt.length > 14 ? txt.slice(0, 14) + '…' : txt
              })()}
            </text>
          </g>
        )
      })}

      {/* ── Particles ── */}
      {particles.map((p) => {
        const u = userNodes.find(n => n.id === p.userNodeId)
        const laneIdx = u ? userNodes.indexOf(u) : 0
        const trackY = startY + laneIdx * laneH

        let x: number, y: number
        if (p.phase === 'to-db') {
          x = sourceX + 32 + (dbX - 36 - sourceX - 32) * p.progress
          y = trackY + (height / 2 - trackY) * p.progress
        } else if (p.phase === 'to-proc') {
          x = dbX + 36 + (procX - 28 - dbX - 36) * p.progress
          y = height / 2
        } else {
          // to one of the outputs
          const outIdx = laneIdx % outNodes.length
          const targetY = outNodes[outIdx].y
          x = procX + 28 + (outX - 32 - procX - 28) * p.progress
          y = height / 2 + (targetY - height / 2) * p.progress
        }

        return (
          <circle key={p.id} cx={x} cy={y} r={3} fill={p.color}
            filter="url(#glow-sm)" opacity={0.9} />
        )
      })}

      {/* ── Main DB node ── */}
      <g transform={`translate(${dbX},${height / 2})`} filter="url(#glow)">
        <ellipse cx={0} cy={-22} rx={32} ry={10} fill="url(#dbGrad)" />
        <rect x={-32} y={-22} width={64} height={44} fill="url(#dbGrad)" />
        <ellipse cx={0} cy={22} rx={32} ry={10} fill="#1a3a7c" />
        <ellipse cx={0} cy={-22} rx={32} ry={10} fill="#5b8ef0" opacity={0.7} />
        {/* DB lines */}
        <line x1={-24} y1={-8} x2={24} y2={-8} stroke="rgba(255,255,255,0.2)" strokeWidth={1} />
        <line x1={-24} y1={2} x2={24} y2={2} stroke="rgba(255,255,255,0.15)" strokeWidth={1} />
        <text x={0} y={42} textAnchor="middle" fontSize={10} fill="#93c5fd" fontWeight="600">Database</text>
        <text x={0} y={54} textAnchor="middle" fontSize={9} fill="rgba(255,255,255,0.4)">
          {data?.server.dbResponseMs ?? 0}ms
        </text>
      </g>

      {/* ── Processor / sync node ── */}
      <g transform={`translate(${procX},${height / 2})`} filter="url(#glow)">
        <circle cx={0} cy={0} r={28} fill={cfg.color + '22'} stroke={cfg.color} strokeWidth={1.5} />
        <circle cx={0} cy={0} r={20} fill={cfg.color + '33'} />
        {/* Rotation arrows - static representation */}
        <path d="M -14,-8 A 16 16 0 0 1 14,-8" stroke={cfg.color} strokeWidth={2} fill="none" strokeLinecap="round" />
        <path d="M 14,8 A 16 16 0 0 1 -14,8" stroke={cfg.color} strokeWidth={2} fill="none" strokeLinecap="round" />
        <polygon points="-14,-8 -18,-14 -8,-12" fill={cfg.color} />
        <polygon points="14,8 18,14 8,12" fill={cfg.color} />
        <text x={0} y={44} textAnchor="middle" fontSize={10} fill={cfg.color} fontWeight="700">
          {cfg.emoji} {cfg.label}
        </text>
      </g>

      {/* ── Output DB nodes ── */}
      {outNodes.map((o, i) => {
        const gradId = ['outGrad1', 'outGrad2', 'outGrad3'][i]
        return (
          <g key={o.label} transform={`translate(${outX},${o.y})`}>
            <ellipse cx={0} cy={-14} rx={26} ry={8} fill={`url(#${gradId})`} />
            <rect x={-26} y={-14} width={52} height={28} fill={`url(#${gradId})`} />
            <ellipse cx={0} cy={14} rx={26} ry={8} fill={o.color + '44'} />
            <ellipse cx={0} cy={-14} rx={26} ry={8} fill={o.color + 'aa'} opacity={0.5} />
            <text x={0} y={30} textAnchor="middle" fontSize={9} fill={o.color} fontWeight="600">{o.label}</text>
          </g>
        )
      })}

      {/* ── Result icons ── */}
      {outNodes.map((o) => (
        <g key={`ri-${o.label}`} transform={`translate(${outX + 72},${o.y})`}>
          <rect x={-20} y={-20} width={40} height={40} rx={10}
            fill={o.color + '18'} stroke={o.color + '55'} strokeWidth={1} />
          <text x={0} y={7} textAnchor="middle" fontSize={16}>{o.icon}</text>
        </g>
      ))}

      {/* ── Source devices (left) ── */}
      {[
        { y: height * 0.18, icon: '🖥️', label: 'Server' },
        { y: height * 0.38, icon: '💻', label: 'Laptop' },
        { y: height * 0.62, icon: '☁️', label: 'Cloud' },
        { y: height * 0.82, icon: '📱', label: 'Mobile' },
      ].map((d) => (
        <g key={d.label} transform={`translate(${pad},${d.y})`}>
          <rect x={-18} y={-18} width={36} height={36} rx={9}
            fill="rgba(59,130,246,0.1)" stroke="rgba(59,130,246,0.3)" strokeWidth={1} />
          <text x={0} y={8} textAnchor="middle" fontSize={14}>{d.icon}</text>
          {/* connector line to source */}
          <line x1={18} y1={0} x2={sourceX - pad - 44} y2={height / 2 - d.y}
            stroke="rgba(59,130,246,0.3)" strokeWidth={1} strokeDasharray="4 3" />
        </g>
      ))}

      {/* ── Bottom status bar icons ── */}
      {[
        { icon: <Shield size={12} />, label: data?.maintenanceAktif ? 'Maintenance' : 'Aman', color: data?.maintenanceAktif ? '#f59e0b' : '#10b981' },
        { icon: <RefreshCw size={12} />, label: 'Sinkron', color: '#3b82f6' },
        { icon: <Database size={12} />, label: 'Database', color: '#6366f1' },
        { icon: <Activity size={12} />, label: 'Monitor', color: '#8b5cf6' },
        { icon: <BarChart3 size={12} />, label: 'Analitik', color: '#10b981' },
      ].map((b, i) => {
        const bw = 64, bh = 36, totalW = bw * 5 + 8 * 4
        const bx = (width - totalW) / 2 + i * (bw + 8)
        const by = height - 46
        return (
          <g key={b.label}>
            <rect x={bx} y={by} width={bw} height={bh} rx={8}
              fill="rgba(255,255,255,0.05)" stroke="rgba(255,255,255,0.1)" strokeWidth={1} />
            <text x={bx + bw / 2} y={by + 13} textAnchor="middle" fontSize={9} fill={b.color} fontWeight="600">
              {b.label}
            </text>
            <line x1={bx + bw / 2 - 6} y1={by + 24} x2={bx + bw / 2 + 6} y2={by + 24}
              stroke={b.color} strokeWidth={1.5} strokeLinecap="round" opacity={0.7} />
          </g>
        )
      })}
    </svg>
  )
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function NetworkFlowMonitor() {
  const [open, setOpen] = useState(false)
  const [fullscreen, setFullscreen] = useState(false)
  const [data, setData] = useState<MonitoringData | null>(null)
  const [loading, setLoading] = useState(false)
  const [userNodes, setUserNodes] = useState<UserNode[]>([])
  const [particles, setParticles] = useState<Particle[]>([])
  const [tick, setTick] = useState(0)
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const animRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const particleId = useRef(0)
  const seenLogs = useRef<Set<string>>(new Set())

  // Canvas size
  const canvasW = fullscreen ? Math.min(window?.innerWidth ?? 900, 1100) - 32 : 780
  const canvasH = fullscreen ? Math.min(window?.innerHeight ?? 600, 700) - 120 : 340

  // Fetch data
  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null
      const r = await fetch('/api/admin/monitoring', {
        cache: 'no-store',
        headers: token ? { Authorization: 'Bearer ' + token } : {},
      })
      if (r.ok) {
        const json: MonitoringData = await r.json()
        setData(json)
        setLastRefresh(new Date())

        // Build user nodes from recent logs (max 6 lanes)
        const recentLogs = json.logs.slice(0, 10)
        const newNodes: UserNode[] = []
        recentLogs.forEach((log, idx) => {
          if (idx >= 6) return
          const role = detectRole(log.aksi, log.detail)
          newNodes.push({
            id: log.id,
            label: log.user_id,
            role,
            color: ROLE_CFG[role]?.color ?? '#64748b',
            lane: idx,
            enteredAt: Date.now(),
            aksi: log.aksi,
            detail: log.detail ?? '',
          })
          // Spawn particles for new logs
          if (!seenLogs.current.has(log.id)) {
            seenLogs.current.add(log.id)
            const pid = `p-${++particleId.current}`
            setParticles(prev => [...prev.slice(-30), {
              id: pid,
              userNodeId: log.id,
              progress: 0,
              color: ROLE_CFG[role]?.color ?? '#64748b',
              speed: 0.008 + Math.random() * 0.006,
              phase: 'to-db',
            }])
          }
        })
        setUserNodes(newNodes)
      }
    } catch { /* silent */ }
    finally { setLoading(false) }
  }, [])

  // Animation loop
  useEffect(() => {
    if (!open) return
    animRef.current = setInterval(() => {
      setTick(t => t + 1)
      setParticles(prev => {
        const next: typeof prev = []
        for (const p of prev) {
          const np = p.progress + p.speed
          if (np >= 1) {
            // Advance phase
            if (p.phase === 'to-db') {
              next.push({ ...p, progress: 0, phase: 'to-proc' })
            } else if (p.phase === 'to-proc') {
              next.push({ ...p, progress: 0, phase: 'to-out' })
            }
            // 'to-out' done → remove
          } else {
            next.push({ ...p, progress: np })
          }
        }
        return next
      })
    }, 33) // ~30fps

    return () => { if (animRef.current) clearInterval(animRef.current) }
  }, [open])

  // Polling
  useEffect(() => {
    if (!open) return
    fetchData()
    intervalRef.current = setInterval(fetchData, 15000)
    return () => { if (intervalRef.current) clearInterval(intervalRef.current) }
  }, [open, fetchData])

  // ESC key
  useEffect(() => {
    const fn = (e: KeyboardEvent) => { if (e.key === 'Escape' && fullscreen) setFullscreen(false) }
    window.addEventListener('keydown', fn)
    return () => window.removeEventListener('keydown', fn)
  }, [fullscreen])

  const status = data?.server.status ?? 'NORMAL'
  const cfg = STATUS_CFG[status]

  // Dummy tick consumer to trigger re-render for animation
  void tick

  const panelStyle: React.CSSProperties = fullscreen
    ? {
        position: 'fixed', inset: 0, zIndex: 9998,
        background: 'linear-gradient(160deg,#050e1f 0%,#0a1628 50%,#0d0f2e 100%)',
        display: 'flex', flexDirection: 'column',
        borderRadius: 0,
      }
    : {
        position: 'absolute', bottom: 'calc(100% + 12px)', right: 0,
        width: 820, borderRadius: 18,
        background: 'linear-gradient(160deg,#050e1f 0%,#0a1628 50%,#0d0f2e 100%)',
        border: '1px solid rgba(255,255,255,0.08)',
        boxShadow: '0 32px 80px rgba(0,0,0,0.7), 0 0 0 1px rgba(255,255,255,0.04)',
        overflow: 'hidden', display: 'flex', flexDirection: 'column',
      }

  return (
    <>
      <style>{`
        @keyframes nfm-pulse { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:.4;transform:scale(1.6)} }
        @keyframes nfm-spin { to{transform:rotate(360deg)} }
        @keyframes nfm-slide { from{opacity:0;transform:translateY(16px) scale(.97)} to{opacity:1;transform:translateY(0) scale(1)} }
        @keyframes nfm-proc-spin { to{transform:rotate(360deg)} }
        .nfm-pulse { animation: nfm-pulse 2.2s ease-in-out infinite }
        .nfm-spin  { animation: nfm-spin .9s linear infinite }
        .nfm-slide { animation: nfm-slide .25s cubic-bezier(.34,1.56,.64,1) }
        .nfm-btn   { background:none; border:none; cursor:pointer; color:rgba(255,255,255,0.4); 
                     padding:4px; border-radius:6px; display:flex; align-items:center; transition:color .15s }
        .nfm-btn:hover { color:rgba(255,255,255,0.9) }
      `}</style>

      <div style={{ position: 'fixed', bottom: 88, right: 24, zIndex: 49 }}>

        {/* ── Panel ── */}
        {open && (
          <div className="nfm-slide" style={panelStyle}>

            {/* Header */}
            <div style={{
              padding: '14px 18px 12px',
              borderBottom: '1px solid rgba(255,255,255,0.07)',
              display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0,
            }}>
              {/* Status dot */}
              <span className="nfm-pulse" style={{
                width: 10, height: 10, borderRadius: '50%',
                background: cfg.color, boxShadow: `0 0 8px ${cfg.color}`,
                flexShrink: 0,
              }} />
              <span style={{ fontSize: 13, fontWeight: 800, color: '#fff', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                Network Flow Monitor
              </span>
              <span style={{
                fontSize: 10, fontWeight: 700, color: cfg.color,
                background: cfg.color + '22', border: `1px solid ${cfg.color}44`,
                padding: '2px 8px', borderRadius: 20, letterSpacing: '0.08em',
              }}>
                {cfg.emoji} {cfg.label}
              </span>

              {/* Stats pills */}
              <div style={{ display: 'flex', gap: 6, marginLeft: 'auto' }}>
                {[
                  { icon: <Users size={10} />, val: data?.aktivitas.siswaAktifMengerjakan ?? 0, color: '#6366f1', label: 'Aktif' },
                  { icon: <AlertTriangle size={10} />, val: data?.aktivitas.pelanggaranHariIni ?? 0, color: '#ef4444', label: 'Langs.' },
                  { icon: <CheckCircle size={10} />, val: data?.aktivitas.submitHariIni ?? 0, color: '#10b981', label: 'Submit' },
                ].map((s) => (
                  <div key={s.label} style={{
                    display: 'flex', alignItems: 'center', gap: 4,
                    background: s.color + '18', border: `1px solid ${s.color}33`,
                    borderRadius: 8, padding: '3px 8px',
                  }}>
                    <span style={{ color: s.color }}>{s.icon}</span>
                    <span style={{ fontSize: 11, fontWeight: 800, color: s.color }}>{s.val}</span>
                    <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.4)' }}>{s.label}</span>
                  </div>
                ))}
              </div>

              {loading && <RefreshCw size={13} color="#64748b" className="nfm-spin" style={{ marginLeft: 4 }} />}
              {lastRefresh && !loading && (
                <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.25)', marginLeft: 4 }}>
                  {lastRefresh.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                </span>
              )}
              <button className="nfm-btn" onClick={() => setFullscreen(f => !f)} title={fullscreen ? 'Keluar fullscreen' : 'Fullscreen'}>
                {fullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
              </button>
              <button className="nfm-btn" onClick={() => setOpen(false)} title="Tutup">
                <X size={14} />
              </button>
            </div>

            {/* Main canvas */}
            <div style={{ flex: 1, overflow: 'hidden', position: 'relative', padding: '8px 12px 0' }}>
              <DiagramCanvas
                data={data}
                userNodes={userNodes}
                particles={particles}
                width={canvasW}
                height={canvasH}
              />
            </div>

            {/* Footer log strip */}
            <div style={{
              padding: '8px 18px 12px',
              borderTop: '1px solid rgba(255,255,255,0.06)',
              display: 'flex', gap: 8, overflowX: 'auto',
              flexShrink: 0,
            }}>
              {(data?.logs ?? []).slice(0, 8).map((l) => {
                const role = detectRole(l.aksi, l.detail)
                const c = ROLE_CFG[role]?.color ?? '#64748b'
                return (
                  <div key={l.id} style={{
                    flexShrink: 0, background: c + '12', border: `1px solid ${c}33`,
                    borderRadius: 8, padding: '4px 10px', display: 'flex', flexDirection: 'column', gap: 2,
                    minWidth: 100,
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <span style={{ width: 6, height: 6, borderRadius: '50%', background: c, flexShrink: 0 }} />
                      <span style={{ fontSize: 9, fontWeight: 700, color: c, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                        {ROLE_CFG[role]?.label}
                      </span>
                      <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.25)', marginLeft: 'auto' }}>
                        {formatAgo(l.created_at)}
                      </span>
                    </div>
                    <span style={{ fontSize: 10, fontWeight: 600, color: 'rgba(255,255,255,0.7)', whiteSpace: 'nowrap' }}>
                      {l.aksi.length > 16 ? l.aksi.slice(0, 16) + '…' : l.aksi}
                    </span>
                  </div>
                )
              })}
              {(data?.logs?.length ?? 0) === 0 && !loading && (
                <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.25)', padding: '4px 0' }}>
                  Menunggu aktivitas…
                </span>
              )}
            </div>
          </div>
        )}

        {/* ── Floating trigger button ── */}
        <button
          onClick={() => setOpen(o => !o)}
          title="Network Flow Monitor"
          style={{
            width: 48, height: 48, borderRadius: '50%',
            background: data
              ? `linear-gradient(135deg, ${cfg.color}cc, ${cfg.color}77)`
              : 'linear-gradient(135deg,#1e3a5f,#0f1f3d)',
            border: `2px solid ${data ? cfg.color : 'rgba(255,255,255,0.15)'}`,
            boxShadow: data
              ? `0 4px 20px ${cfg.glow}, 0 2px 8px rgba(0,0,0,0.5)`
              : '0 4px 16px rgba(0,0,0,0.4)',
            cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            transition: 'all .2s',
            position: 'relative',
          }}
        >
          {/* Pulse ring */}
          {data && (
            <span className="nfm-pulse" style={{
              position: 'absolute', top: -4, right: -4,
              width: 12, height: 12, borderRadius: '50%',
              background: cfg.color, border: '2px solid #050e1f',
            }} />
          )}
          {/* Maintenance dot */}
          {data?.maintenanceAktif && (
            <span style={{
              position: 'absolute', top: -4, left: -4,
              width: 12, height: 12, borderRadius: '50%',
              background: '#f59e0b', border: '2px solid #050e1f',
            }} />
          )}
          <Activity size={18} color="#fff" />
        </button>
      </div>
    </>
  )
}
