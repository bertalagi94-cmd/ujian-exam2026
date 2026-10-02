'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { isNativeApp } from '@/lib/exam-lock'
import { cariPaketPgOfflineTerbaru } from '@/lib/pg-paket-offline'

// Halaman awal "/".
//
// Dulu: redirect('/login') di server (HTTP 307). Itu bermasalah untuk APK
// Android, yang SELALU membuka "/" saat dijalankan:
//   1. Redirect server tidak pernah masuk cache Service Worker, jadi buka
//      aplikasi saat offline = gagal total ("tidak ada akses internet").
//   2. Halaman /login tidak punya auto-redirect untuk yang sudah login, dan
//      login butuh internet, jadi siswa yang aplikasinya tertutup di tengah
//      ujian tidak bisa kembali ke ujiannya saat offline.
//
// Sekarang "/" adalah halaman statis biasa (ikut di-precache, lihat
// scripts/generate-precache-manifest.js) yang memilih tujuan di sisi client.
//
// PENTING: perilaku pintar ini HANYA berlaku di APK Android. Di browser biasa
// perilakunya sama seperti sebelumnya: selalu ke /login.
const RUTE_ROLE: Record<string, string> = {
  ADMIN: '/admin',
  GURU: '/guru',
  KEPSEK: '/kepsek',
  SISWA: '/siswa',
}

export default function RootPage() {
  const router = useRouter()

  useEffect(() => {
    let tujuan = '/login'
    try {
      if (isNativeApp()) {
        const token = localStorage.getItem('token')
        const raw = localStorage.getItem('user')
        const user = raw ? JSON.parse(raw) : null
        if (token && user?.role && RUTE_ROLE[user.role]) {
          tujuan = RUTE_ROLE[user.role]
          if (user.role === 'SISWA') {
            // Offline, atau masih ada paket ujian tersimpan di perangkat:
            // langsung ke halaman ujian supaya pemulihan ujian (timer,
            // jawaban, antrean pelanggaran) berjalan tanpa perlu login ulang.
            const offline = typeof navigator !== 'undefined' && navigator.onLine === false
            const adaPaket = !!(user.nis && cariPaketPgOfflineTerbaru(String(user.nis)))
            if (offline || adaPaket) tujuan = '/siswa/ujian'
          }
        }
      }
    } catch {
      // Storage tidak terbaca / data korup: aman jatuh ke halaman login.
    }
    router.replace(tujuan)
  }, [router])

  return null
}
