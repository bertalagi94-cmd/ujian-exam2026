// src/hooks/useMonitorRealtime.ts
// Hook ini menggantikan setInterval polling di halaman pengawas.
// Pakai websocket Supabase Realtime — push dari server, bukan pull dari client.

import { useEffect, useRef } from 'react'
import { supabase } from '@/lib/supabase'

interface SiswaUjianPayload {
  sesi_id: string
  nis: string
  status: string
  waktu_selesai: string | null
}

interface PelanggaranPayload {
  id: string
  sesi_id: string
  nis: string
  jenis: string
  level: number
  detail: string
  created_at: string
}

interface UseMonitorRealtimeOptions {
  sesiIds: string[]                                   // sesi yang dipantau
  onSiswaChange: (sesiId: string) => void            // callback: minta refresh data siswa
  onPelanggaran: (payload: PelanggaranPayload) => void  // callback: ada pelanggaran baru
}

export function useMonitorRealtime({
  sesiIds,
  onSiswaChange,
  onPelanggaran,
}: UseMonitorRealtimeOptions) {
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null)

  useEffect(() => {
    // Tidak ada sesi aktif = tidak perlu subscribe
    if (!sesiIds.length) return

    // Bersihkan channel lama jika sesiIds berubah
    if (channelRef.current) {
      supabase.removeChannel(channelRef.current)
    }

    const channel = supabase
      .channel('monitor-ujian')
      // Pantau perubahan status siswa (masuk, selesai, reset, dikunci)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'siswa_ujian',
          // Filter: hanya sesi yang kita pantau
          filter: `sesi_id=in.(${sesiIds.join(',')})`,
        },
        (payload) => {
          const data = payload.new as SiswaUjianPayload
          if (data?.sesi_id) onSiswaChange(data.sesi_id)
        }
      )
      // Pantau pelanggaran baru
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'pelanggaran',
          filter: `sesi_id=in.(${sesiIds.join(',')})`,
        },
        (payload) => {
          const data = payload.new as PelanggaranPayload
          if (data) onPelanggaran(data)
        }
      )
      .subscribe()

    channelRef.current = channel

    // Cleanup saat unmount atau sesiIds berubah
    return () => {
      supabase.removeChannel(channel)
    }
  }, [sesiIds.join(',')]) // eslint-disable-line react-hooks/exhaustive-deps
}
