'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { X, MonitorUp, MonitorX, Loader2 } from 'lucide-react'
import { apiRequest } from '@/lib/utils'

interface Props {
  nis: string
  nama: string
  sesiId: string
  onClose: () => void
}

// ── Sisi ADMIN: menunggu respons siswa & menampilkan layar live ────────────
// Tidak ada MediaRecorder, tidak ada upload frame/gambar ke mana pun di
// komponen ini — videoRef hanya dipakai untuk PREVIEW LANGSUNG di browser
// admin sendiri, lewat srcObject dari MediaStream WebRTC.

const ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  // TODO: tambahkan TURN kalau ada laporan gagal konek dari jaringan sekolah
  // yang NAT/firewall-nya ketat — lihat catatan sama di useLiveScreenRequest.ts.
]

const POLL_MS = 1500
const TIMEOUT_MENUNGGU_MS = 30_000

type Status = 'menunggu' | 'memilih' | 'menyambung' | 'live' | 'ditolak' | 'timeout' | 'berhenti' | 'error'

export default function LiveScreenViewerModal({ nis, nama, sesiId, onClose }: Props) {
  const [status, setStatus] = useState<Status>('menunggu')
  const [errMsg, setErrMsg] = useState<string | null>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const pcRef = useRef<RTCPeerConnection | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const closedRef = useRef(false)

  const kirim = useCallback(async (type: string, payload?: unknown) => {
    try {
      await apiRequest('/api/live-screen/signal', {
        method: 'POST',
        body: JSON.stringify({ nis, sesiId, type, payload }),
      })
    } catch { /* biarkan, poll berikutnya / admin bisa tutup manual */ }
  }, [nis, sesiId])

  const bersihkan = useCallback(() => {
    pcRef.current?.close()
    pcRef.current = null
    if (videoRef.current) videoRef.current.srcObject = null
    if (pollRef.current) clearInterval(pollRef.current)
    if (timeoutRef.current) clearTimeout(timeoutRef.current)
  }, [])

  const tutup = useCallback(() => {
    if (closedRef.current) return
    closedRef.current = true
    if (status === 'live' || status === 'memilih' || status === 'menunggu') kirim('STOP')
    bersihkan()
    onClose()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, kirim, bersihkan, onClose])

  useEffect(() => {
    // Kirim REQUEST begitu modal dibuka.
    kirim('REQUEST')
    timeoutRef.current = setTimeout(() => {
      setStatus(s => (s === 'menunggu' ? 'timeout' : s))
    }, TIMEOUT_MENUNGGU_MS)

    const poll = async () => {
      try {
        const res = await apiRequest<{ messages: Array<{ type: string; payload: unknown }> }>(
          `/api/live-screen/poll?nis=${encodeURIComponent(nis)}&sesiId=${encodeURIComponent(sesiId)}`
        )
        for (const msg of res.messages) {
          if (msg.type === 'ACCEPT') {
            setStatus('memilih')
          } else if (msg.type === 'REJECT') {
            setStatus('ditolak')
            bersihkan()
          } else if (msg.type === 'OFFER') {
            setStatus('menyambung')
            const p = msg.payload as { sdp: string; type: RTCSdpType }
            const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS })
            pcRef.current = pc
            pc.ontrack = (e) => {
              if (videoRef.current) videoRef.current.srcObject = e.streams[0]
              setStatus('live')
            }
            pc.onicecandidate = (e) => { if (e.candidate) kirim('ICE', e.candidate.toJSON()) }
            pc.onconnectionstatechange = () => {
              if (pc.connectionState === 'failed') { setErrMsg('Koneksi gagal terbentuk (kemungkinan jaringan terlalu dibatasi).'); setStatus('error') }
              if (pc.connectionState === 'closed') setStatus('berhenti')
            }
            try {
              await pc.setRemoteDescription(new RTCSessionDescription(p))
              const answer = await pc.createAnswer()
              await pc.setLocalDescription(answer)
              kirim('ANSWER', { sdp: answer.sdp, type: answer.type })
            } catch {
              setErrMsg('Gagal menyambungkan sesi.')
              setStatus('error')
            }
          } else if (msg.type === 'ICE' && pcRef.current) {
            try { await pcRef.current.addIceCandidate(msg.payload as RTCIceCandidateInit) } catch { /* abaikan kandidat basi */ }
          } else if (msg.type === 'STOP') {
            setStatus('berhenti')
            bersihkan()
          }
        }
      } catch { /* coba lagi siklus berikutnya */ }
    }
    poll()
    pollRef.current = setInterval(poll, POLL_MS)

    return () => {
      if (!closedRef.current) kirim('STOP')
      bersihkan()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nis, sesiId])

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 10000,
        background: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 16,
      }}
      onClick={tutup}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 860, background: '#0f172a', borderRadius: 14,
          border: '1px solid rgba(255,255,255,0.1)', overflow: 'hidden',
          display: 'flex', flexDirection: 'column', maxHeight: '90vh',
        }}
      >
        <style>{`@keyframes lsvSpin { to { transform: rotate(360deg) } } .lsv-spin { animation: lsvSpin .9s linear infinite }`}</style>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
          <MonitorUp size={16} color="#a5b4fc" />
          <div style={{ flex: 1, color: '#fff', fontSize: 13, fontWeight: 700 }}>
            Layar {nama} <span style={{ color: 'rgba(255,255,255,0.4)', fontWeight: 400 }}>• live, tidak direkam</span>
          </div>
          <button onClick={tutup} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.6)', cursor: 'pointer' }}>
            <X size={18} />
          </button>
        </div>

        <div style={{ flex: 1, background: '#000', display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 320, position: 'relative' }}>
          <video ref={videoRef} autoPlay playsInline muted={false} style={{ width: '100%', maxHeight: '70vh', display: status === 'live' ? 'block' : 'none' }} />
          {status !== 'live' && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, color: 'rgba(255,255,255,0.7)', fontSize: 13, padding: 24, textAlign: 'center' }}>
              {status === 'menunggu' && (<><Loader2 size={22} className="lsv-spin" /><span>Menunggu {nama} merespons permintaan…</span></>)}
              {status === 'memilih' && (<><Loader2 size={22} className="lsv-spin" /><span>{nama} sedang memilih layar/tab yang dibagikan…</span></>)}
              {status === 'menyambung' && (<><Loader2 size={22} className="lsv-spin" /><span>Menyambungkan…</span></>)}
              {status === 'ditolak' && (<><MonitorX size={22} /><span>{nama} menolak permintaan ini.</span></>)}
              {status === 'timeout' && (<><MonitorX size={22} /><span>{nama} tidak merespons. Coba lagi nanti.</span></>)}
              {status === 'berhenti' && (<><MonitorX size={22} /><span>Berbagi layar dihentikan.</span></>)}
              {status === 'error' && (<><MonitorX size={22} color="#f87171" /><span>{errMsg ?? 'Terjadi kesalahan.'}</span></>)}
            </div>
          )}
        </div>

        <div style={{ padding: '10px 16px', fontSize: 11, color: 'rgba(255,255,255,0.35)', borderTop: '1px solid rgba(255,255,255,0.08)' }}>
          Siswa bisa menghentikan berbagi kapan saja lewat tombol &quot;Stop sharing&quot; browser atau tombol &quot;Berhenti berbagi&quot; di aplikasi ujian.
        </div>
      </div>
    </div>
  )
}
