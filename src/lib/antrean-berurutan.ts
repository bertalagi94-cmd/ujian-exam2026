// src/lib/antrean-berurutan.ts
//
// SATU antrean offline per siswa yang menggabungkan event pelanggaran dan
// reset offline (R1..R3), dikirim satu per satu menurut waktu kejadian asli
// (dibuatIso): V1, R1, V2, R2, V3, R3, V4 ...
//
// KENAPA: server (catat_pelanggaran_atomik) membuang pelanggaran yang tiba
// saat status siswa masih RESET (balasan MENUNGGU_RESET), dan menolak R(N)
// kalau pelanggaran #N belum tercatat. Dua antrean terpisah dengan timer
// masing-masing membuat urutan tiba di server tidak terjamin, sehingga
// pelanggaran bisa terbuang dan siswa tidak pernah TERKUNCI.
//
// ATURAN: berhenti di entri pertama yang gagal SEMENTARA (jangan melompat);
// lewati entri yang ditolak PERMANEN (GAGAL) supaya tidak menyumbat antrean.

import {
  ambilSemuaPelanggaranTertunda,
  kirimSatuPelanggaranBerurutan,
  type PelanggaranTertunda,
} from '@/lib/pelanggaran-outbox'
import {
  ambilSemuaResetTertunda,
  kirimSatuReset,
  sedangDikirim,
  type ResetTertunda,
} from '@/lib/reset-offline-client'
import { EVENT_PICU_ANTREAN } from '@/lib/antrean-kunci'

type EntriGabungan =
  | { tipe: 'PELANGGARAN'; waktu: string; entri: PelanggaranTertunda }
  | { tipe: 'RESET'; waktu: string; entri: ResetTertunda }

/** Gabungan entri belum selesai milik satu siswa, urut waktu kejadian. Pada waktu sama, pelanggaran lebih dulu dari reset. */
export async function ambilAntreanGabungan(nis: string, sesiId?: string): Promise<EntriGabungan[]> {
  const [pel, rst] = await Promise.all([
    ambilSemuaPelanggaranTertunda(nis),
    ambilSemuaResetTertunda(nis, sesiId),
  ])
  const semua: EntriGabungan[] = [
    ...pel.filter(e => !sesiId || e.sesiId === sesiId).map(e => ({ tipe: 'PELANGGARAN' as const, waktu: e.dibuatIso, entri: e })),
    ...rst.map(e => ({ tipe: 'RESET' as const, waktu: e.dibuatIso, entri: e })),
  ]
  return semua.sort((a, b) => {
    const c = a.waktu.localeCompare(b.waktu)
    if (c !== 0) return c
    if (a.tipe !== b.tipe) return a.tipe === 'PELANGGARAN' ? -1 : 1
    return 0
  })
}

let sedangFlush = false
let penjagaTerpasang = false

/** Satu putaran: kirim berurutan sampai habis atau sampai ada kegagalan sementara. */
export async function flushAntreanBerurutan(nis: string): Promise<void> {
  if (sedangFlush) return
  sedangFlush = true
  try {
    for (const item of await ambilAntreanGabungan(nis)) {
      if (item.entri.status === 'GAGAL') continue
      // Masih dikirim (mis. tab lain) -> jangan dobel kirim, dan jangan
      // melompat ke entri berikutnya supaya urutan terjaga.
      if (sedangDikirim(item.entri)) break

      if (item.tipe === 'PELANGGARAN') {
        const r = await kirimSatuPelanggaranBerurutan(item.entri)
        if (r.hasil === 'ULANG') break
      } else {
        // true = sukses atau ditolak permanen (aman lanjut); false = ulangi nanti.
        const lanjut = await kirimSatuReset(item.entri)
        if (!lanjut) break
      }
    }
  } finally {
    sedangFlush = false
  }
}

/**
 * Pengganti mulaiPenjagaPelanggaran + mulaiPenjagaResetOffline. Pasang SEKALI
 * di siswa/layout.tsx. Hanya memproses entri milik `nis` yang sedang login.
 */
export function mulaiPenjagaAntreanBerurutan(nis: string): () => void {
  if (penjagaTerpasang) return () => {}
  penjagaTerpasang = true

  const jalan = () => void flushAntreanBerurutan(nis)
  jalan()
  const interval = setInterval(jalan, 15_000)
  window.addEventListener('online', jalan)
  window.addEventListener(EVENT_PICU_ANTREAN, jalan)

  return () => {
    clearInterval(interval)
    window.removeEventListener('online', jalan)
    window.removeEventListener(EVENT_PICU_ANTREAN, jalan)
    penjagaTerpasang = false
  }
}
