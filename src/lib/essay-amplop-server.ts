// src/lib/essay-amplop-server.ts
//
// SISI SERVER untuk jalur essay offline (amplop terenkripsi). JANGAN
// di-import dari komponen client — file ini memakai node:crypto dan memegang
// rahasia server.
//
// ── DESAIN KODE DARURAT ─────────────────────────────────────────────────────
// Kode darurat per SESI diturunkan deterministik:
//     kode = HMAC-SHA256(rahasiaServer, "essay-darurat-kode:" + sesiId)  → N digit
// Konsekuensinya:
//   + Tidak ada kode yang tersimpan di database (tidak bisa bocor lewat dump
//     DB / backup / kesalahan RLS). Server tinggal menghitung ulang kapan pun.
//   + Kode HARUS sudah "ada" saat amplop pertama dibuat (di awal PG), jauh
//     sebelum pengawas perlu menampilkannya — dan deterministik memastikan
//     kode yang tampil di dashboard pengawas SELALU sama dengan kunci yang
//     dipakai mengenkripsi amplop.
//   - Kode tidak bisa dirotasi per sesi (amplop yang sudah terkirim terkunci
//     pada kode ini). Kalau kode terlanjur bocor, satu-satunya jalan adalah
//     tidak memakai jalur darurat untuk sesi tsb.
//   - Kalau rahasia server diganti di tengah sesi yang sedang berjalan, kode
//     berubah dan amplop lama tidak bisa dibuka dengan kode baru. Jangan
//     rotasi rahasia saat ada ujian berlangsung.
//
// Rahasia: ESSAY_DARURAT_SECRET (disarankan diset sendiri di env). Kalau tidak
// ada, dipakai JWT_SECRET dengan pemisahan domain lewat prefix di atas —
// aman secara kriptografis (HMAC dengan label berbeda), tapi rotasi JWT_SECRET
// otomatis ikut mengubah kode darurat.

import { createHmac, createCipheriv, pbkdf2, randomBytes, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'
import { cacheGet, cacheSet } from '@/lib/cache'
import {
  AMPLOP_VERSI,
  PBKDF2_ITERASI,
  PANJANG_KODE_DARURAT,
  aadAmplop,
  type EssayAmplop,
  type IsiAmplopEssay,
} from '@/lib/essay-amplop-shared'

const pbkdf2Async = promisify(pbkdf2)

function ambilRahasia(): string {
  const raw = process.env.ESSAY_DARURAT_SECRET || process.env.JWT_SECRET
  if (!raw || raw.length < 16) {
    throw new Error(
      'ESSAY_DARURAT_SECRET/JWT_SECRET tidak diset atau terlalu pendek (minimal 16 karakter).'
    )
  }
  return raw
}

function hmac(label: string, sesiId: string): Buffer {
  return createHmac('sha256', ambilRahasia()).update(`${label}:${sesiId}`).digest()
}

/** Kode darurat N digit untuk sesi ini (string, dengan nol di depan bila perlu). */
export function hitungKodeDarurat(sesiId: string): string {
  // 6 byte = 48 bit → modulo 10^N. Bias modulo diabaikan (sangat kecil untuk N ≤ 8).
  const angka = hmac('essay-darurat-kode', sesiId).readUIntBE(0, 6)
  return String(angka % 10 ** PANJANG_KODE_DARURAT).padStart(PANJANG_KODE_DARURAT, '0')
}

/** Salt PBKDF2 per sesi (deterministik supaya kunci turunan bisa di-cache per sesi; salt bukan rahasia). */
function hitungSalt(sesiId: string): Buffer {
  return hmac('essay-darurat-salt', sesiId).subarray(0, 16)
}

/** Bandingkan kode yang dikirim client dengan kode sesi, tanpa bocor lewat timing. */
export function kodeDaruratCocok(sesiId: string, kodeInput: unknown): boolean {
  if (typeof kodeInput !== 'string') return false
  const benar = Buffer.from(hitungKodeDarurat(sesiId), 'utf8')
  const input = Buffer.from(kodeInput.trim(), 'utf8')
  if (input.length !== benar.length) return false
  return timingSafeEqual(benar, input)
}

/** Kunci AES-256 dari kode sesi. Di-cache di memori karena PBKDF2 600rb iterasi tidak murah dan hasilnya sama untuk semua siswa di sesi ini. */
async function ambilKunciSesi(sesiId: string): Promise<Buffer> {
  const cacheKey = `essay-amplop-kunci:${sesiId}`
  const hit = cacheGet<Buffer>(cacheKey)
  if (hit) return hit
  const kunci = await pbkdf2Async(
    hitungKodeDarurat(sesiId),
    hitungSalt(sesiId),
    PBKDF2_ITERASI,
    32,
    'sha256'
  )
  cacheSet(cacheKey, kunci, 60 * 60)
  return kunci
}

// FIX (audit: gambar essay gagal dimuat saat offline/kode darurat): unduh
// gambar soal DI SERVER (saat amplop dibuat, sekali per sesi+paket — lihat
// cache di essay/amplop/route.ts) dan sertakan byte-nya sebagai data URL
// base64 di dalam isi amplop yang akan dienkripsi. Ini menghilangkan
// ketergantungan pada koneksi SISWA saat amplop dibuka lewat kode darurat,
// yang menurut desainnya justru dipakai TEPAT saat siswa tidak online sama
// sekali (lihat komentar `gambar_data` di essay-amplop-shared.ts).
//
// Batas waktu & ukuran sengaja dijaga longgar tapi tetap ada (fail-safe):
// kalau gagal/timeout/kelewat besar, kembalikan null saja (bukan melempar
// error) — amplop tetap terbentuk tanpa data gambar itu, dan jalur online
// (gambar_url + precacheGambarSoal di client) tetap jadi cadangan seperti
// sebelum perbaikan ini. Batas ukuran disamakan dengan batas upload gambar
// soal (lihat src/app/api/guru/soal/upload/route.ts, 2MB) supaya konsisten.
const GAMBAR_AMPLOP_TIMEOUT_MS = 8_000
const GAMBAR_AMPLOP_MAKS_BYTE = 2 * 1024 * 1024

export async function ambilGambarSebagaiDataUrl(url: string): Promise<string | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), GAMBAR_AMPLOP_TIMEOUT_MS)
  try {
    const res = await fetch(url, { signal: controller.signal })
    if (!res.ok) return null
    const contentType = (res.headers.get('content-type') ?? '').toLowerCase()
    if (!contentType.startsWith('image/')) return null
    const buf = Buffer.from(await res.arrayBuffer())
    if (buf.length === 0 || buf.length > GAMBAR_AMPLOP_MAKS_BYTE) return null
    return `data:${contentType};base64,${buf.toString('base64')}`
  } catch {
    // Timeout, jaringan gagal, atau URL tidak bisa diakses server — jangan
    // gagalkan pembuatan amplop, cukup lewati data gambarnya (lihat catatan
    // fail-safe di atas).
    return null
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Bungkus isi essay menjadi amplop AES-256-GCM.
 * Format `ct` = ciphertext || tag(16 byte) — persis yang diminta WebCrypto
 * saat decrypt, jadi client tidak perlu memisahkan tag.
 */
export async function buatAmplop(sesiId: string, isi: IsiAmplopEssay): Promise<EssayAmplop> {
  const kunci = await ambilKunciSesi(sesiId)
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', kunci, iv)
  cipher.setAAD(Buffer.from(aadAmplop(sesiId), 'utf8'))
  const ct = Buffer.concat([cipher.update(JSON.stringify(isi), 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return {
    v: AMPLOP_VERSI,
    salt: hitungSalt(sesiId).toString('base64'),
    iv: iv.toString('base64'),
    ct: Buffer.concat([ct, tag]).toString('base64'),
    iter: PBKDF2_ITERASI,
  }
}
