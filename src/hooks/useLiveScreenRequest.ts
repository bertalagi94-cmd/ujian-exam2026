'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { apiRequest } from '@/lib/utils'

// ── Sisi SISWA: menerima & merespons permintaan "Minta layar" admin ────────
// Alurnya SELALU lewat dialog share bawaan browser (getDisplayMedia) — tidak
// ada cara mem-bypass itu, dan memang tidak seharusnya bisa (siswa selalu
// punya kendali penuh atas apa yang dibagikan & bisa berhenti kapan saja
// lewat tombol "Stop sharing" bawaan browser juga).

const ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  // TODO: tambahkan server TURN di sini kalau nanti ada laporan siswa/admin
  // gagal konek (biasanya karena jaringan sekolah di belakang NAT/firewall
  // ketat). Untuk sekarang sengaja STUN-only sesuai keputusan awal.
]

const POLL_MS = 2000

type Pending = { adminUsername: string } | null

export function useLiveScreenRequest(nis: string | undefined, sesiId: string | undefined, active: boolean) {
  const [pending, setPending] = useState<Pending>(null)
  const [sharing, setSharing] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  const pcRef = useRef<RTCPeerConnection | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const adminUsernameRef = useRef<string | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const cleanup = useCallback(() => {
    pcRef.current?.close()
    pcRef.current = null
    streamRef.current?.getTracks().forEach(t => t.stop())
    streamRef.current = null
    setSharing(false)
  }, [])

  const kirim = useCallback(async (type: string, payload?: unknown) => {
    if (!nis || !sesiId || !adminUsernameRef.current) return
    try {
      await apiRequest('/api/live-screen/signal', {
        method: 'POST',
        body: JSON.stringify({ nis, sesiId, type, payload, adminUsername: adminUsernameRef.current }),
      })
    } catch {
      // Sinyal gagal terkirim (mis. koneksi terputus sesaat) — tidak fatal,
      // handshake akan gagal dan admin melihat "tidak merespons"; siswa
      // tetap bisa lanjut ujian normal apa pun yang terjadi di sini.
    }
  }, [nis, sesiId])

  const tolak = useCallback(() => {
    kirim('REJECT')
    setPending(null)
    adminUsernameRef.current = null
  }, [kirim])

  const berhentiBerbagi = useCallback(() => {
    kirim('STOP')
    cleanup()
    setPending(null)
    adminUsernameRef.current = null
  }, [kirim, cleanup])

  // HARUS dipanggil langsung dari onClick tombol "Izinkan" siswa (bukan di
  // dalam useEffect/setTimeout/promise lanjutan) — getDisplayMedia() hanya
  // diizinkan browser kalau dipicu langsung dari interaksi pengguna.
  const izinkan = useCallback(async () => {
    if (!nis || !sesiId) return
    setErrorMsg(null)
    kirim('ACCEPT') // beri tahu admin segera: siswa klik Izinkan, sedang memilih layar di dialog browser
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false })
    } catch {
      // Siswa membatalkan dialog picker bawaan browser, atau perangkat
      // tidak mendukung — perlakukan sama seperti menolak.
      tolak()
      return
    }
    streamRef.current = stream
    setSharing(true)
    setPending(null)

    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS })
    pcRef.current = pc
    stream.getTracks().forEach(track => {
      pc.addTrack(track, stream)
      // Siswa klik "Stop sharing" di bar bawaan browser → beri tahu admin
      // & bersihkan koneksi di sisi kita juga.
      track.addEventListener('ended', () => berhentiBerbagi())
    })
    pc.onicecandidate = (e) => {
      if (e.candidate) kirim('ICE', e.candidate.toJSON())
    }
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') cleanup()
    }

    try {
      const offer = await pc.createOffer()
      await pc.setLocalDescription(offer)
      kirim('OFFER', { sdp: offer.sdp, type: offer.type })
    } catch {
      setErrorMsg('Gagal memulai berbagi layar. Coba lagi.')
      cleanup()
    }
  }, [nis, sesiId, kirim, cleanup, berhentiBerbagi, tolak])

  useEffect(() => {
    if (!active || !nis || !sesiId) {
      if (pollRef.current) clearInterval(pollRef.current)
      cleanup()
      setPending(null)
      adminUsernameRef.current = null
      return
    }

    const poll = async () => {
      try {
        const res = await apiRequest<{ messages: Array<{ type: string; payload: unknown; adminUsername: string }> }>(
          `/api/live-screen/poll?nis=${encodeURIComponent(nis)}&sesiId=${encodeURIComponent(sesiId)}`
        )
        for (const msg of res.messages) {
          if (msg.type === 'REQUEST') {
            adminUsernameRef.current = msg.adminUsername
            setPending({ adminUsername: msg.adminUsername })
          } else if (msg.type === 'ANSWER' && pcRef.current) {
            const p = msg.payload as { sdp: string; type: RTCSdpType }
            await pcRef.current.setRemoteDescription(new RTCSessionDescription(p))
          } else if (msg.type === 'ICE' && pcRef.current) {
            try { await pcRef.current.addIceCandidate(msg.payload as RTCIceCandidateInit) } catch { /* abaikan kandidat basi */ }
          } else if (msg.type === 'STOP') {
            cleanup()
            setPending(null)
            adminUsernameRef.current = null
          }
        }
      } catch {
        // Poll gagal sesekali — coba lagi di siklus berikutnya, tidak perlu
        // ditampilkan ke siswa (ini bukan bagian kritikal ujian).
      }
    }

    poll()
    pollRef.current = setInterval(poll, POLL_MS)
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [active, nis, sesiId, cleanup])

  return { pending, sharing, errorMsg, izinkan, tolak, berhentiBerbagi }
}
