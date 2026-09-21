// Pemantau jaringan berbasis KETERJANGKAUAN SERVER (bukan navigator.onLine).
//
//   ONLINE   : denyut terakhir ke /api/siswa/ujian/health berhasil.
//   CHECKING : baru mulai / baru gagal SEKALI (belum cukup bukti offline).
//   OFFLINE  : gagal berturut-turut, atau browser melaporkan event 'offline'.
//
// Anti-berkedip: butuh 2 kegagalan berturut-turut sebelum dinyatakan OFFLINE
// (satu paket hilang tidak boleh membuat UI melompat), tetapi SATU keberhasilan
// langsung ONLINE. Saat OFFLINE denyut lebih rapat supaya pemulihan cepat
// terdeteksi. Satu pemantau bersama (ref-counted) untuk seluruh aplikasi.
import { useSyncExternalStore } from 'react'
import { registerServerDate } from '@/lib/clock-offset'

export type StatusJaringan = 'ONLINE' | 'CHECKING' | 'OFFLINE'

const INTERVAL_ONLINE_MS = 5_000
const INTERVAL_OFFLINE_MS = 3_000
const TIMEOUT_PING_MS = 3_000
const GAGAL_UNTUK_OFFLINE = 2
const URL_HEALTH = '/api/siswa/ujian/health'

let status: StatusJaringan = 'CHECKING'
let gagalBerturut = 0
let sedangPing = false
let refCount = 0
let timer: ReturnType<typeof setTimeout> | null = null
const pendengar = new Set<(s: StatusJaringan) => void>()

function setStatus(s: StatusJaringan): void {
  if (s === status) return
  status = s
  pendengar.forEach(fn => { try { fn(s) } catch { /* pendengar rusak tidak boleh mematikan pemantau */ } })
}

async function pingServer(): Promise<boolean> {
  const controller = new AbortController()
  const t = setTimeout(() => controller.abort(), TIMEOUT_PING_MS)
  try {
    const res = await fetch(`${URL_HEALTH}?t=${Date.now()}`, { cache: 'no-store', signal: controller.signal })
    if (!res.ok) return false
    registerServerDate(res.headers.get('date'))
    return true
  } catch {
    return false
  } finally {
    clearTimeout(t)
  }
}

async function siklus(): Promise<void> {
  if (sedangPing) return
  sedangPing = true
  try {
    if (await pingServer()) {
      gagalBerturut = 0
      setStatus('ONLINE')
    } else {
      gagalBerturut++
      setStatus(gagalBerturut >= GAGAL_UNTUK_OFFLINE ? 'OFFLINE' : 'CHECKING')
    }
  } finally {
    sedangPing = false
  }
}

function jadwalkan(): void {
  if (timer) clearTimeout(timer)
  timer = setTimeout(async () => {
    await siklus()
    if (refCount > 0) jadwalkan()
  }, status === 'ONLINE' ? INTERVAL_ONLINE_MS : INTERVAL_OFFLINE_MS)
}

// Event browser 'offline' = tidak ada antarmuka jaringan sama sekali: bukti
// kuat, langsung OFFLINE tanpa menunggu dua denyut gagal. Event 'online' hanya
// petunjuk: tetap diverifikasi ke server dulu.
const onBrowserOffline = () => { gagalBerturut = GAGAL_UNTUK_OFFLINE; setStatus('OFFLINE') }
const onBrowserOnline = () => { setStatus('CHECKING'); void siklus() }

/** Mulai memantau. Dipanggil banyak kali aman (ref-counted). Kembalikan fungsi berhenti. */
export function mulaiPemantauJaringan(): () => void {
  if (typeof window === 'undefined') return () => {}
  refCount++
  if (refCount === 1) {
    window.addEventListener('offline', onBrowserOffline)
    window.addEventListener('online', onBrowserOnline)
    void siklus()
    jadwalkan()
  }
  let sudahBerhenti = false
  return () => {
    if (sudahBerhenti) return
    sudahBerhenti = true
    refCount--
    if (refCount === 0) {
      window.removeEventListener('offline', onBrowserOffline)
      window.removeEventListener('online', onBrowserOnline)
      if (timer) { clearTimeout(timer); timer = null }
      status = 'CHECKING'
      gagalBerturut = 0
    }
  }
}

export function ambilStatusJaringan(): StatusJaringan {
  return status
}

/** Berlangganan perubahan status. Kembalikan fungsi berhenti. */
export function berlanggananStatusJaringan(fn: (s: StatusJaringan) => void): () => void {
  pendengar.add(fn)
  return () => { pendengar.delete(fn) }
}

/** Hook React: status jaringan terkini. */
export function useStatusJaringan(): StatusJaringan {
  return useSyncExternalStore(
    berlanggananStatusJaringan,
    ambilStatusJaringan,
    () => 'CHECKING' as StatusJaringan
  )
}
