// src/lib/reset-berurutan.ts
//
// SISI SERVER untuk sistem reset pelanggaran berurutan R1 / R2 / R3.
// JANGAN di-import dari komponen client — file ini memakai node:crypto dan
// memegang rahasia server.
//
// ── DESAIN ──────────────────────────────────────────────────────────────────
// Kode reset ke-N untuk siswa X di sesi S diturunkan deterministik:
//     kode = HMAC-SHA256(rahasiaServer, ["reset-pelanggaran", S, X, N])  → 7 karakter
//
// Konsekuensinya (sama dengan kode darurat Essay, lihat essay-amplop-server.ts):
//   + TIDAK ADA kode yang tersimpan di database → tidak bisa bocor lewat dump
//     DB, backup, atau salah konfigurasi RLS.
//   + Kode "sudah ada" sejak sesi dibuka; pengawas bisa mengambil R1/R2/R3 semua
//     siswa sekali saat online lalu menyimpannya untuk dipakai offline.
//   + Siswa tidak bisa menebak kode siswa lain: rahasia hanya ada di server.
//   + Tidak memakai Math.random() sama sekali.
//   - Kode tidak bisa dirotasi per sesi. Jangan mengganti rahasia saat ada
//     ujian berlangsung (kode yang sudah dibagikan ke pengawas jadi tidak
//     cocok lagi).
//
// Urutan (R1 sebelum R2 sebelum R3) dan sekali-pakai TIDAK dijaga di sini,
// melainkan oleh penghitung siswa_ujian.reset_terpakai di dalam transaksi
// database (lihat supabase/24_reset_berurutan.sql).
//
// Rahasia: RESET_PELANGGARAN_SECRET (disarankan diset sendiri di env). Kalau
// tidak ada, dipakai ESSAY_DARURAT_SECRET lalu JWT_SECRET, dengan pemisahan
// domain lewat label di dalam pesan HMAC.

import { createHmac, timingSafeEqual } from 'node:crypto'
import { cachedFetch } from '@/lib/cache'
import type { createAdminClient } from '@/lib/supabase'

type DbClient = ReturnType<typeof createAdminClient>

/** Jumlah maksimum kode reset (R1..R3). Batas keras di skema SQL juga 3. */
export const MAKS_RESET_ABSOLUT = 3
export const PANJANG_KODE_RESET = 7

// 32 karakter (tanpa I, O, 0, 1 supaya tidak tertukar saat dibacakan). Karena
// 256 habis dibagi 32, memakai `byte & 31` menghasilkan sebaran yang seragam
// tanpa bias modulo.
const ALFABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

function ambilRahasia(): string {
  const raw =
    process.env.RESET_PELANGGARAN_SECRET ||
    process.env.ESSAY_DARURAT_SECRET ||
    process.env.JWT_SECRET
  if (!raw || raw.length < 16) {
    throw new Error(
      'RESET_PELANGGARAN_SECRET/ESSAY_DARURAT_SECRET/JWT_SECRET tidak diset atau terlalu pendek (minimal 16 karakter).'
    )
  }
  return raw
}

/** Kode reset ke-`nomor` (1..3) untuk siswa `nis` di sesi `sesiId`. */
export function hitungKodeReset(sesiId: string, nis: string, nomor: number): string {
  if (!Number.isInteger(nomor) || nomor < 1 || nomor > MAKS_RESET_ABSOLUT) {
    throw new Error(`nomor reset harus 1..${MAKS_RESET_ABSOLUT}`)
  }
  // JSON.stringify pada array → pemisah tak ambigu walau sesiId/nis berisi ':'.
  const mac = createHmac('sha256', ambilRahasia())
    .update(JSON.stringify(['reset-pelanggaran', sesiId, nis, nomor]))
    .digest()
  let kode = ''
  for (let i = 0; i < PANJANG_KODE_RESET; i++) kode += ALFABET[mac[i] & 31]
  return kode
}

/** R1..R`jumlah` sekaligus, untuk ditampilkan/disiapkan pengawas. */
export function hitungSemuaKodeReset(sesiId: string, nis: string, jumlah: number): string[] {
  const hasil: string[] = []
  for (let n = 1; n <= jumlah; n++) hasil.push(hitungKodeReset(sesiId, nis, n))
  return hasil
}

/** Bandingkan input siswa dengan kode ke-N, tanpa bocor lewat timing. */
export function kodeResetCocok(sesiId: string, nis: string, nomor: number, kodeInput: unknown): boolean {
  if (typeof kodeInput !== 'string') return false
  const benar = Buffer.from(hitungKodeReset(sesiId, nis, nomor), 'utf8')
  const input = Buffer.from(kodeInput.trim().toUpperCase(), 'utf8')
  if (input.length !== benar.length) return false
  return timingSafeEqual(benar, input)
}

/**
 * Jumlah kode reset yang diizinkan = pengaturan `batasPelanggaran` (default 3),
 * dijepit ke 1..3. Pelanggaran BERIKUTNYA setelah semua kode terpakai
 * menutup ujian siswa (pelanggaran ke-4 bila batas = 3).
 */
export async function ambilMaksReset(db: DbClient): Promise<number> {
  const val = await cachedFetch('pengaturan:batasPelanggaran', 60, async () => {
    const { data } = await db.from('pengaturan').select('value').eq('key', 'batasPelanggaran').single()
    return data?.value ?? '3'
  })
  const n = parseInt(val as string, 10)
  if (!Number.isFinite(n)) return MAKS_RESET_ABSOLUT
  return Math.min(MAKS_RESET_ABSOLUT, Math.max(1, n))
}
