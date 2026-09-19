// src/lib/essay-amplop-client.ts
//
// SISI CLIENT untuk jalur essay offline. Tugasnya hanya dua:
//   1. Menyimpan amplop terenkripsi di perangkat sejak awal PG.
//   2. Mencoba MEMBUKA amplop dengan kode dari pengawas.
//
// Tidak ada perbandingan "kode == benar" di sini. Kode diubah jadi kunci lewat
// PBKDF2 lalu dipakai mendekripsi AES-GCM; kalau kode salah, tag otentikasi
// tidak cocok dan decrypt melempar error. Tidak ada variabel/flag "kode benar"
// yang bisa dibaca atau di-bypass lewat DevTools — yang ada hanya ciphertext.
//
// KETERBATASAN JUJUR: ini melindungi dari siswa biasa, bukan dari penyerang
// yang menjalankan brute force sendiri terhadap amplop. Lihat catatan di
// essay-amplop-shared.ts (PANJANG_KODE_DARURAT).

import {
  PBKDF2_ITERASI_MAKS_CLIENT,
  aadAmplop,
  type EssayAmplop,
  type IsiAmplopEssay,
} from '@/lib/essay-amplop-shared'

// ── base64 ↔ bytes ─────────────────────────────────────────────────────────
// Mengembalikan ArrayBuffer (bukan Uint8Array) karena itulah tipe BufferSource
// yang diterima WebCrypto di semua versi TypeScript.
function dariBase64(b64: string): ArrayBuffer {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out.buffer as ArrayBuffer
}

// ── Penyimpanan lokal ──────────────────────────────────────────────────────
const kunciAmplop = (sesiId: string, nis: string) => `essay_amplop_${sesiId}_${nis}`
const kunciStatus = (sesiId: string, nis: string) => `essay_offline_${sesiId}_${nis}`

export function simpanAmplop(sesiId: string, nis: string, amplop: EssayAmplop): void {
  try { localStorage.setItem(kunciAmplop(sesiId, nis), JSON.stringify(amplop)) } catch { /* penyimpanan penuh/diblokir: abaikan */ }
}

export function ambilAmplop(sesiId: string, nis: string): EssayAmplop | null {
  try {
    const raw = localStorage.getItem(kunciAmplop(sesiId, nis))
    return raw ? (JSON.parse(raw) as EssayAmplop) : null
  } catch { return null }
}

/** Status pembukaan essay secara offline yang belum dilaporkan ke server. */
export interface StatusOffline {
  /** ISO time saat siswa pertama kali berhasil membuka essay offline. */
  waktuMulaiClient?: string
  /** Kode yang berhasil membuka amplop — dikirim ke server saat rekonsiliasi sebagai bukti, lalu dihapus. */
  kode?: string
  /** Jumlah kode salah yang diketik di perangkat ini (untuk audit). */
  salah: number
}

export function ambilStatusOffline(sesiId: string, nis: string): StatusOffline {
  try {
    const raw = localStorage.getItem(kunciStatus(sesiId, nis))
    if (raw) {
      const p = JSON.parse(raw) as Partial<StatusOffline>
      return { waktuMulaiClient: p.waktuMulaiClient, kode: p.kode, salah: Number(p.salah) || 0 }
    }
  } catch { /* abaikan */ }
  return { salah: 0 }
}

export function simpanStatusOffline(sesiId: string, nis: string, status: StatusOffline): void {
  try { localStorage.setItem(kunciStatus(sesiId, nis), JSON.stringify(status)) } catch { /* abaikan */ }
}

export function hapusStatusOffline(sesiId: string, nis: string): void {
  try { localStorage.removeItem(kunciStatus(sesiId, nis)) } catch { /* abaikan */ }
}

// ── Dekripsi ───────────────────────────────────────────────────────────────
export class EnkripsiTidakDidukungError extends Error {
  constructor() {
    super('Perangkat/browser ini tidak mendukung fitur keamanan yang dibutuhkan (WebCrypto).')
    this.name = 'EnkripsiTidakDidukungError'
  }
}

/**
 * Coba membuka amplop dengan `kode`.
 * @returns isi essay kalau kode benar; `null` kalau kode salah (atau amplop rusak).
 * @throws EnkripsiTidakDidukungError kalau crypto.subtle tidak tersedia
 *         (mis. halaman dibuka lewat http:// non-localhost).
 */
export async function bukaAmplop(
  amplop: EssayAmplop,
  sesiId: string,
  kode: string
): Promise<IsiAmplopEssay | null> {
  const subtle = typeof crypto !== 'undefined' ? crypto.subtle : undefined
  if (!subtle) throw new EnkripsiTidakDidukungError()

  const iter = Number(amplop.iter)
  if (!Number.isInteger(iter) || iter < 1 || iter > PBKDF2_ITERASI_MAKS_CLIENT) return null

  try {
    const bahanKunci = await subtle.importKey(
      'raw',
      new TextEncoder().encode(kode),
      'PBKDF2',
      false,
      ['deriveKey']
    )
    const kunci = await subtle.deriveKey(
      { name: 'PBKDF2', hash: 'SHA-256', salt: dariBase64(amplop.salt), iterations: iter },
      bahanKunci,
      { name: 'AES-GCM', length: 256 },
      false,
      ['decrypt']
    )
    const plain = await subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: dariBase64(amplop.iv),
        additionalData: new TextEncoder().encode(aadAmplop(sesiId)),
      },
      kunci,
      dariBase64(amplop.ct)
    )
    return JSON.parse(new TextDecoder().decode(plain)) as IsiAmplopEssay
  } catch {
    // Tag GCM tidak cocok (kode salah) ATAU amplop rusak — keduanya diperlakukan sama.
    return null
  }
}
