'use client'

import { useEffect, useState } from 'react'
import {
  mulaiPemantauJaringan,
  berlanggananStatusJaringan,
} from '@/lib/status-jaringan'

// Penanda kecil "Mode Offline" di bagian ATAS SEMUA halaman (siswa, guru,
// admin, login). Dipasang sekali di root layout (src/app/layout.tsx).
//
//  - Offline : label merah "Mode Offline".
//  - Online lagi : label berubah otomatis jadi hijau "Online", tampil
//    DURASI_ONLINE_MS lalu hilang sendiri.
//  - Normal (online dan tidak ada kejadian offline): tidak tampil apa pun.
//
// TIDAK MENGGESER LAYOUT: elemen `fixed`, kecil, dan `pointer-events-none`
// (tidak menghalangi klik). Tidak ikut alur dokumen, jadi menu/info/tombol
// di bawahnya tidak bergeser sedikit pun, di HP maupun laptop.
//
// Sumber status = pemantau jaringan yang sama dengan StatusJaringanBar di
// halaman ujian (src/lib/status-jaringan.ts: ping nyata ke server, bukan cuma
// navigator.onLine), jadi "WiFi tersambung tapi tanpa internet" juga terdeteksi.
//
// HEMAT SERVER: pemantau dinyalakan sebentar saat aplikasi dibuka (1 ping),
// lalu DIMATIKAN lagi begitu terbukti online. Ia baru menyala terus ketika
// ada tanda offline, dan dimatikan lagi setelah online kembali. Di halaman
// ujian, StatusJaringanBar sudah memantau terus; pemantau dipakai bersama
// (ref-count), jadi tidak ada ping dobel.
const DURASI_ONLINE_MS = 4000

type Tampil = 'offline' | 'online' | null

export function StatusModeOffline() {
  const [tampil, setTampil] = useState<Tampil>(null)

  useEffect(() => {
    let pernahOffline = false
    let hentikanPantau: (() => void) | null = null
    let timerHijau: ReturnType<typeof setTimeout> | null = null

    const nyalakanPantau = () => {
      if (!hentikanPantau) hentikanPantau = mulaiPemantauJaringan()
    }
    const matikanPantau = () => {
      if (hentikanPantau) {
        hentikanPantau()
        hentikanPantau = null
      }
    }

    const tandaiOffline = () => {
      pernahOffline = true
      if (timerHijau) { clearTimeout(timerHijau); timerHijau = null }
      setTampil('offline')
      nyalakanPantau() // pastikan terus dipantau sampai online kembali
    }

    // 'CHECKING' (sedang memeriksa) sengaja diabaikan supaya label tidak
    // berkedip; yang dipakai hanya hasil pasti: OFFLINE atau ONLINE.
    const berhentiLangganan = berlanggananStatusJaringan((s) => {
      if (s === 'OFFLINE') {
        tandaiOffline()
      } else if (s === 'ONLINE') {
        if (pernahOffline) {
          pernahOffline = false
          setTampil('online')
          if (timerHijau) clearTimeout(timerHijau)
          timerHijau = setTimeout(() => setTampil(null), DURASI_ONLINE_MS)
        }
        matikanPantau() // online: tidak perlu memantau terus
      }
    })

    window.addEventListener('offline', tandaiOffline)

    // Pemeriksaan awal saat aplikasi dibuka.
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      tandaiOffline() // langsung tampil, tanpa menunggu ping
    } else {
      nyalakanPantau() // 1 ping; kalau online, otomatis dimatikan lagi
    }

    return () => {
      window.removeEventListener('offline', tandaiOffline)
      berhentiLangganan()
      matikanPantau()
      if (timerHijau) clearTimeout(timerHijau)
    }
  }, [])

  if (!tampil) return null

  const offline = tampil === 'offline'

  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 top-0 z-[9000] flex justify-center print:hidden"
      style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}
    >
      <div
        className={`inline-flex items-center gap-1.5 rounded-b-md px-2.5 text-[11px] font-semibold leading-[18px] text-white shadow-sm ${
          offline ? 'bg-red-600' : 'bg-emerald-600'
        }`}
      >
        <span
          className={`inline-block h-1.5 w-1.5 flex-shrink-0 rounded-full ${
            offline ? 'bg-red-200 animate-pulse' : 'bg-emerald-200'
          }`}
        />
        <span>{offline ? 'Mode Offline' : 'Online'}</span>
      </div>
    </div>
  )
}
