'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Capacitor, type PluginListenerHandle } from '@capacitor/core'
import { apiRequest } from '@/lib/utils'
import { ScreenShareNative, DITOLAK_SISWA } from '@/lib/screen-share-native'

// ── Sisi SISWA: menerima & merespons permintaan "Minta layar" admin ────────
// Ada DUA jalur berbagi layar, dipilih otomatis lewat Capacitor.isNativePlatform():
//
//  1. BROWSER (buka lewat browser biasa, bukan APK): pakai getDisplayMedia()
//     bawaan browser — siswa memilih sendiri layar/tab lewat dialog picker
//     browser, dan bisa berhenti kapan saja lewat tombol "Stop sharing"
//     bawaan browser.
//
//  2. APK ANDROID (Capacitor.isNativePlatform() true): getDisplayMedia()
//     TIDAK didukung oleh WebView Android, jadi jalur ini lewat plugin
//     native "ScreenShare" (lihat ScreenSharePlugin.java +
//     ScreenCaptureService.kt di project Android) yang memakai
//     MediaProjection asli + WebRTC native. Dialog consent yang muncul
//     adalah dialog sistem Android asli, bukan dialog browser.
//
// PENTING: sebelum plugin native ini disambungkan, kode lama SELALU
// memanggil getDisplayMedia() di kedua platform. Di dalam APK itu langsung
// gagal (WebView tidak mendukungnya), dan kegagalan itu ditangkap sebagai
// "siswa menolak" — sehingga admin selalu melihat status "Ditolak" walau
// siswa sudah menekan tombol Izinkan. Jalur native di bawah ini memperbaiki
// itu: hanya pembatalan dialog consent Android ASLI (ditandai dengan alasan
// reject DITOLAK_SISWA dari plugin) yang diperlakukan sebagai penolakan
// sungguhan; kegagalan teknis lainnya datang lewat event 'error' dan TIDAK
// mengirim REJECT ke admin.

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
  const nativeListenersRef = useRef<PluginListenerHandle[]>([])

  const cleanup = useCallback(() => {
    pcRef.current?.close()
    pcRef.current = null
    streamRef.current?.getTracks().forEach(t => t.stop())
    streamRef.current = null
    if (Capacitor.isNativePlatform()) {
      ScreenShareNative.stop().catch(() => {})
      nativeListenersRef.current.forEach(l => l.remove())
      nativeListenersRef.current = []
    }
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

  // Jalur BROWSER: dipicu langsung dari onClick tombol "Izinkan" siswa
  // (bukan di dalam useEffect/setTimeout/promise lanjutan) — getDisplayMedia()
  // hanya diizinkan browser kalau dipicu langsung dari interaksi pengguna.
  const izinkanBrowser = useCallback(async () => {
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kirim, cleanup, berhentiBerbagi, tolak])

  // Jalur APK ANDROID: sama-sama harus dipicu langsung dari onClick tombol
  // "Izinkan", karena requestAndStart() di sisi native yang memicu dialog
  // consent MediaProjection Android asli.
  const izinkanNative = useCallback(async () => {
    // Pasang listener SEBELUM requestAndStart(), supaya event 'offer' yang
    // datang cepat dari service tidak sempat terlewat.
    const listeners: PluginListenerHandle[] = []
    listeners.push(await ScreenShareNative.addListener('offer', (data) => {
      kirim('OFFER', { sdp: data.sdp, type: data.type })
    }))
    listeners.push(await ScreenShareNative.addListener('icecandidate', (data) => {
      kirim('ICE', { candidate: data.candidate, sdpMid: data.sdpMid, sdpMLineIndex: data.sdpMLineIndex })
    }))
    listeners.push(await ScreenShareNative.addListener('error', (data) => {
      // Error TEKNIS setelah consent diberikan (mis. WebRTC gagal) — bukan
      // penolakan siswa, jadi TIDAK kirim REJECT, cukup tampilkan pesan &
      // beres-beres seperti halnya kegagalan teknis di jalur browser.
      setErrorMsg(data.message)
      cleanup()
    }))
    listeners.push(await ScreenShareNative.addListener('stopped', () => {
      cleanup()
    }))
    nativeListenersRef.current = listeners

    try {
      await ScreenShareNative.requestAndStart()
      // Sukses: dialog consent Android sudah di-Izinkan siswa & service jalan.
      setSharing(true)
      setPending(null)
    } catch (err) {
      listeners.forEach(l => l.remove())
      nativeListenersRef.current = []
      // Hanya DITOLAK_SISWA yang berarti siswa sungguh menolak/membatalkan
      // dialog consent Android asli. Kegagalan lain seharusnya sudah lewat
      // event 'error' di atas, tapi ini jaga-jaga kalau plugin gagal
      // sebelum sempat memasang listener servicenya.
      if (String(err).includes(DITOLAK_SISWA)) {
        tolak()
      } else {
        setErrorMsg('Gagal memulai berbagi layar. Coba lagi.')
        setPending(null)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kirim, cleanup, tolak])

  const izinkan = useCallback(async () => {
    if (!nis || !sesiId) return
    setErrorMsg(null)
    kirim('ACCEPT') // beri tahu admin segera: siswa klik Izinkan

    if (Capacitor.isNativePlatform()) {
      await izinkanNative()
    } else {
      await izinkanBrowser()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nis, sesiId, kirim, izinkanNative, izinkanBrowser])

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
          } else if (msg.type === 'ANSWER') {
            const p = msg.payload as { sdp: string; type: string }
            if (Capacitor.isNativePlatform()) {
              await ScreenShareNative.setRemoteAnswer(p)
            } else if (pcRef.current) {
              await pcRef.current.setRemoteDescription(new RTCSessionDescription(p as RTCSessionDescriptionInit))
            }
          } else if (msg.type === 'ICE') {
            if (Capacitor.isNativePlatform()) {
              try {
                await ScreenShareNative.addIceCandidate(
                  msg.payload as { candidate: string; sdpMid?: string; sdpMLineIndex?: number }
                )
              } catch { /* abaikan kandidat basi */ }
            } else if (pcRef.current) {
              try { await pcRef.current.addIceCandidate(msg.payload as RTCIceCandidateInit) } catch { /* abaikan kandidat basi */ }
            }
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
