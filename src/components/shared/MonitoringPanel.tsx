'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import {
  Activity, Server, Users, AlertTriangle, ChevronDown,
  ChevronUp, RefreshCw, Shield, Zap, Clock, Eye,
  X, Wifi, Database, TrendingUp
} from 'lucide-react'

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
  }
  logs: Array<{ id: string; user_id: string; aksi: string; detail: string; created_at: string }>
  sesiAktif: Array<{ id: string; kelas: string; mapel_id: string; waktu_mulai: string; jumlah_peserta: number }>
  pelanggaran: Array<{ id: string; nis: string; jenis: string; created_at: string }>
}

const STATUS_CONFIG = {
  AMAN:    { color: '#10b981', bg: 'rgba(16,185,129,0.12)', label: '✦ AMAN',    pulse: '#10b981' },
  NORMAL:  { color: '#3b82f6', bg: 'rgba(59,130,246,0.12)', label: '● NORMAL',  pulse: '#3b82f6' },
  WASPADA: { color: '#f59e0b', bg: 'rgba(245,158,11,0.12)', label: '▲ WASPADA', pulse: '#f59e0b' },
  BERAT:   { color: '#f97316', bg: 'rgba(249,115,22,0.12)', label: '◆ BERAT',   pulse: '#f97316' },
  KRITIS:  { color: '#ef4444', bg: 'rgba(239,68,68,0.12)',  label: '⚠ KRITIS',  pulse: '#ef4444' },
}

function formatAgo(iso: string) {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (diff < 60) return `${diff}d lalu`
  if (diff < 3600) return `${Math.floor(diff / 60)}m lalu`
  return `${Math.floor(diff / 3600)}j lalu`
}

function roleColor(aksi: string) {
  if (aksi.startsWith('SISWA') || aksi === 'MULAI_UJIAN' || aksi === 'SUBMIT_UJIAN') return '#6366f1'
  if (aksi.startsWith('GURU') || aksi === 'BUAT_SOAL' || aksi === 'VALIDASI') return '#10b981'
  if (aksi.startsWith('ADMIN')) return '#f59e0b'
  if (aksi.startsWith('PENGAWAS')) return '#8b5cf6'
  return '#94a3b8'
}

function roleLabel(aksi: string) {
  if (aksi.startsWith('SISWA') || aksi === 'MULAI_UJIAN' || aksi === 'SUBMIT_UJIAN') return 'Siswa'
  if (aksi.startsWith('GURU') || aksi === 'BUAT_SOAL' || aksi === 'VALIDASI') return 'Guru'
  if (aksi.startsWith('ADMIN')) return 'Admin'
  if (aksi.startsWith('PENGAWAS')) return 'Pengawas'
  return 'Sistem'
}

export default function MonitoringPanel() {
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<'server' | 'aktivitas' | 'log'>('server')
  const [data, setData] = useState<MonitoringData | null>(null)
  const [loading, setLoading] = useState(false)
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const fetch_ = useCallback(async () => {
    setLoading(true)
    try {
      const r = await fetch('/api/admin/monitoring', { cache: 'no-store' })
      if (r.ok) {
        setData(await r.json())
        setLastRefresh(new Date())
      }
    } catch {}
    finally { setLoading(false) }
  }, [])

  useEffect(() => {
    if (open) {
      fetch_()
      intervalRef.current = setInterval(fetch_, 15000)
    } else {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
    return () => { if (intervalRef.current) clearInterval(intervalRef.current) }
  }, [open, fetch_])

  const cfg = data ? STATUS_CONFIG[data.server.status] : STATUS_CONFIG['NORMAL']

  return (
    <>
      <style>{`
        @keyframes mon-pulse { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:.5;transform:scale(1.4)} }
        @keyframes mon-slide { from{opacity:0;transform:translateY(12px)} to{opacity:1;transform:translateY(0)} }
        @keyframes mon-spin  { to{transform:rotate(360deg)} }
        .mon-pulse { animation: mon-pulse 2s ease-in-out infinite }
        .mon-spin  { animation: mon-spin .8s linear infinite }
        .mon-slide { animation: mon-slide .2s ease }
        .mon-tab   { padding:6px 14px; border-radius:8px; font-size:12px; font-weight:600; cursor:pointer; border:none; background:transparent; transition:all .15s }
        .mon-tab.active { background:rgba(255,255,255,0.12); color:#fff }
        .mon-tab:not(.active) { color:rgba(255,255,255,0.45) }
        .mon-tab:not(.active):hover { color:rgba(255,255,255,0.75) }
        .mon-bar { height:6px; border-radius:4px; background:rgba(255,255,255,0.1); overflow:hidden }
        .mon-bar-fill { height:100%; border-radius:4px; transition:width .8s ease }
        .mon-log-row { display:flex; align-items:flex-start; gap:8px; padding:7px 0; border-bottom:1px solid rgba(255,255,255,0.06) }
        .mon-log-row:last-child { border-bottom:none }
        .mon-scroll { overflow-y:auto; max-height:220px; scrollbar-width:thin; scrollbar-color:rgba(255,255,255,.15) transparent }
      `}</style>

      {/* ── Floating Button ── */}
      <div style={{ position:'fixed', bottom:24, right:24, zIndex:50 }}>

        {/* Panel */}
        {open && (
          <div className="mon-slide" style={{
            position:'absolute', bottom:'calc(100% + 12px)', right:0,
            width:340, borderRadius:16,
            background:'linear-gradient(160deg,#0f0b2e 0%,#0d1b3e 100%)',
            border:'1px solid rgba(255,255,255,0.1)',
            boxShadow:'0 24px 64px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.04)',
            overflow:'hidden',
          }}>

            {/* Header */}
            <div style={{ padding:'14px 16px 10px', borderBottom:'1px solid rgba(255,255,255,0.07)', display:'flex', alignItems:'center', gap:10 }}>
              <Server size={15} color="#94a3b8" />
              <span style={{ flex:1, fontSize:13, fontWeight:700, color:'#fff', letterSpacing:'0.03em' }}>Monitor Sistem</span>
              {loading && <RefreshCw size={13} color="#64748b" className="mon-spin" />}
              {lastRefresh && <span style={{ fontSize:10, color:'rgba(255,255,255,0.3)' }}>~15d</span>}
              <button onClick={() => setOpen(false)} style={{ background:'none', border:'none', cursor:'pointer', color:'rgba(255,255,255,0.35)', padding:2 }}>
                <X size={14} />
              </button>
            </div>

            {/* Status Bar */}
            {data && (
              <div style={{ padding:'10px 16px', background: cfg.bg, borderBottom:'1px solid rgba(255,255,255,0.06)', display:'flex', alignItems:'center', gap:10 }}>
                <span className="mon-pulse" style={{ width:8, height:8, borderRadius:'50%', background:cfg.color, display:'inline-block', flexShrink:0 }} />
                <span style={{ fontSize:12, fontWeight:800, color:cfg.color, letterSpacing:'0.08em' }}>{cfg.label}</span>
                <span style={{ marginLeft:'auto', fontSize:11, color:'rgba(255,255,255,0.4)' }}>DB {data.server.dbResponseMs}ms</span>
              </div>
            )}

            {/* Tabs */}
            <div style={{ display:'flex', padding:'8px 12px', gap:4, borderBottom:'1px solid rgba(255,255,255,0.06)' }}>
              {(['server','aktivitas','log'] as const).map(t => (
                <button key={t} className={`mon-tab${tab===t?' active':''}`} onClick={()=>setTab(t)}>
                  {t==='server'?'Server':t==='aktivitas'?'Aktivitas':'Log'}
                </button>
              ))}
            </div>

            {/* Content */}
            <div style={{ padding:'12px 16px 14px', minHeight:200 }}>

              {!data && !loading && (
                <div style={{ textAlign:'center', paddingTop:40, color:'rgba(255,255,255,0.3)', fontSize:13 }}>Memuat data...</div>
              )}

              {/* TAB: SERVER */}
              {tab === 'server' && data && (
                <div style={{ display:'flex', flexDirection:'column', gap:12 }}>

                  {/* Score bar */}
                  <div>
                    <div style={{ display:'flex', justifyContent:'space-between', marginBottom:6 }}>
                      <span style={{ fontSize:11, color:'rgba(255,255,255,0.45)', display:'flex', alignItems:'center', gap:5 }}>
                        <Activity size={11}/> Beban Sistem
                      </span>
                      <span style={{ fontSize:11, fontWeight:700, color:cfg.color }}>{data.server.score}%</span>
                    </div>
                    <div className="mon-bar">
                      <div className="mon-bar-fill" style={{ width:`${data.server.score}%`, background:cfg.color }} />
                    </div>
                  </div>

                  {/* Metric cards */}
                  {[
                    { icon:<Database size={13}/>, label:'Response DB', value:`${data.server.dbResponseMs} ms`, ok: data.server.dbResponseMs < 500 },
                    { icon:<Wifi size={13}/>, label:'Sesi Ujian Aktif', value:`${data.aktivitas.sesiUjianAktif} sesi`, ok: data.aktivitas.sesiUjianAktif < 10 },
                    { icon:<Zap size={13}/>, label:'Aktivitas 5 Menit', value:`${data.aktivitas.aktifitas5MenitTerakhir} aksi`, ok: data.aktivitas.aktifitas5MenitTerakhir < 50 },
                    { icon:<Shield size={13}/>, label:'Pelanggaran Hari Ini', value:`${data.aktivitas.pelanggaranHariIni} kasus`, ok: data.aktivitas.pelanggaranHariIni === 0 },
                  ].map((m,i) => (
                    <div key={i} style={{ display:'flex', alignItems:'center', gap:10, padding:'8px 10px', borderRadius:10, background:'rgba(255,255,255,0.05)', border:`1px solid ${m.ok?'rgba(16,185,129,0.2)':'rgba(245,158,11,0.25)'}` }}>
                      <span style={{ color: m.ok?'#10b981':'#f59e0b' }}>{m.icon}</span>
                      <span style={{ flex:1, fontSize:12, color:'rgba(255,255,255,0.55)' }}>{m.label}</span>
                      <span style={{ fontSize:12, fontWeight:700, color: m.ok?'#10b981':'#f59e0b' }}>{m.value}</span>
                    </div>
                  ))}

                  {/* Sesi aktif list */}
                  {data.sesiAktif.length > 0 && (
                    <div>
                      <div style={{ fontSize:11, color:'rgba(255,255,255,0.35)', marginBottom:6, display:'flex', alignItems:'center', gap:5 }}>
                        <Eye size={11}/> Ujian Berlangsung
                      </div>
                      <div className="mon-scroll" style={{ maxHeight:100 }}>
                        {data.sesiAktif.map(s => (
                          <div key={s.id} style={{ display:'flex', justifyContent:'space-between', padding:'5px 0', borderBottom:'1px solid rgba(255,255,255,0.05)', fontSize:11 }}>
                            <span style={{ color:'#c4b5fd' }}>Kelas {s.kelas}</span>
                            <span style={{ color:'rgba(255,255,255,0.4)' }}>{s.jumlah_peserta} siswa</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* TAB: AKTIVITAS */}
              {tab === 'aktivitas' && data && (
                <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
                  {[
                    { icon:<TrendingUp size={14}/>, label:'Login Hari Ini', value: data.aktivitas.loginHariIni, color:'#6366f1' },
                    { icon:<Activity size={14}/>, label:'Aktivitas 5 Menit Terakhir', value: data.aktivitas.aktifitas5MenitTerakhir, color:'#10b981' },
                    { icon:<Users size={14}/>, label:'Sesi Ujian Aktif', value: data.aktivitas.sesiUjianAktif, color:'#3b82f6' },
                    { icon:<AlertTriangle size={14}/>, label:'Pelanggaran Hari Ini', value: data.aktivitas.pelanggaranHariIni, color: data.aktivitas.pelanggaranHariIni > 0 ? '#ef4444' : '#10b981' },
                  ].map((m,i) => (
                    <div key={i} style={{ display:'flex', alignItems:'center', gap:10, padding:'10px 12px', borderRadius:10, background:'rgba(255,255,255,0.05)' }}>
                      <span style={{ color:m.color }}>{m.icon}</span>
                      <span style={{ flex:1, fontSize:12, color:'rgba(255,255,255,0.6)' }}>{m.label}</span>
                      <span style={{ fontSize:18, fontWeight:800, color:m.color }}>{m.value}</span>
                    </div>
                  ))}

                  {/* Pelanggaran terbaru */}
                  {data.pelanggaran.length > 0 && (
                    <div style={{ marginTop:4 }}>
                      <div style={{ fontSize:11, color:'rgba(255,255,255,0.35)', marginBottom:6 }}>Pelanggaran Terbaru</div>
                      {data.pelanggaran.map(p => (
                        <div key={p.id} style={{ display:'flex', gap:8, padding:'5px 0', borderBottom:'1px solid rgba(255,255,255,0.05)', fontSize:11 }}>
                          <span style={{ color:'#fca5a5' }}>{p.nis}</span>
                          <span style={{ flex:1, color:'rgba(255,255,255,0.45)', textTransform:'capitalize' }}>{p.jenis?.toLowerCase()}</span>
                          <span style={{ color:'rgba(255,255,255,0.3)' }}>{formatAgo(p.created_at)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* TAB: LOG */}
              {tab === 'log' && data && (
                <div>
                  <div style={{ fontSize:11, color:'rgba(255,255,255,0.35)', marginBottom:8 }}>30 Aktivitas Terbaru</div>
                  <div className="mon-scroll">
                    {data.logs.length === 0 && (
                      <p style={{ color:'rgba(255,255,255,0.3)', fontSize:12, textAlign:'center', paddingTop:20 }}>Belum ada log</p>
                    )}
                    {data.logs.map(l => (
                      <div key={l.id} className="mon-log-row">
                        <span style={{ width:6, height:6, borderRadius:'50%', background:roleColor(l.aksi), flexShrink:0, marginTop:5 }} />
                        <div style={{ flex:1, minWidth:0 }}>
                          <div style={{ display:'flex', gap:6, alignItems:'center' }}>
                            <span style={{ fontSize:10, fontWeight:700, color:roleColor(l.aksi), textTransform:'uppercase', letterSpacing:'0.06em' }}>{roleLabel(l.aksi)}</span>
                            <span style={{ fontSize:11, color:'rgba(255,255,255,0.7)', fontWeight:600 }}>{l.aksi}</span>
                          </div>
                          <div style={{ fontSize:10, color:'rgba(255,255,255,0.35)', marginTop:2, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>
                            {l.user_id} {l.detail ? `· ${l.detail}` : ''}
                          </div>
                        </div>
                        <span style={{ fontSize:10, color:'rgba(255,255,255,0.25)', flexShrink:0, marginTop:1 }}>{formatAgo(l.created_at)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Footer */}
            <div style={{ padding:'8px 16px', borderTop:'1px solid rgba(255,255,255,0.06)', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
              <span style={{ fontSize:10, color:'rgba(255,255,255,0.25)', display:'flex', alignItems:'center', gap:4 }}>
                <Clock size={10}/> Refresh otomatis 15 detik
              </span>
              <button onClick={fetch_} style={{ fontSize:10, color:'rgba(255,255,255,0.4)', background:'none', border:'none', cursor:'pointer', display:'flex', alignItems:'center', gap:4 }}>
                <RefreshCw size={10}/> Refresh
              </button>
            </div>
          </div>
        )}

        {/* Floating Button */}
        <button
          onClick={() => setOpen(o => !o)}
          style={{
            width: 52, height: 52, borderRadius: '50%',
            background: data ? `linear-gradient(135deg,${cfg.color}cc,${cfg.color}88)` : 'linear-gradient(135deg,#334155,#1e293b)',
            border: `2px solid ${data ? cfg.color : 'rgba(255,255,255,0.15)'}`,
            boxShadow: data ? `0 4px 20px ${cfg.color}55, 0 2px 8px rgba(0,0,0,0.4)` : '0 4px 16px rgba(0,0,0,0.4)',
            cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            transition: 'all .2s',
            position: 'relative',
          }}
        >
          {data && (
            <span className="mon-pulse" style={{
              position:'absolute', top:-2, right:-2,
              width:10, height:10, borderRadius:'50%',
              background: cfg.color,
              border:'2px solid #0f0b2e',
            }} />
          )}
          {open
            ? <ChevronDown size={20} color="#fff" />
            : <Activity size={20} color="#fff" />
          }
        </button>
      </div>
    </>
  )
}
