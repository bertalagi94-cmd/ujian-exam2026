// PERF: jam WITA dipisah dari src/app/login/page.tsx. Sebelumnya state
// witaTime disimpan di komponen halaman login yang besar (1700+ baris),
// sehingga setiap detik SELURUH halaman ikut re-render. Dengan komponen
// terisolasi ini, tick 1 detik hanya me-render ulang jam ini saja.
'use client'

import { useEffect, useState } from 'react'

const DAYS = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Ags', 'Sep', 'Okt', 'Nov', 'Des']

interface WitaClockProps {
  isFs: boolean
}

export default function WitaClock({ isFs }: WitaClockProps) {
  const [witaTime, setWitaTime] = useState<{ day: string; date: string; time: string }>({ day: '', date: '', time: '' })

  useEffect(() => {
    const tick = () => {
      const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Makassar' }))
      const h = String(now.getHours()).padStart(2, '0'), m = String(now.getMinutes()).padStart(2, '0'), s = String(now.getSeconds()).padStart(2, '0')
      setWitaTime({ day: DAYS[now.getDay()], date: `${now.getDate()} ${MONTHS[now.getMonth()]} ${now.getFullYear()}`, time: `${h}:${m}:${s}` })
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [])

  if (!witaTime.time) return null

  return (
    <div
      className="absolute top-4 z-20 hidden lg:flex items-center gap-3 select-none"
      style={{
        right: isFs ? '11rem' : '12.5rem',
        background: 'rgba(255,255,255,0.85)',
        backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)',
        border: '1.5px solid rgba(56,189,248,0.35)', borderRadius: '16px',
        padding: '10px 18px 10px 14px',
        boxShadow: '0 4px 24px rgba(56,189,248,0.18), 0 0 0 1px rgba(255,255,255,0.5), inset 0 1px 0 rgba(255,255,255,0.6)',
      }}
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0 }}>
        <circle cx="12" cy="12" r="9.5" stroke="#0ea5e9" strokeWidth="2" />
        <path d="M12 7v5.5l3.5 2" stroke="#0284c7" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span style={{ fontSize: '14px', color: '#334155', fontWeight: 600, letterSpacing: '0.02em', lineHeight: 1 }}>
        {witaTime.day}, {witaTime.date}
      </span>
      <span style={{ width: '1.5px', height: '18px', background: 'rgba(56,189,248,0.3)', flexShrink: 0, borderRadius: '2px' }} />
      <span style={{ fontSize: '17px', fontWeight: 800, letterSpacing: '0.08em', color: '#0284c7', fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>
        {witaTime.time}
      </span>
      <span style={{ fontSize: '10.5px', fontWeight: 700, letterSpacing: '0.1em', color: '#0c4a6e', background: 'linear-gradient(135deg, rgba(56,189,248,0.25), rgba(20,184,166,0.2))', borderRadius: '7px', padding: '3px 7px', lineHeight: 1.3, border: '1px solid rgba(56,189,248,0.3)' }}>
        WITA
      </span>
    </div>
  )
}
