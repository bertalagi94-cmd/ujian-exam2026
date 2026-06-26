'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { BookOpen, Clock, AlertTriangle, CheckCircle, ChevronLeft, ChevronRight, Send, Maximize, KeyRound, LogOut } from 'lucide-react'
import { apiRequest } from '@/lib/utils'
import { Soal } from '@/types'
import { Confirm, Spinner } from '@/components/ui'

type Phase = 'KODE' | 'UJIAN' | 'SELESAI' | 'RESET_KODE'

interface SesiInfo {
  sesiId: string
  mapelId: string
  namaMapel: string
  kelas: string
  durasi: number
  waktu_mulai: string
  soalList: SoalUjian[]
  minSubmitMenit: number  // 0 = tidak ada batas
}

interface SoalUjian extends Soal {
  nomor: number
}

interface JawabanMap { [soalId: string]: string }

// ── Fullscreen helpers ────────────────────────────────────────────────────────
function requestFullscreen(el: Element) {
  if (el.requestFullscreen) return el.requestFullscreen()
  const anyEl = el as unknown as Record<string, () => Promise<void>>
  if (anyEl.webkitRequestFullscreen) return anyEl.webkitRequestFullscreen()
  if (anyEl.mozRequestFullScreen) return anyEl.mozRequestFullScreen()
  if (anyEl.msRequestFullscreen) return anyEl.msRequestFullscreen()
  return Promise.resolve()
}

function exitFullscreen() {
  if (document.exitFullscreen) return document.exitFullscreen()
  const anyDoc = document as unknown as Record<string, () => Promise<void>>
  if (anyDoc.webkitExitFullscreen) return anyDoc.webkitExitFullscreen()
  if (anyDoc.mozCancelFullScreen) return anyDoc.mozCancelFullScreen()
  if (anyDoc.msExitFullscreen) return anyDoc.msExitFullscreen()
  return Promise.resolve()
}

function isFullscreen() {
  const anyDoc = document as unknown as Record<string, Element | null>
  return !!(
    document.fullscreenElement ||
    anyDoc.webkitFullscreenElement ||
    anyDoc.mozFullScreenElement ||
    anyDoc.msFullscreenElement
  )
}

// ── Backup lokal jawaban ──────────────────────────────────────────────────
// Cadangan di localStorage (selain di server) supaya kalau tab/browser ter-reload
// tiba-tiba di tengah ujian, jawaban yang BELUM sempat sync ke server tidak hilang
// total dari sisi siswa — bisa direkonsiliasi ulang saat sesi dibuka kembali.
function backupKey(sesiId: string, nis: string) {
  return `ujian_backup_${sesiId}_${nis}`
}
function saveBackup(sesiId: string, nis: string, jawaban: JawabanMap) {
  try { localStorage.setItem(backupKey(sesiId, nis), JSON.stringify(jawaban)) } catch { /* abaikan */ }
}
function loadBackup(sesiId: string, nis: string): JawabanMap {
  try {
    const raw = localStorage.getItem(backupKey(sesiId, nis))
    return raw ? JSON.parse(raw) : {}
  } catch { return {} }
}
function clearBackup(sesiId: string, nis: string) {
  try { localStorage.removeItem(backupKey(sesiId, nis)) } catch { /* abaikan */ }
}

// ── Device ID — identitas unik per browser/device ────────────────────────
// Dibuat sekali, disimpan di localStorage, dipakai konsisten sepanjang sesi.
// Digunakan server untuk mendeteksi login ganda dari device berbeda.
function getDeviceId(): string {
  try {
    const stored = localStorage.getItem('ujian_device_id')
    if (stored) return stored
    const id = `dev_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
    localStorage.setItem('ujian_device_id', id)
    return id
  } catch {
    return `dev_fallback_${Math.random().toString(36).slice(2, 9)}`
  }
}

export default function SiswaUjianPage() {
  const [phase, setPhase] = useState<Phase>('KODE')
  const [kode, setKode] = useState('')
  const [sesiInfo, setSesiInfo] = useState<SesiInfo | null>(null)
  const [jawaban, setJawaban] = useState<JawabanMap>({})
  const [currentIdx, setCurrentIdx] = useState(0)
  const [sisaWaktu, setSisaWaktu] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [confirmSelesai, setConfirmSelesai] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [hasilNilai, setHasilNilai] = useState<{ id?: string; nilai: number; benar: number; total: number; grade: string; lulus: boolean } | null>(null)

  // ── Status sinkronisasi jawaban ke server ─────────────────────────────────
  // 'idle' = belum ada perubahan yang perlu disinkron
  // 'syncing' = sedang mencoba kirim ke server
  // 'synced' = percobaan sync terakhir berhasil dikonfirmasi server
  // 'error' = sudah dicoba berulang kali (dengan backoff) tapi tetap gagal
  const [syncStatus, setSyncStatus] = useState<'idle' | 'syncing' | 'synced' | 'error'>('idle')
  const [syncErrorMsg, setSyncErrorMsg] = useState('')
  // Modal pemblokir saat siswa klik "Selesai" tapi verifikasi jumlah jawaban
  // tersimpan di server TIDAK cocok dengan jumlah yang dijawab di lokal.
  // Ujian TIDAK akan dinilai sampai ini terverifikasi cocok (atau siswa retry manual berhasil).
  const [showSyncFailModal, setShowSyncFailModal] = useState(false)
  const [syncFailInfo, setSyncFailInfo] = useState<{ expected: number; synced: number }>({ expected: 0, synced: 0 })
  const [manualRetrying, setManualRetrying] = useState(false)

  // FIX: sebelumnya saat pengawas menutup sesi mendadak, siswa tidak mendapat
  // pemberitahuan apa pun — tombol "Selesai" hanya diam-diam jadi nonaktif
  // (karena terjebak loop verifikasi sync yang pasti gagal terus, sebab server
  // menolak sync setelah sesi ditutup) sehingga aplikasi terlihat "hang".
  // Sekarang ditampilkan notifikasi jelas begitu sesi ditutup paksa.
  const [sesiDitutupPaksa, setSesiDitutupPaksa] = useState(false)

  // Fullscreen & anti-cheat state
  const [isFS, setIsFS] = useState(false)
  const [warningMsg, setWarningMsg] = useState('')
  const [showWarningOverlay, setShowWarningOverlay] = useState(false)

  // Reset kode state (siswa harus masukkan kode dari pengawas)
  const [kodeReset, setKodeReset] = useState('')
  const [kodeResetError, setKodeResetError] = useState('')
  const [kodeResetLoading, setKodeResetLoading] = useState(false)
  const [pendingResetSesiId, setPendingResetSesiId] = useState<string | null>(null)

  // Logout paksa karena pelanggaran melebihi batas
  const [diambilAlihDevice, setDiambilAlihDevice] = useState(false)
  const [dikeluarkan, setDikeluarkan] = useState(false)
  const [batasPelanggaran, setBatasPelanggaran] = useState(3)

  // Waktu terpakai (detik) — diupdate tiap detik bersama countdown,
  // digunakan untuk menegakkan batas minimal waktu sebelum submit.
  const [waktuTerpakai, setWaktuTerpakai] = useState(0)

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const syncRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const sesiPollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const pelanggRef = useRef(0)
  const pelanggaranActiveRef = useRef(false)
  const jawabanRef = useRef<JawabanMap>({})
  const sesiInfoRef = useRef<SesiInfo | null>(null)
  const phaseRef = useRef<Phase>('KODE')

  useEffect(() => { jawabanRef.current = jawaban }, [jawaban])
  useEffect(() => { sesiInfoRef.current = sesiInfo }, [sesiInfo])
  useEffect(() => { phaseRef.current = phase }, [phase])

  // ── Backup tiap kali jawaban berubah (lihat catatan di backupKey/saveBackup) ──
  useEffect(() => {
    if (phase !== 'UJIAN' || !sesiInfo) return
    const user = JSON.parse(localStorage.getItem('user') ?? '{}')
    if (user?.nis) saveBackup(sesiInfo.sesiId, user.nis, jawaban)
  }, [jawaban, phase, sesiInfo])

  // ── Peringatkan siswa jika mencoba menutup/refresh tab saat masih ada
  // jawaban yang belum terkonfirmasi tersimpan di server ──────────────────
  useEffect(() => {
    if (phase !== 'UJIAN') return
    function onBeforeUnload(e: BeforeUnloadEvent) {
      if (syncStatus === 'error' || syncStatus === 'syncing') {
        e.preventDefault()
        e.returnValue = ''
      }
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [phase, syncStatus])

  // ── Ambil batasPelanggaran dari pengaturan saat mount ─────────────────────
  useEffect(() => {
    fetch(`/api/public/pengaturan?t=${Date.now()}`, { cache: 'no-store' })
      .then(r => r.json())
      .then(json => {
        const batas = parseInt(json?.data?.batasPelanggaran ?? '3', 10)
        if (!isNaN(batas) && batas > 0) setBatasPelanggaran(batas)
      })
      .catch(() => {})
  }, [])

  // ── Minta izin blokir notifikasi saat ujian dimulai ───────────────────────
  useEffect(() => {
    if (phase !== 'UJIAN') return
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission()
    }
  }, [phase])

  // ── Masuk fullscreen saat phase UJIAN ─────────────────────────────────────
  useEffect(() => {
    if (phase !== 'UJIAN') return
    const el = document.documentElement
    requestFullscreen(el).catch(() => {})

    function onFSChange() {
      setIsFS(isFullscreen())
    }
    document.addEventListener('fullscreenchange', onFSChange)
    document.addEventListener('webkitfullscreenchange', onFSChange)
    document.addEventListener('mozfullscreenchange', onFSChange)
    document.addEventListener('MSFullscreenChange', onFSChange)
    return () => {
      document.removeEventListener('fullscreenchange', onFSChange)
      document.removeEventListener('webkitfullscreenchange', onFSChange)
      document.removeEventListener('mozfullscreenchange', onFSChange)
      document.removeEventListener('MSFullscreenChange', onFSChange)
    }
  }, [phase])

  // ── Deteksi keluar fullscreen saat ujian ─────────────────────────────────
  useEffect(() => {
    if (phase !== 'UJIAN') return
    let fsCooldown: ReturnType<typeof setTimeout> | null = null
    function onFSChange() {
      if (!isFullscreen()) {
        if (pelanggaranActiveRef.current) return
        if (fsCooldown) return
        pelanggaranActiveRef.current = true
        pelanggRef.current++
        laporPelanggaran('EXIT_FULLSCREEN', `Keluar layar penuh ke-${pelanggRef.current}`)
        setWarningMsg('⚠ Anda keluar dari mode layar penuh!')
        setShowWarningOverlay(true)
        fsCooldown = setTimeout(() => { fsCooldown = null }, 2000)
      }
    }

    document.addEventListener('fullscreenchange', onFSChange)
    document.addEventListener('webkitfullscreenchange', onFSChange)
    document.addEventListener('mozfullscreenchange', onFSChange)
    document.addEventListener('MSFullscreenChange', onFSChange)
    return () => {
      document.removeEventListener('fullscreenchange', onFSChange)
      document.removeEventListener('webkitfullscreenchange', onFSChange)
      document.removeEventListener('mozfullscreenchange', onFSChange)
      document.removeEventListener('MSFullscreenChange', onFSChange)
      if (fsCooldown) clearTimeout(fsCooldown)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase])

  // ── Anti-cheat: tab switch / visibilitychange ─────────────────────────────
  useEffect(() => {
    if (phase !== 'UJIAN') return
    // Cooldown mencegah event ganda (visibilitychange + blur keduanya fire sekaligus)
    let visCooldown: ReturnType<typeof setTimeout> | null = null
    function onVisibilityChange() {
      if (!document.hidden) return
      if (pelanggaranActiveRef.current) return
      if (visCooldown) return
      pelanggaranActiveRef.current = true
      pelanggRef.current++
      laporPelanggaran('TAB_SWITCH', `Berpindah tab/aplikasi ke-${pelanggRef.current}`)
      setWarningMsg('⚠ Berpindah tab atau aplikasi terdeteksi!')
      setShowWarningOverlay(true)
      visCooldown = setTimeout(() => { visCooldown = null }, 2000)
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange)
      if (visCooldown) clearTimeout(visCooldown)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase])

  // ── Anti-cheat: blokir klik kanan ────────────────────────────────────────
  useEffect(() => {
    if (phase !== 'UJIAN') return
    function block(e: MouseEvent) { e.preventDefault() }
    document.addEventListener('contextmenu', block)
    return () => document.removeEventListener('contextmenu', block)
  }, [phase])

  // ── Anti-cheat: blokir shortcut keyboard berbahaya ───────────────────────
  useEffect(() => {
    if (phase !== 'UJIAN') return
    function onKeyDown(e: KeyboardEvent) {
      const blockedKeys = [
        e.ctrlKey && e.key === 'c',
        e.ctrlKey && e.key === 'v',
        e.ctrlKey && e.key === 'a',
        e.ctrlKey && e.key === 'u',
        e.ctrlKey && e.key === 'p',
        e.ctrlKey && e.shiftKey && e.key === 'I',
        e.ctrlKey && e.shiftKey && e.key === 'J',
        e.ctrlKey && e.shiftKey && e.key === 'C',
        e.key === 'F12',
        e.key === 'PrintScreen',
        e.altKey && e.key === 'Tab',
        e.metaKey,
      ]
      if (blockedKeys.some(Boolean)) {
        e.preventDefault()
        e.stopPropagation()
      }
    }
    document.addEventListener('keydown', onKeyDown, true)
    return () => document.removeEventListener('keydown', onKeyDown, true)
  }, [phase])

  // ── Anti-cheat: blokir copy/paste/cut ────────────────────────────────────
  useEffect(() => {
    if (phase !== 'UJIAN') return
    function block(e: ClipboardEvent) { e.preventDefault() }
    document.addEventListener('copy', block)
    document.addEventListener('cut', block)
    document.addEventListener('paste', block)
    return () => {
      document.removeEventListener('copy', block)
      document.removeEventListener('cut', block)
      document.removeEventListener('paste', block)
    }
  }, [phase])

  // ── Anti-cheat: blokir drag & drop ───────────────────────────────────────
  useEffect(() => {
    if (phase !== 'UJIAN') return
    function block(e: DragEvent) { e.preventDefault() }
    document.addEventListener('dragstart', block)
    document.addEventListener('drop', block)
    return () => {
      document.removeEventListener('dragstart', block)
      document.removeEventListener('drop', block)
    }
  }, [phase])

  // ── Anti-cheat: blokir window blur (pindah aplikasi di HP) ───────────────
  useEffect(() => {
    if (phase !== 'UJIAN') return
    // Cooldown timer untuk mencegah event blur/visibilitychange terpicu berganda
    let blurCooldown: ReturnType<typeof setTimeout> | null = null
    function onBlur() {
      if (pelanggaranActiveRef.current) return
      if (blurCooldown) return // masih dalam cooldown 2 detik
      pelanggaranActiveRef.current = true
      pelanggRef.current++
      laporPelanggaran('WINDOW_BLUR', `Keluar dari aplikasi ujian ke-${pelanggRef.current}`)
      setWarningMsg('⚠ Anda keluar dari aplikasi ujian!')
      setShowWarningOverlay(true)
      blurCooldown = setTimeout(() => { blurCooldown = null }, 2000)
    }
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('blur', onBlur)
      if (blurCooldown) clearTimeout(blurCooldown)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase])

  // ── Keluar fullscreen saat ujian selesai ──────────────────────────────────
  useEffect(() => {
    if ((phase === 'SELESAI' || phase === 'RESET_KODE') && isFullscreen()) {
      exitFullscreen().catch(() => {})
    }
  }, [phase])

  // ── Polling status sesi setiap 10 detik — jika SELESAI, paksa submit ─────
  const cekStatusSesi = useCallback(async () => {
    const currentSesi = sesiInfoRef.current
    const currentPhase = phaseRef.current
    if (!currentSesi || currentPhase !== 'UJIAN') return
    try {
      const res = await apiRequest<{ sesi_status?: string; siswa_status?: string; diambil_alih_device_lain?: boolean } | null>(
        `/api/siswa/ujian/cek-sesi?sesiId=${currentSesi.sesiId}&deviceId=${getDeviceId()}`
      )
      if (!res) return

      // Deteksi takeover oleh device lain — hentikan semua interval, tampilkan overlay
      if ((res as { diambil_alih_device_lain?: boolean }).diambil_alih_device_lain) {
        clearInterval(timerRef.current!)
        clearInterval(syncRef.current!)
        clearInterval(sesiPollRef.current!)
        setDiambilAlihDevice(true)
        return
      }

      // FIX BUG A+B: cek status SISWA (TERKUNCI) selain status SESI (SELESAI).
      // Sebelumnya polling hanya bereaksi kalau sesi ditutup pengawas — kalau
      // admin mengunci siswa secara individual (status TERKUNCI), siswa tidak
      // mendapat notifikasi apapun dan baru tahu saat coba submit (ditolak 403).
      if ((res as { siswa_status?: string }).siswa_status === 'TERKUNCI') {
        clearInterval(timerRef.current!)
        clearInterval(syncRef.current!)
        clearInterval(sesiPollRef.current!)
        setDikeluarkan(true)
        return
      }

      // FIX Bug #3: handle siswa_status RESET dari polling.
      // Jika pengawas me-reset siswa dari mode pengawas saat siswa sedang
      // mengerjakan, siswa_ujian.status berubah ke RESET tapi polling tidak
      // bereaksi — overlay pelanggaran tidak muncul, sync jawaban diam-diam
      // ditolak 403, dan siswa bingung kenapa jawaban tidak tersimpan.
      // Sekarang: munculkan overlay warning agar siswa tahu dan menghubungi pengawas.
      if ((res as { siswa_status?: string }).siswa_status === 'RESET' && !showWarningOverlay) {
        pelanggaranActiveRef.current = true
        setWarningMsg('⚠ Pengawas telah me-reset akun Anda karena pelanggaran terdeteksi.')
        setShowWarningOverlay(true)
        return
      }

      if ((res as { sesi_status?: string }).sesi_status === 'SELESAI') {
        clearInterval(timerRef.current!)
        clearInterval(syncRef.current!)
        clearInterval(sesiPollRef.current!)
        setSesiDitutupPaksa(true)
        await handleSelesai(true, true)
      }
    } catch { /* silent */ }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (phase !== 'UJIAN') return
    sesiPollRef.current = setInterval(cekStatusSesi, 10000)
    return () => clearInterval(sesiPollRef.current!)
  }, [phase, cekStatusSesi])

  // ── Timer ─────────────────────────────────────────────────────────────────
  const sisaWaktuRef = useRef(0)
  useEffect(() => { sisaWaktuRef.current = sisaWaktu }, [sisaWaktu])

  useEffect(() => {
    if (phase !== 'UJIAN') return
    timerRef.current = setInterval(() => {
      setSisaWaktu(prev => {
        if (prev <= 1) {
          clearInterval(timerRef.current!)
          setTimeout(() => handleSelesai(true), 0)
          return 0
        }
        return prev - 1
      })
      setWaktuTerpakai(prev => prev + 1)
    }, 1000)
    return () => clearInterval(timerRef.current!)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase])

  // ── Auto sync ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (phase !== 'UJIAN') return
    syncRef.current = setInterval(() => syncJawaban(), 30000)
    return () => clearInterval(syncRef.current!)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase])

  // ── Sync jawaban ke server, dengan retry otomatis ─────────────────────────
  // PENTING: berbeda dari versi sebelumnya, fungsi ini TIDAK diam-diam menyerah
  // saat request gagal. Ia mencoba ulang beberapa kali dengan jeda yang makin
  // panjang (exponential backoff), dan selalu mengembalikan `totalSynced` yang
  // diambil langsung dari hitungan baris di database (ground truth dari server),
  // bukan asumsi "fetch tidak error = semua tersimpan". Pemanggil (terutama
  // handleSelesai) WAJIB memeriksa nilai ini sebelum menganggap ujian selesai.
  const MAX_SYNC_RETRY = 4
  const syncJawaban = useCallback(async (): Promise<{ ok: boolean; totalSynced: number; sesiClosed?: boolean }> => {
    const currentSesi = sesiInfoRef.current
    const currentJawaban = jawabanRef.current
    if (!currentSesi) return { ok: true, totalSynced: 0 }
    const entries = Object.entries(currentJawaban)

    setSyncStatus('syncing')
    for (let attempt = 1; attempt <= MAX_SYNC_RETRY; attempt++) {
      try {
        const res = await apiRequest<{ message: string; totalSynced: number }>('/api/siswa/ujian/sync', {
          method: 'POST',
          body: JSON.stringify({
            sesiId: currentSesi.sesiId,
            jawaban: entries.map(([soal_id, jwb]) => ({ soal_id, jawaban: jwb })),
            deviceId: getDeviceId(),
          }),
        })
        setSyncStatus('synced')
        setSyncErrorMsg('')
        return { ok: true, totalSynced: res.totalSynced ?? 0 }
      } catch (e) {
        console.warn(`Sync percobaan ke-${attempt} gagal:`, e)
        // FIX: jika server menolak karena sesi sudah ditutup pengawas (409),
        // ini bukan masalah koneksi — mengulang 4x dengan backoff hanya
        // membuang waktu karena pasti gagal terus. Hentikan segera dan
        // beri tahu pemanggil agar bisa menampilkan pesan yang tepat.
        const status = (e as { status?: number } | undefined)?.status
        if (status === 409) {
          const msg = (e as { data?: { error?: string } } | undefined)?.data?.error ?? ''
          const isTakeover = msg.includes('perangkat lain')
          setSyncStatus('error')
          setSyncErrorMsg(isTakeover
            ? 'Sesi Anda diambil alih perangkat lain.'
            : 'Sesi ujian sudah ditutup oleh pengawas.')
          return { ok: false, totalSynced: 0, sesiClosed: !isTakeover }
        }
        if (attempt < MAX_SYNC_RETRY) {
          // Backoff bertahap: 1.5s, 3s, 4.5s — beri waktu jaringan/server pulih
          await new Promise(r => setTimeout(r, attempt * 1500))
        }
      }
    }
    setSyncStatus('error')
    setSyncErrorMsg('Koneksi tidak stabil — sebagian jawaban gagal tersimpan ke server.')
    return { ok: false, totalSynced: 0 }
  }, [])

  // ── Pulihkan jawaban saat masuk/membuka ulang ujian ───────────────────────
  // Diambil dari server (ground truth) lalu ditimpa dengan backup lokal (kalau ada),
  // karena backup lokal merepresentasikan pilihan terakhir siswa yang mungkin
  // belum sempat terkonfirmasi ke server saat tab/koneksi sempat bermasalah.
  // Ini mencegah siswa "kehilangan" jawaban yang sudah dipilih kalau halaman
  // ter-reload di tengah ujian.
  const resumeJawaban = useCallback(async (sesiId: string, nis: string) => {
    const backup = loadBackup(sesiId, nis)
    let serverJawaban: JawabanMap = {}
    try {
      const res = await apiRequest<{ jawaban: { soal_id: string; jawaban: string }[] }>(
        `/api/siswa/ujian/sync?sesiId=${sesiId}`
      )
      serverJawaban = Object.fromEntries((res.jawaban ?? []).map(j => [j.soal_id, j.jawaban]))
    } catch (e) {
      console.warn('Gagal mengambil jawaban tersimpan dari server, pakai backup lokal saja:', e)
    }
    const merged: JawabanMap = { ...serverJawaban, ...backup }
    if (Object.keys(merged).length > 0) {
      jawabanRef.current = merged
      setJawaban(merged)
    }
  }, [])

  async function laporPelanggaran(jenis: string, detail: string) {
    const currentSesi = sesiInfoRef.current
    if (!currentSesi) return
    try {
      const res = await apiRequest<{ perlu_reset?: boolean; level?: number; batasPelanggaran?: number }>('/api/siswa/ujian/pelanggaran', {
        method: 'POST',
        body: JSON.stringify({ sesiId: currentSesi.sesiId, jenis, detail }),
      })
      // FIX BUG A: simpan batasPelanggaran dari response supaya halaman
      // "Ujian Dihentikan" menampilkan angka yang benar.
      if (res?.batasPelanggaran) setBatasPelanggaran(res.batasPelanggaran)

      // Catatan: setDikeluarkan(true) TIDAK dipanggil di sini karena endpoint
      // pelanggaran siswa hanya mencatat kejadian — keputusan kunci/dikeluarkan
      // ada di tangan pengawas/admin. Polling cekStatusSesi (tiap 10 detik) yang
      // akan mendeteksi status TERKUNCI dan memanggil setDikeluarkan(true).
    } catch (e) { console.warn(e) }
  }

  async function handleMasukUjian() {
    if (!kode.trim()) { setError('Masukkan kode sesi terlebih dahulu'); return }
    setLoading(true); setError('')
    try {
      const user = JSON.parse(localStorage.getItem('user') ?? '{}')
      const res = await apiRequest<{ 
        valid: boolean
        message?: string
        perlu_kode_reset?: boolean
        sesiId?: string
      } & SesiInfo>('/api/siswa/ujian/validasi', {
        method: 'POST',
        body: JSON.stringify({ kodeSesi: kode.trim().toUpperCase(), nis: user.nis, deviceId: getDeviceId() }),
      })

      // Siswa dalam status RESET — perlu kode 7 digit dari pengawas
      if (!res.valid && res.perlu_kode_reset && res.sesiId) {
        setPendingResetSesiId(res.sesiId)
        setPhase('RESET_KODE')
        return
      }

      if (!res.valid) { setError(res.message ?? 'Kode tidak valid'); return }
      setSesiInfo(res)
      await resumeJawaban(res.sesiId, user.nis)
      const terpakai1 = Math.floor((Date.now() - new Date(res.waktu_mulai).getTime()) / 1000)
      setSisaWaktu(Math.max(0, res.durasi * 60 - terpakai1))
      setWaktuTerpakai(terpakai1)
      setPhase('UJIAN')
      setTimeout(() => {
        requestFullscreen(document.documentElement).catch(() => {})
      }, 100)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Gagal memvalidasi kode')
    } finally { setLoading(false) }
  }

  async function handleVerifikasiReset() {
    if (!kodeReset.trim()) { setKodeResetError('Masukkan kode reset dari pengawas'); return }
    if (!pendingResetSesiId) return
    setKodeResetLoading(true); setKodeResetError('')
    try {
      // FIX Bug #1: tambahkan waktu_mulai ke type agar sisa waktu dihitung
      // dari waktu_mulai_awal yang dikembalikan server, bukan dari /validasi
      // berikutnya yang mungkin memberi waktu berbeda.
      const res = await apiRequest<{ valid: boolean; message?: string; waktu_mulai?: string }>('/api/siswa/ujian/verifikasi-reset', {
        method: 'POST',
        body: JSON.stringify({ sesiId: pendingResetSesiId, kodeReset: kodeReset.trim().toUpperCase() }),
      })
      if (!res.valid) { setKodeResetError(res.message ?? 'Kode tidak valid'); return }

      setKodeReset('')
      setPhase('KODE')
      setKode(kode)
      setLoading(true)
      try {
        const user = JSON.parse(localStorage.getItem('user') ?? '{}')
        const sesiRes = await apiRequest<{ valid: boolean; message?: string } & SesiInfo>('/api/siswa/ujian/validasi', {
          method: 'POST',
          body: JSON.stringify({ kodeSesi: kode.trim().toUpperCase(), nis: user.nis, deviceId: getDeviceId() }),
        })
        if (!sesiRes.valid) { setError(sesiRes.message ?? 'Gagal masuk ujian'); setPhase('KODE'); return }
        setSesiInfo(sesiRes)
        await resumeJawaban(sesiRes.sesiId, user.nis)

        // FIX Bug #1: pakai waktu_mulai dari response verifikasi reset (waktu_mulai_awal)
        // jika tersedia, karena itulah ground truth dari server. Fallback ke sesiRes
        // hanya jika tidak ada (misalnya versi API lama).
        const waktuAcuan = res.waktu_mulai ?? sesiRes.waktu_mulai
        const terpakai2 = Math.floor((Date.now() - new Date(waktuAcuan).getTime()) / 1000)
        setSisaWaktu(Math.max(0, sesiRes.durasi * 60 - terpakai2))
        setWaktuTerpakai(terpakai2)

        // FIX Bug #2: reset pelanggaranActiveRef agar event anti-cheat
        // berikutnya (keluar fullscreen, ganti tab, blur) kembali aktif.
        // Tanpa ini, semua pelanggaran setelah reset tidak akan terdeteksi.
        pelanggaranActiveRef.current = false

        setPhase('UJIAN')
        setTimeout(() => requestFullscreen(document.documentElement).catch(() => {}), 100)
      } finally { setLoading(false) }
    } catch (err: unknown) {
      setKodeResetError(err instanceof Error ? err.message : 'Gagal memverifikasi kode')
    } finally { setKodeResetLoading(false) }
  }

  async function handleSelesai(isTimeout = false, dipaksaPengawas = false) {
    if (submitting) return
    setConfirmSelesai(false)
    setSubmitting(true)
    // CATATAN: interval auto-sync/timer/polling SENGAJA TIDAK dihentikan di sini.
    // Kalau verifikasi di bawah gagal, biarkan auto-sync 30 detik dan retry manual
    // tetap punya kesempatan jalan di background selama modal kegagalan tampil —
    // baru dihentikan saat benar-benar terkonfirmasi selesai (lihat di bawah).

    const expectedCount = Object.keys(jawabanRef.current).length

    // ── Verifikasi sebelum finalisasi ──────────────────────────────────────
    // Ini adalah inti perbaikan: JANGAN PERNAH memanggil endpoint penilaian
    // hanya berdasarkan "sync tidak melempar error". Kita ulangi sync + cek
    // beberapa ronde, dan baru lanjut menilai kalau jumlah jawaban yang
    // dikonfirmasi SERVER (totalSynced, dari hitungan baris di DB) sudah
    // sama dengan jumlah yang dijawab siswa secara lokal.
    //
    // FIX: pengecualian untuk kasus sesi ditutup paksa oleh pengawas
    // (dipaksaPengawas=true) — di sini server SUDAH PASTI menolak setiap
    // percobaan sync (sesi tidak BERJALAN lagi), jadi loop verifikasi ini
    // tidak akan pernah berhasil walau diulang berapa kali pun. Sebelumnya
    // ini membuat siswa terjebak di modal "coba lagi" selamanya tanpa
    // penjelasan. Sekarang: coba sync sekali (best-effort, untuk menyimpan
    // jawaban terakhir jika masih memungkinkan), lalu langsung lanjut ke
    // penilaian dengan jawaban yang sudah tersimpan di server sejauh ini.
    const MAX_VERIFY_ROUNDS = 4
    let verified = false
    let totalSynced = 0
    let sesiClosedDuringSync = false
    for (let round = 1; round <= MAX_VERIFY_ROUNDS; round++) {
      const result = await syncJawaban()
      totalSynced = result.totalSynced
      if (result.ok && totalSynced >= expectedCount) { verified = true; break }
      if (result.sesiClosed) { sesiClosedDuringSync = true; setSesiDitutupPaksa(true); break }
      if (dipaksaPengawas) break // jangan ulangi percobaan yang sudah pasti gagal
      if (round < MAX_VERIFY_ROUNDS) await new Promise(r => setTimeout(r, 2000))
    }

    if (!verified && !dipaksaPengawas && !sesiClosedDuringSync) {
      // Jangan diam-diam lanjut menilai dengan data yang belum lengkap.
      // Tampilkan ke siswa secara jelas + beri opsi coba lagi manual atau
      // kembali menjawab dulu sambil menunggu koneksi pulih.
      setSyncFailInfo({ expected: expectedCount, synced: totalSynced })
      setShowSyncFailModal(true)
      setSubmitting(false)
      return
    }

    clearInterval(timerRef.current!)
    clearInterval(syncRef.current!)
    clearInterval(sesiPollRef.current!)

    try {
      const user = JSON.parse(localStorage.getItem('user') ?? '{}')
      const currentSesi = sesiInfoRef.current
      const res = await apiRequest<{ id?: string; nilai: number; benar: number; total: number; grade: string; lulus: boolean }>('/api/siswa/ujian/selesai', {
        method: 'POST',
        body: JSON.stringify({
          sesiId: currentSesi!.sesiId,
          nis: user.nis,
          isTimeout,
        }),
      })
      setHasilNilai(res)
      setPhase('SELESAI')
      if (currentSesi && user?.nis) clearBackup(currentSesi.sesiId, user.nis)
    } catch (err: unknown) {
      console.error(err)
      if (dipaksaPengawas || sesiClosedDuringSync) {
        // Sesi sudah ditutup pengawas dan endpoint penilaian pun gagal
        // (kemungkinan masalah jaringan saat itu) — biarkan siswa lihat
        // notifikasi penutupan sesi dan beri opsi coba lagi yang relevan,
        // bukan modal generik "koneksi tidak stabil".
        setSyncFailInfo({ expected: expectedCount, synced: totalSynced })
        setShowSyncFailModal(true)
      } else {
        // Gagal memanggil endpoint penilaian (bukan sekadar sync jawaban) —
        // beri kesempatan retry juga, jangan tampilkan layar kosong/diam.
        setSyncFailInfo({ expected: expectedCount, synced: totalSynced })
        setShowSyncFailModal(true)
      }
    } finally { setSubmitting(false) }
  }

  // Dipanggil dari tombol "Coba Lagi" di modal kegagalan sync.
  async function handleRetrySelesai() {
    setManualRetrying(true)
    try {
      await handleSelesai(false, sesiDitutupPaksa)
    } finally {
      setManualRetrying(false)
      setShowSyncFailModal(false)
    }
  }

  // Dipanggil dari tombol "Kembali ke Ujian" — siswa boleh menjawab/menunggu
  // koneksi pulih dulu, auto-sync di background tetap berjalan seperti biasa.
  function handleKembaliDariSyncFail() {
    setShowSyncFailModal(false)
  }

  function handleKembaliFullscreen() {
    // Tidak lagi dipakai langsung — digantikan handleVerifikasiResetDariOverlay
    requestFullscreen(document.documentElement).catch(() => {})
    setShowWarningOverlay(false)
    setWarningMsg('')
  }

  async function handleVerifikasiResetDariOverlay() {
    if (!kodeReset.trim()) { setKodeResetError('Masukkan kode reset dari pengawas'); return }
    const currentSesi = sesiInfoRef.current
    if (!currentSesi) return
    setKodeResetLoading(true); setKodeResetError('')
    try {
      const res = await apiRequest<{ valid: boolean; waktu_mulai?: string; message?: string }>('/api/siswa/ujian/verifikasi-reset', {
        method: 'POST',
        body: JSON.stringify({ sesiId: currentSesi.sesiId, kodeReset: kodeReset.trim().toUpperCase() }),
      })
      if (!res.valid) { setKodeResetError(res.message ?? 'Kode tidak valid'); return }
      // FIX: hitung sisa waktu dari waktu_mulai_awal (bukan dari sekarang)
      if (res.waktu_mulai) {
        const terpakai = Math.floor((Date.now() - new Date(res.waktu_mulai).getTime()) / 1000)
        setSisaWaktu(Math.max(0, currentSesi.durasi * 60 - terpakai))
      }
      setKodeReset('')
      setKodeResetError('')
      setShowWarningOverlay(false)
      setWarningMsg('')
      pelanggaranActiveRef.current = false
      requestFullscreen(document.documentElement).catch(() => {})
    } catch (err: unknown) {
      setKodeResetError(err instanceof Error ? err.message : 'Gagal memverifikasi kode')
    } finally { setKodeResetLoading(false) }
  }

  const formatWaktu = (detik: number) => {
    const m = Math.floor(detik / 60)
    const s = detik % 60
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  }

  const soalList = sesiInfo?.soalList ?? []
  const soalCurrent = soalList[currentIdx]
  const totalDijawab = Object.values(jawaban).filter(Boolean).length
  const opsiLabels = ['A', 'B', 'C', 'D', 'E']

  // ── Phase: KODE ──────────────────────────────────────────────────────────
  if (phase === 'KODE') {
    return (
      <div className="max-w-md mx-auto animate-fade-in">
        <div className="card text-center">
          <div className="w-16 h-16 bg-brand-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <BookOpen className="w-8 h-8 text-brand-600" />
          </div>
          <h1 className="text-xl font-bold text-slate-900 mb-2">Masuk Ujian</h1>
          <p className="text-sm text-slate-500 mb-6">Masukkan kode sesi yang diberikan pengawas</p>

          {error && (
            <div className="alert-error mb-4 text-left">
              <AlertTriangle className="w-4 h-4 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <input
            type="text"
            className="input text-center text-2xl font-mono tracking-widest uppercase mb-4"
            placeholder="XXXXXXX"
            maxLength={7}
            value={kode}
            onChange={e => setKode(e.target.value.toUpperCase())}
            onKeyDown={e => e.key === 'Enter' && handleMasukUjian()}
            autoFocus
          />

          <button onClick={handleMasukUjian} disabled={loading} className="btn-primary w-full justify-center py-3">
            {loading ? <Spinner size="sm" /> : 'Masuk Ujian'}
          </button>

          <div className="mt-4 text-xs text-slate-400 space-y-1">
            <p>• Pastikan koneksi internet stabil sebelum memulai</p>
            <p>• Layar akan otomatis masuk mode fullscreen saat ujian dimulai</p>
            <p>• Jangan berpindah tab/aplikasi saat ujian berlangsung</p>
            <p>• Jawaban tersimpan otomatis setiap 30 detik</p>
          </div>
        </div>
      </div>
    )
  }

  // ── Phase: RESET_KODE — siswa harus masukkan kode 7 digit dari pengawas ──
  if (phase === 'RESET_KODE') {
    return (
      <div className="max-w-md mx-auto animate-fade-in">
        <div className="card text-center">
          <div className="w-16 h-16 bg-amber-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <KeyRound className="w-8 h-8 text-amber-600" />
          </div>
          <h1 className="text-xl font-bold text-slate-900 mb-2">Akun Di-Reset Pengawas</h1>
          <p className="text-sm text-slate-500 mb-2">
            Akun Anda di-reset oleh pengawas karena terdeteksi pelanggaran.
          </p>
          <p className="text-sm font-semibold text-amber-700 mb-6">
            Minta kode 7 digit kepada pengawas untuk melanjutkan ujian.
          </p>

          {kodeResetError && (
            <div className="alert-error mb-4 text-left">
              <AlertTriangle className="w-4 h-4 flex-shrink-0" />
              <span>{kodeResetError}</span>
            </div>
          )}

          <input
            type="text"
            className="input text-center text-2xl font-mono tracking-widest uppercase mb-4"
            placeholder="XXXXXXX"
            maxLength={7}
            value={kodeReset}
            onChange={e => setKodeReset(e.target.value.toUpperCase())}
            onKeyDown={e => e.key === 'Enter' && handleVerifikasiReset()}
            autoFocus
          />

          <button onClick={handleVerifikasiReset} disabled={kodeResetLoading} className="btn-primary w-full justify-center py-3">
            {kodeResetLoading ? <Spinner size="sm" /> : 'Lanjutkan Ujian'}
          </button>

          <p className="mt-4 text-xs text-slate-400">
            Hubungi pengawas di ruangan untuk mendapatkan kode reset.
          </p>
        </div>
      </div>
    )
  }

  // ── Phase: DIAMBIL ALIH DEVICE LAIN ──────────────────────────────────────
  if (diambilAlihDevice) {
    return (
      <div className="max-w-md mx-auto animate-fade-in">
        <div className="card text-center">
          <div className="w-20 h-20 bg-amber-100 rounded-3xl flex items-center justify-center mx-auto mb-4">
            <AlertTriangle className="w-10 h-10 text-amber-600" />
          </div>
          <h2 className="text-xl font-bold text-slate-900 mb-2">Sesi Diambil Alih Perangkat Lain</h2>
          <p className="text-sm text-slate-500 mb-4">
            Akun Anda login dari perangkat lain. Browser ini tidak lagi bisa menyimpan jawaban.
          </p>
          <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 mb-6">
            <p className="text-xs text-amber-700">Jika ini kesalahan, tutup browser di perangkat lain dan masuk kembali dari sini. Hubungi pengawas jika butuh bantuan.</p>
          </div>
          <button onClick={() => window.location.reload()} className="btn-secondary w-full justify-center">
            Coba Masuk Lagi
          </button>
        </div>
      </div>
    )
  }

  // ── Phase: DIKELUARKAN (3x pelanggaran → nilai 0) ─────────────────────────
  if (dikeluarkan) {
    return (
      <div className="max-w-md mx-auto animate-fade-in">
        <div className="card text-center">
          <div className="w-20 h-20 bg-red-100 rounded-3xl flex items-center justify-center mx-auto mb-4">
            <LogOut className="w-10 h-10 text-red-600" />
          </div>
          <h2 className="text-xl font-bold text-slate-900 mb-2">Ujian Dihentikan</h2>
          <p className="text-sm text-slate-500 mb-4">
            Anda telah melanggar aturan ujian sebanyak {batasPelanggaran} kali. Sistem secara otomatis menghentikan ujian Anda.
          </p>
          <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 mb-6">
            <p className="text-sm font-semibold text-red-700">Nilai Anda: 0</p>
            <p className="text-xs text-red-500 mt-1">Hubungi pengawas atau guru untuk informasi lebih lanjut.</p>
          </div>
          <button onClick={() => window.location.href = '/siswa'} className="btn-secondary w-full justify-center">
            Kembali ke Beranda
          </button>
        </div>
      </div>
    )
  }

  // ── Phase: SELESAI ────────────────────────────────────────────────────────
  if (phase === 'SELESAI' && hasilNilai) {
    return (
      <div className="max-w-md mx-auto animate-fade-in">
        <div className="card text-center">
          <div className={`w-20 h-20 rounded-3xl flex items-center justify-center mx-auto mb-4 ${
            hasilNilai.lulus ? 'bg-emerald-100' : 'bg-red-100'
          }`}>
            {hasilNilai.lulus
              ? <CheckCircle className="w-10 h-10 text-emerald-600" />
              : <AlertTriangle className="w-10 h-10 text-red-500" />
            }
          </div>
          <h2 className="text-xl font-bold text-slate-900 mb-1">
            {hasilNilai.lulus ? 'Selamat! Anda Lulus' : 'Ujian Selesai'}
          </h2>
          <p className="text-sm text-slate-500 mb-6">{sesiInfo?.namaMapel}</p>

          {sesiDitutupPaksa && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 mb-4 text-left flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
              <p className="text-xs text-amber-700">
                Sesi ujian ditutup oleh pengawas sebelum Anda menekan "Selesai". Jawaban yang sudah tersimpan otomatis dinilai.
              </p>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
            <div className="bg-slate-50 rounded-xl p-4">
              <div className="text-3xl font-bold text-slate-900">{hasilNilai.nilai}</div>
              <div className="text-xs text-slate-400 mt-1">Nilai</div>
            </div>
            <div className={`rounded-xl p-4 ${
              hasilNilai.grade === 'A' ? 'bg-emerald-50' :
              hasilNilai.grade === 'B' ? 'bg-blue-50' :
              hasilNilai.grade === 'C' ? 'bg-yellow-50' :
              'bg-red-50'
            }`}>
              <div className={`text-3xl font-bold ${
                hasilNilai.grade === 'A' ? 'text-emerald-700' :
                hasilNilai.grade === 'B' ? 'text-blue-700' :
                hasilNilai.grade === 'C' ? 'text-yellow-700' :
                'text-red-700'
              }`}>{hasilNilai.grade}</div>
              <div className="text-xs text-slate-400 mt-1">Grade</div>
            </div>
            <div className="bg-slate-50 rounded-xl p-4">
              <div className="text-3xl font-bold text-slate-900">{hasilNilai.benar}/{hasilNilai.total}</div>
              <div className="text-xs text-slate-400 mt-1">Benar</div>
            </div>
          </div>

          <button onClick={() => window.location.href = '/siswa'} className="btn-primary w-full justify-center">
            Kembali ke Beranda
          </button>

          {hasilNilai.id && (
            <button
              onClick={() => window.location.href = `/siswa/nilai/${hasilNilai.id}`}
              className="btn-secondary w-full justify-center mt-3"
            >
              Yuk, Lihat Rincian Per Soal 😊
            </button>
          )}
        </div>
      </div>
    )
  }

  // ── Phase: UJIAN ──────────────────────────────────────────────────────────
  if (!soalCurrent) return <div className="flex justify-center py-20"><Spinner size="lg" /></div>

  const opsiUjian = opsiLabels.slice(0, soalCurrent.jumlah_opsi)

  return (
    <>
      {/* Overlay peringatan saat keluar fullscreen / pindah tab */}
      {showWarningOverlay && (
        <div
          className="fixed inset-0 z-[9999] flex flex-col items-center justify-center"
          style={{ background: 'rgba(15,23,42,0.97)' }}
        >
          <div className="max-w-sm w-full mx-4 bg-white rounded-2xl p-8 text-center shadow-2xl">
            <div className="w-16 h-16 bg-red-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <AlertTriangle className="w-8 h-8 text-red-600" />
            </div>
            <h2 className="text-lg font-bold text-slate-900 mb-2">Pelanggaran Terdeteksi!</h2>
            <p className="text-sm text-slate-600 mb-1">{warningMsg}</p>
            <p className="text-xs text-red-500 font-medium mb-4">
              Pelanggaran ke-{pelanggRef.current} — Aktivitas ini dilaporkan ke pengawas
            </p>
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-4 text-left">
              <p className="text-xs text-amber-700 font-semibold mb-1">⚠ Diperlukan Kode dari Pengawas</p>
              <p className="text-xs text-amber-600">Hubungi pengawas dan minta kode 7 digit untuk melanjutkan ujian.</p>
            </div>
            {kodeResetError && (
              <div className="alert-error mb-3 text-left text-xs flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                <span>{kodeResetError}</span>
              </div>
            )}
            <input
              type="text"
              className="input text-center text-xl font-mono tracking-widest uppercase mb-3"
              placeholder="KODE RESET"
              maxLength={7}
              value={kodeReset}
              onChange={e => { setKodeReset(e.target.value.toUpperCase()); setKodeResetError('') }}
              onKeyDown={e => e.key === 'Enter' && handleVerifikasiResetDariOverlay()}
            />
            <button
              onClick={handleVerifikasiResetDariOverlay}
              disabled={kodeResetLoading}
              className="btn-primary w-full justify-center py-3 text-base"
            >
              {kodeResetLoading ? <Spinner size="sm" /> : (
                <>
                  <KeyRound className="w-4 h-4" />
                  Masukkan Kode &amp; Lanjutkan Ujian
                </>
              )}
            </button>
          </div>
        </div>
      )}

      {sesiDitutupPaksa && phase === 'UJIAN' && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl max-w-sm w-full p-6 text-center animate-fade-in">
            <div className="w-12 h-12 rounded-full bg-amber-100 flex items-center justify-center mx-auto mb-4">
              <AlertTriangle className="w-6 h-6 text-amber-600" />
            </div>
            <h3 className="text-lg font-bold text-slate-900 mb-2">Sesi Ditutup Pengawas</h3>
            <p className="text-sm text-slate-500">
              Pengawas telah menutup sesi ujian ini. Jawaban Anda yang sudah tersimpan sedang dinilai, mohon tunggu sebentar...
            </p>
          </div>
        </div>
      )}

      <div className="max-w-3xl mx-auto space-y-4 animate-fade-in select-none">
        {/* Header */}
        <div className="card py-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex-1 min-w-0">
              <div className="font-semibold text-slate-900 text-sm truncate">{sesiInfo?.namaMapel}</div>
              <div className={`text-xs font-medium ${
                totalDijawab === soalList.length
                  ? 'text-emerald-600'
                  : totalDijawab === 0
                  ? 'text-slate-400'
                  : 'text-amber-500'
              }`}>
                {totalDijawab}/{soalList.length} terjawab
                {totalDijawab < soalList.length && (
                  <span className="ml-1">· {soalList.length - totalDijawab} belum</span>
                )}
              </div>
            </div>
            <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl font-mono font-bold text-base flex-shrink-0 ${
              sisaWaktu < 300 ? 'bg-red-50 text-red-600' :
              sisaWaktu < 600 ? 'bg-amber-50 text-amber-600' :
              'bg-brand-50 text-brand-700'
            }`}>
              <Clock className="w-3.5 h-3.5" />
              {formatWaktu(sisaWaktu)}
            </div>
            <button
              onClick={() => {
                const minDetik = (sesiInfo?.minSubmitMenit ?? 0) * 60
                const belumCukupWaktu = minDetik > 0 && waktuTerpakai < minDetik
                if (totalDijawab < soalList.length) {
                  // Arahkan ke soal pertama yang belum dijawab
                  const idxBelum = soalList.findIndex(s => !jawaban[s.id])
                  if (idxBelum !== -1) setCurrentIdx(idxBelum)
                } else if (!belumCukupWaktu) {
                  setConfirmSelesai(true)
                }
              }}
              className={`btn-sm flex items-center gap-1.5 font-semibold transition-all flex-shrink-0 ${
                (() => {
                  const minDetik = (sesiInfo?.minSubmitMenit ?? 0) * 60
                  const belumCukupWaktu = minDetik > 0 && waktuTerpakai < minDetik
                  return (totalDijawab < soalList.length || belumCukupWaktu)
                    ? 'bg-slate-100 text-slate-400 cursor-not-allowed border border-slate-200'
                    : 'btn-success'
                })()
              }`}
              disabled={submitting || ((sesiInfo?.minSubmitMenit ?? 0) > 0 && waktuTerpakai < (sesiInfo?.minSubmitMenit ?? 0) * 60)}
              title={
                totalDijawab < soalList.length
                  ? `${soalList.length - totalDijawab} soal belum dijawab`
                  : (() => {
                      const minDetik = (sesiInfo?.minSubmitMenit ?? 0) * 60
                      const sisa = minDetik - waktuTerpakai
                      if (sisa > 0) {
                        const m = Math.floor(sisa / 60), d = sisa % 60
                        return `Tunggu ${m}:${String(d).padStart(2,'0')} lagi sebelum bisa submit`
                      }
                      return 'Selesaikan ujian'
                    })()
              }
            >
              <Send className="w-3.5 h-3.5" />
              <span className="hidden xs:inline">{submitting ? 'Menyimpan...' : 'Selesai'}</span>
              <span className="xs:hidden">{submitting ? '...' : 'Kirim'}</span>
            </button>
          </div>
          {/* Indikator countdown batas minimal submit */}
          {(() => {
            const minDetik = (sesiInfo?.minSubmitMenit ?? 0) * 60
            const sisa = minDetik - waktuTerpakai
            if (sisa <= 0) return null
            const m = Math.floor(sisa / 60), d = sisa % 60
            return (
              <div className="text-[11px] mt-1 flex items-center gap-1 text-amber-600 font-medium">
                <Clock className="w-3 h-3" />
                Submit tersedia dalam {m}:{String(d).padStart(2, '0')} menit
              </div>
            )
          })()}
          <div className={`text-[11px] mt-1.5 flex items-center gap-1 ${
            syncStatus === 'error' ? 'text-red-600 font-semibold' :
            syncStatus === 'syncing' ? 'text-amber-500' :
            syncStatus === 'synced' ? 'text-emerald-600' : 'text-slate-400'
          }`}>
            {syncStatus === 'error' && '⚠ Gagal menyimpan ke server, mencoba lagi...'}
            {syncStatus === 'syncing' && 'Menyimpan ke server...'}
            {syncStatus === 'synced' && '✓ Tersimpan di server'}
            {syncStatus === 'idle' && 'Belum ada jawaban yang disimpan'}
          </div>
        </div>

        {/* Navigator */}
        <div className="card py-3">
          <div className="flex flex-wrap gap-1.5">
            {soalList.map((s, i) => (
              <button
                key={s.id}
                onClick={() => setCurrentIdx(i)}
                className={`w-8 h-8 rounded-lg text-xs font-medium transition-all ${
                  i === currentIdx
                    ? 'bg-brand-600 text-white shadow-sm'
                    : jawaban[s.id]
                    ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                {i + 1}
              </button>
            ))}
          </div>
        </div>

        {/* Soal */}
        <div className="card">
          <div className="flex items-center gap-2 mb-4">
            <span className="badge-blue font-semibold">Soal {currentIdx + 1}</span>
            <span className="text-slate-400 text-xs">dari {soalList.length}</span>
          </div>
          <p className="text-slate-800 text-base leading-relaxed mb-4">{soalCurrent.teks}</p>
          {(soalCurrent as any).gambar_pertanyaan && (
            <div className="mb-6">
              <img
                src={(soalCurrent as any).gambar_pertanyaan}
                alt="Gambar soal"
                className="w-full max-w-lg mx-auto rounded-lg border border-slate-200 object-contain block"
                style={{ maxHeight: '320px' }}
              />
            </div>
          )}

          <div className="space-y-2">
            {opsiUjian.map(label => {
              const opsiText = soalCurrent[`opsi_${label.toLowerCase()}` as keyof Soal] as string
              const isSelected = jawaban[soalCurrent.id] === label
              return (
                <button
                  key={label}
                  onClick={() => setJawaban(prev => ({ ...prev, [soalCurrent.id]: label }))}
                  className={`soal-opsi w-full text-left ${isSelected ? 'soal-opsi-selected' : 'soal-opsi-default'}`}
                >
                  <span className={`w-7 h-7 rounded-lg text-xs font-bold flex items-center justify-center flex-shrink-0 transition-colors ${
                    isSelected ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-600'
                  }`}>
                    {label}
                  </span>
                  <span className="text-slate-800 flex flex-col gap-1">
                    {opsiText}
                    {(soalCurrent as any)[`gambar_opsi_${label.toLowerCase()}`] && (
                      <img
                        src={(soalCurrent as any)[`gambar_opsi_${label.toLowerCase()}`]}
                        alt={`Gambar opsi ${label}`}
                        className="w-full max-w-xs rounded-lg border border-slate-200 mt-1 object-contain"
                        style={{ maxHeight: '160px' }}
                      />
                    )}
                  </span>
                </button>
              )
            })}
          </div>

          {/* Navigation */}
          <div className="flex items-center justify-between mt-6 pt-4 border-t border-slate-100">
            <button
              onClick={() => setCurrentIdx(prev => Math.max(0, prev - 1))}
              disabled={currentIdx === 0}
              className="btn-secondary btn-sm disabled:opacity-40"
            >
              <ChevronLeft className="w-4 h-4" /> Sebelumnya
            </button>
            <span className="text-sm text-slate-400">{currentIdx + 1} / {soalList.length}</span>
            <button
              onClick={() => setCurrentIdx(prev => Math.min(soalList.length - 1, prev + 1))}
              disabled={currentIdx === soalList.length - 1}
              className="btn-secondary btn-sm disabled:opacity-40"
            >
              Berikutnya <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>

        <Confirm
          open={confirmSelesai}
          onClose={() => setConfirmSelesai(false)}
          onConfirm={() => handleSelesai(false)}
          title="Selesaikan Ujian?"
          message="Semua soal sudah dijawab. Apakah Anda yakin ingin menyelesaikan ujian? Jawaban tidak dapat diubah setelah diselesaikan."
          confirmLabel="Ya, Selesaikan"
          variant="primary"
          loading={submitting}
        />

        {/* ── Modal pemblokir: jumlah jawaban yang terkonfirmasi server tidak
            cocok dengan jumlah yang dijawab siswa secara lokal. Ujian TIDAK
            dinilai sampai ini terselesaikan — supaya kasus "sebagian jawaban
            tidak sampai ke server lalu terhitung salah" tidak terjadi lagi. */}
        {showSyncFailModal && (
          <div
            className="fixed inset-0 z-[9999] flex flex-col items-center justify-center p-4"
            style={{ background: 'rgba(15,23,42,0.97)' }}
          >
            <div className="max-w-sm w-full bg-white rounded-2xl p-8 text-center shadow-2xl">
              <div className="w-16 h-16 bg-amber-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
                <AlertTriangle className="w-8 h-8 text-amber-600" />
              </div>
              {sesiDitutupPaksa ? (
                <>
                  <h2 className="text-lg font-bold text-slate-900 mb-2">Sesi Ditutup Pengawas</h2>
                  <p className="text-sm text-slate-600 mb-3">
                    Pengawas menutup sesi ujian ini, dan saat itu juga koneksi gagal mengirim hasil
                    akhir ke server. Baru <strong>{syncFailInfo.synced}</strong> dari{' '}
                    <strong>{syncFailInfo.expected}</strong> jawaban yang terkonfirmasi tersimpan.
                  </p>
                  <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 mb-4 text-left">
                    <p className="text-xs text-amber-700">
                      Jawaban Anda tetap aman tersimpan sementara di perangkat ini. Tekan &quot;Coba Lagi&quot;
                      untuk mengirim ulang nilai akhir Anda. Jika masih gagal, segera hubungi pengawas atau guru.
                    </p>
                  </div>
                </>
              ) : (
                <>
                  <h2 className="text-lg font-bold text-slate-900 mb-2">Jawaban Belum Semua Tersimpan</h2>
                  <p className="text-sm text-slate-600 mb-3">
                    Koneksi ke server tidak stabil. Baru <strong>{syncFailInfo.synced}</strong> dari{' '}
                    <strong>{syncFailInfo.expected}</strong> jawaban yang terkonfirmasi tersimpan.
                    Ujian <strong>belum akan dinilai</strong> sampai semua jawaban berhasil tersimpan,
                    supaya jawaban Anda tidak ada yang terhitung salah secara tidak adil.
                  </p>
                  <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 mb-4 text-left">
                    <p className="text-xs text-amber-700">
                      Jawaban Anda tetap aman tersimpan sementara di perangkat ini. Coba periksa koneksi
                      internet, lalu tekan &quot;Coba Lagi&quot;. Anda juga bisa kembali menjawab dulu —
                      sistem akan terus mencoba menyimpan otomatis di latar belakang.
                    </p>
                  </div>
                </>
              )}
              <div className="flex gap-2">
                <button
                  onClick={handleKembaliDariSyncFail}
                  className="btn-secondary flex-1"
                  disabled={manualRetrying}
                >
                  Kembali ke Ujian
                </button>
                <button
                  onClick={handleRetrySelesai}
                  className="btn-primary flex-1 flex items-center justify-center gap-2"
                  disabled={manualRetrying}
                >
                  {manualRetrying ? <Spinner size="sm" /> : 'Coba Lagi'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  )
}
