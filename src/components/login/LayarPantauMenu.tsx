'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowRight, Radio } from 'lucide-react'
import { isNativeApp } from '@/lib/exam-lock'

// Menu "Layar Pantau" di beranda login — HANYA tampil di laptop/desktop.
// Disembunyikan di: aplikasi Android (APK Capacitor), browser HP/tablet
// (Android, iPhone, iPad), dan layar sempit (< 1024px).
function useKhususLaptop(): boolean {
  const [ok, setOk] = useState(false)

  useEffect(() => {
    const ua = navigator.userAgent || ''
    const perangkatSentuhMobile =
      /Android|iPhone|iPad|iPod|Mobile|Windows Phone|Silk/i.test(ua) ||
      // iPadOS di mode "desktop site" mengaku sebagai Mac, tapi punya layar sentuh.
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
    if (perangkatSentuhMobile || isNativeApp()) { setOk(false); return }

    const mq = window.matchMedia('(min-width: 1024px)')
    const sync = () => setOk(mq.matches)
    sync()
    mq.addEventListener('change', sync)
    return () => mq.removeEventListener('change', sync)
  }, [])

  return ok
}

export default function LayarPantauMenu({ className = '' }: { className?: string; compact?: boolean }) {
  const tampil = useKhususLaptop()
  if (!tampil) return null

  return (
    <Link
      href="/layar-pantau"
      className={`group w-full flex items-center gap-3 rounded-2xl px-4 py-2.5 text-left transition-all hover:-translate-y-0.5 ${className}`}
      style={{
        background: 'linear-gradient(135deg, #4f46e5 0%, #0ea5e9 100%)',
        boxShadow: '0 6px 24px rgba(79,70,229,0.35), inset 0 1px 0 rgba(255,255,255,0.25)',
      }}
    >
      <span className="relative flex w-9 h-9 shrink-0 items-center justify-center rounded-xl bg-white/20">
        <Radio className="w-5 h-5 text-white" />
        <span className="absolute -top-1 -right-1 flex h-3 w-3">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-300 opacity-80" />
          <span className="relative inline-flex h-3 w-3 rounded-full bg-emerald-400 ring-2 ring-white/70" />
        </span>
      </span>
      <span className="flex-1 min-w-0">
        <span className="block text-sm font-bold text-white tracking-wide">Layar Pantau</span>
        <span className="block text-[11px] leading-tight text-white/85">
          Nilai ujian live · Guru perlu izin Admin
        </span>
      </span>
      <ArrowRight className="w-4 h-4 shrink-0 text-white/90 transition-transform group-hover:translate-x-0.5" />
    </Link>
  )
}
