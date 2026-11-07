// src/lib/layar-pantau-hub.ts
//
// ── SATU LANGGANAN REALTIME UNTUK SEMUA PENONTON ────────────────────────────
//
// Dulu setiap koneksi SSE /api/layar-pantau/stream membuka channel Realtime
// sendiri ke tabel `jawaban`, `siswa_ujian`, dan `sesi_ujian`. Setiap event
// perubahan (dari SEMUA kelas) lalu diterima dan diurai N kali di satu
// instance server, sekali untuk tiap penonton -- CPU naik sebanding dengan
// jumlah penonton x jumlah jawaban yang masuk.
//
// Sekarang satu instance server hanya membuka SATU channel. Event dibagikan ke
// semua penonton lewat daftar pendengar di bawah, dan papan sesi terkait
// ditandai "kotor" sekali saja (lihat leaderboard-live.ts).
//
// - Channel dibuka saat penonton pertama datang dan ditutup 5 detik setelah
//   penonton terakhir pergi (jeda ini mencegah buka-tutup berulang saat
//   EventSource menyambung ulang tiap ~55 detik).
// - Penyaringan event per yayasan/sesi tetap dilakukan oleh masing-masing
//   penonton (stream/route.ts), karena daftar sesi yang boleh dilihat berbeda
//   per akun.
// - Payload mentah TIDAK pernah dikirim ke browser; hanya dipakai di server
//   untuk memicu penghitungan ulang papan agregat.

import type { RealtimeChannel } from '@supabase/supabase-js'
import { createAdminClient } from '@/lib/supabase'
import { tandaiBoardKotor, tandaiSemuaBoardKotor } from '@/lib/leaderboard-live'

export type TabelPantau = 'jawaban' | 'siswa_ujian' | 'sesi_ujian'
export type StatusRealtime = 'tersambung' | 'terputus'

export interface PendengarPantau {
  onEvent: (tabel: TabelPantau, payload: any) => void
  onStatus?: (status: StatusRealtime) => void
}

const JEDA_TUTUP_MS = 5000

const pendengar = new Set<PendengarPantau>()
let channel: RealtimeChannel | null = null
let statusTerakhir: StatusRealtime | null = null
let timerTutup: ReturnType<typeof setTimeout> | null = null

function sesiIdDariEvent(tabel: TabelPantau, payload: any): string | undefined {
  const baru = (payload?.new ?? {}) as Record<string, unknown>
  const lama = (payload?.old ?? {}) as Record<string, unknown>
  const id = tabel === 'sesi_ujian' ? (baru.id ?? lama.id) : (baru.sesi_id ?? lama.sesi_id)
  return typeof id === 'string' ? id : undefined
}

function tangani(tabel: TabelPantau, payload: any): void {
  const sesiId = sesiIdDariEvent(tabel, payload)
  if (sesiId) tandaiBoardKotor(sesiId)
  // DELETE tanpa replica identity penuh tidak membawa sesi_id: tidak bisa
  // dipastikan papan mana yang terpengaruh, jadi semua dianggap kotor.
  else tandaiSemuaBoardKotor()

  for (const p of [...pendengar]) {
    try { p.onEvent(tabel, payload) } catch { /* satu penonton bermasalah tidak boleh memutus yang lain */ }
  }
}

function ubahStatus(status: StatusRealtime): void {
  statusTerakhir = status
  for (const p of [...pendengar]) {
    try { p.onStatus?.(status) } catch { /* abaikan */ }
  }
}

function buka(): void {
  if (channel) return
  const db = createAdminClient()
  channel = db
    .channel(`layar-pantau-hub-${Date.now()}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'jawaban' }, (p: any) => tangani('jawaban', p))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'sesi_ujian' }, (p: any) => tangani('sesi_ujian', p))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'siswa_ujian' }, (p: any) => tangani('siswa_ujian', p))
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') ubahStatus('tersambung')
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') ubahStatus('terputus')
    })
}

function tutup(): void {
  timerTutup = null
  if (pendengar.size > 0 || !channel) return
  const ch = channel
  channel = null
  statusTerakhir = null
  try { void createAdminClient().removeChannel(ch) } catch { /* abaikan */ }
}

/**
 * Daftarkan pendengar. Mengembalikan fungsi untuk berhenti (aman dipanggil
 * berkali-kali).
 */
export function langgan(p: PendengarPantau): () => void {
  pendengar.add(p)
  if (timerTutup) { clearTimeout(timerTutup); timerTutup = null }
  buka()
  // Pendengar baru langsung tahu status koneksi yang sudah ada.
  if (statusTerakhir) {
    try { p.onStatus?.(statusTerakhir) } catch { /* abaikan */ }
  }

  let aktif = true
  return () => {
    if (!aktif) return
    aktif = false
    pendengar.delete(p)
    if (pendengar.size === 0 && !timerTutup) {
      timerTutup = setTimeout(tutup, JEDA_TUTUP_MS)
    }
  }
}
