'use client'

// Mendaftarkan Service Worker app-shell (lihat public/sw.js — BUG P1 #9).
// Dirender sekali di root layout supaya berlaku di seluruh aplikasi (siswa,
// guru, admin) — pendaftaran SW sendiri tidak berbahaya untuk halaman
// non-ujian, dan justru bermanfaat kalau siswa membuka beberapa halaman
// siswa lain sebelum masuk ke ujian (chunk-nya ikut ter-cache lebih awal).
//
// Kegagalan registrasi (browser lama, mode privat ketat, dsb) SENGAJA
// dibiarkan diam — ini murni peningkatan resiliensi offline, BUKAN syarat
// aplikasi bisa jalan; tidak boleh memunculkan error yang mengganggu siswa.
import { useEffect } from 'react'

export function ServiceWorkerRegister() {
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (!('serviceWorker' in navigator)) return
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // Lihat catatan di atas — kegagalan registrasi bukan blocker.
    })
  }, [])
  return null
}
