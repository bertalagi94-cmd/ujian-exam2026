'use client'

import { useCallback, useEffect, useState } from 'react'

// Preferensi "sembunyikan menu sidebar" khusus tampilan desktop/laptop
// (menu mobile tetap pakai drawer terpisah, tidak terpengaruh ini).
// Disimpan di localStorage supaya tetap tersembunyi/tampil walau pindah
// halaman atau ganti tab, dan default TAMPIL (false) supaya menu tidak
// tiba-tiba hilang untuk pengguna yang belum pernah mengatur ini.
const STORAGE_KEY = 'sidebarCollapsed'
const LOCAL_EVENT = 'sidebar-collapsed-changed'

function readPref(): boolean {
  if (typeof window === 'undefined') return false
  return window.localStorage.getItem(STORAGE_KEY) === '1'
}

/**
 * Hook: [collapsed, setCollapsed]
 * - collapsed: true = sidebar desktop disembunyikan (halaman jadi lebih lebar)
 * - setCollapsed: ubah preferensi, tersimpan & tersinkron ke semua
 *   halaman/tab yang memakai hook ini.
 */
export function useSidebarCollapsedPref(): [boolean, (value: boolean) => void] {
  const [collapsed, setCollapsedState] = useState(false)

  useEffect(() => {
    setCollapsedState(readPref())
    const sync = () => setCollapsedState(readPref())
    window.addEventListener('storage', sync)
    window.addEventListener(LOCAL_EVENT, sync)
    return () => {
      window.removeEventListener('storage', sync)
      window.removeEventListener(LOCAL_EVENT, sync)
    }
  }, [])

  const setCollapsed = useCallback((value: boolean) => {
    window.localStorage.setItem(STORAGE_KEY, value ? '1' : '0')
    setCollapsedState(value)
    window.dispatchEvent(new Event(LOCAL_EVENT))
  }, [])

  return [collapsed, setCollapsed]
}
