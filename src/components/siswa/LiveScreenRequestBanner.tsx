'use client'

import { MonitorUp, X, Check } from 'lucide-react'
import { useLiveScreenRequest } from '@/hooks/useLiveScreenRequest'

interface Props {
  nis: string | undefined
  sesiId: string | undefined
  active: boolean
}

export default function LiveScreenRequestBanner({ nis, sesiId, active }: Props) {
  const { pending, sharing, errorMsg, izinkan, tolak, berhentiBerbagi } = useLiveScreenRequest(nis, sesiId, active)

  if (!pending && !sharing && !errorMsg) return null

  return (
    <div
      role="alert"
      style={{
        position: 'fixed', top: 12, left: '50%', transform: 'translateX(-50%)', zIndex: 9999,
        maxWidth: 480, width: 'calc(100% - 24px)',
        background: sharing ? '#065f46' : '#1e3a8a',
        color: '#fff', borderRadius: 12, padding: '12px 16px',
        boxShadow: '0 8px 24px rgba(0,0,0,0.35)',
        display: 'flex', alignItems: 'center', gap: 12,
        fontSize: 13, lineHeight: 1.4,
      }}
    >
      <MonitorUp size={20} style={{ flexShrink: 0 }} />
      <div style={{ flex: 1 }}>
        {pending && (
          <>
            <div style={{ fontWeight: 600 }}>Admin meminta melihat layar Anda</div>
            <div style={{ opacity: 0.85, fontSize: 12 }}>
              Anda akan memilih sendiri layar/tab mana yang dibagikan lewat dialog browser. Ujian tidak berhenti.
            </div>
          </>
        )}
        {sharing && (
          <div style={{ fontWeight: 600 }}>Anda sedang membagikan layar ke admin</div>
        )}
        {errorMsg && <div>{errorMsg}</div>}
      </div>
      {pending && (
        <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
          <button
            onClick={izinkan}
            style={{ display: 'flex', alignItems: 'center', gap: 4, background: '#10b981', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 12px', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
          >
            <Check size={14} /> Izinkan
          </button>
          <button
            onClick={tolak}
            style={{ display: 'flex', alignItems: 'center', gap: 4, background: 'rgba(255,255,255,0.15)', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 12px', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
          >
            <X size={14} /> Tolak
          </button>
        </div>
      )}
      {sharing && (
        <button
          onClick={berhentiBerbagi}
          style={{ flexShrink: 0, background: 'rgba(255,255,255,0.15)', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 12px', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
        >
          Berhenti berbagi
        </button>
      )}
    </div>
  )
}
