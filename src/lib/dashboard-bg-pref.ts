'use client'

import { useCallback, useEffect, useState } from 'react'

// Preferensi "latar kaca transparan" (foto siswa diburamkan) di dashboard
// admin/guru/kepsek/siswa — mirip efek glass di form login. Disimpan di
// localStorage supaya konsisten di semua halaman & tab browser yang sama,
// dan default AKTIF supaya efeknya langsung terlihat tanpa perlu di-setel
// dulu oleh pengguna. Guru/admin/kepsek/siswa yang tidak suka bisa
// mematikannya lewat saklar <TransparentBgToggle /> di halaman Beranda.
const STORAGE_KEY = 'dashboardTransparentBg'
// Event custom supaya perubahan langsung sinkron ke komponen lain yang
// aktif di TAB YANG SAMA juga (event 'storage' bawaan browser cuma nyala
// di tab lain, bukan di tab yang melakukan perubahan).
const LOCAL_EVENT = 'dashboard-bg-pref-changed'

function readPref(): boolean {
  if (typeof window === 'undefined') return true
  const raw = window.localStorage.getItem(STORAGE_KEY)
  // Belum pernah diatur sama sekali -> default aktif.
  return raw === null ? true : raw === '1'
}

/**
 * Hook: [enabled, setEnabled]
 * - enabled: true = tampilkan latar foto siswa buram (kaca) di dashboard
 * - setEnabled: ubah preferensi, tersimpan & tersinkron ke semua
 *   halaman/tab yang memakai hook ini.
 */
export function useDashboardBgPref(): [boolean, (value: boolean) => void] {
  // Default true dulu (server render / awal mount) supaya tidak ada
  // "kedipan" dari transparan -> polos saat localStorage baru dibaca.
  const [enabled, setEnabledState] = useState(true)

  useEffect(() => {
    setEnabledState(readPref())
    const sync = () => setEnabledState(readPref())
    window.addEventListener('storage', sync)
    window.addEventListener(LOCAL_EVENT, sync)
    return () => {
      window.removeEventListener('storage', sync)
      window.removeEventListener(LOCAL_EVENT, sync)
    }
  }, [])

  const setEnabled = useCallback((value: boolean) => {
    window.localStorage.setItem(STORAGE_KEY, value ? '1' : '0')
    setEnabledState(value)
    window.dispatchEvent(new Event(LOCAL_EVENT))
  }, [])

  return [enabled, setEnabled]
}
