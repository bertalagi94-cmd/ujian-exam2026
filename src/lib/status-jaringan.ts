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
import { registerServerDate, ambilKontakServerTerakhirMs } from '@/lib/clock-offset'

export type StatusJaringan = 'ONLINE' | 'CHECKING' | 'OFFLINE'

// HEMAT VERCEL: tiap denyut = 1 invocation fungsi Vercel per siswa. Dulu 5 dtk
// (12x/menit/siswa); sekarang 20 dtk, dan dilewati sama sekali kalau request
// lain (cek-sesi/sync) baru berhasil dalam KONTAK_SEGAR_MS terakhir.
// Begitu ada 1 kegagalan, status jadi CHECKING dan denyut langsung rapat 3 dtk,
// jadi deteksi putus jaringan tetap cepat.
//
// KONTAK_SEGAR_MS HARUS lebih besar dari jeda cek-sesi di halaman ujian
// (JEDA_CEK_SESI_MS = 30 dtk di src/app/siswa/ujian/page.tsx) ditambah waktu
// request. Dengan 35 dtk, cek-sesi (yang selalu sukses selama server terjangkau)
// sudah menjadi bukti keterjangkauan, dan /health praktis hanya terkirim bila
// cek-sesi/sync gagal atau tertunda. Kalau jeda cek-sesi dinaikkan lagi, naikkan
// juga nilai ini, atau denyut /health malah jadi LEBIH sering (bukan lebih jarang).
// Kegagalan jaringan pada cek-sesi/sync memicu periksaJaringanSekarang() di bawah,
// jadi deteksi putus jaringan tidak menunggu denyut berikutnya.
const INTERVAL_ONLINE_MS = 20_000
// MODE HEMAT DARURAT: jeda cek-sesi 60 dtk -> ambang ini WAJIB di atasnya (60 dtk +
// waktu request). Dulu 35_000 untuk jeda 30 dtk.
const KONTAK_SEGAR_MS = 75_000
// Jarak minimum antar pemeriksaan paksa (mis. loop retry sync tidak membanjiri /health).
const JEDA_MIN_PERIKSA_PAKSA_MS = 2_000
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

async function siklus(paksa = false): Promise<void> {
  if (sedangPing) return
  // Sudah ONLINE dan server baru menjawab request lain: bukti keterjangkauan
  // sudah ada, lewati denyut ini (hemat 1 invocation Vercel). Pemeriksaan paksa
  // (request lain baru GAGAL karena jaringan) tidak boleh dilewati.
  if (!paksa && status === 'ONLINE' && Date.now() - ambilKontakServerTerakhirMs() < KONTAK_SEGAR_MS) return
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

let terakhirPeriksaPaksaMs = 0

/**
 * Periksa keterjangkauan server SEKARANG, tanpa menunggu denyut berikutnya dan
 * tanpa dilewati oleh "kontak segar". Dipanggil saat request lain (cek-sesi,
 * sync) gagal karena jaringan (tanpa status HTTP, atau 5xx): karena /health
 * tidak lagi dikirim tiap beberapa detik selama cek-sesi berhasil, kegagalan
 * itulah yang harus memicu deteksi putus jaringan. Aman dipanggil berkali-kali
 * (dibatasi satu pemeriksaan berjalan + jarak minimum 2 dtk). Tidak berbuat
 * apa-apa kalau pemantau belum dipasang.
 */
export function periksaJaringanSekarang(): void {
  if (typeof window === 'undefined' || refCount === 0 || sedangPing) return
  const sekarang = Date.now()
  if (sekarang - terakhirPeriksaPaksaMs < JEDA_MIN_PERIKSA_PAKSA_MS) return
  terakhirPeriksaPaksaMs = sekarang
  void siklus(true).then(() => {
    // Susun ulang jadwal sesuai status terbaru: kalau pemeriksaan ini gagal,
    // denyut berikutnya rapat 3 dtk (butuh 2 kegagalan berturut-turut untuk OFFLINE),
    // bukan menunggu sisa jeda 20 dtk dari jadwal lama.
    if (refCount > 0) jadwalkan()
  })
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
