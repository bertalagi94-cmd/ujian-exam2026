// src/lib/reset-amplop-server.ts
//
// SISI SERVER untuk material verifikasi OFFLINE R1/R2/R3. JANGAN di-import
// dari komponen client — file ini memakai node:crypto dan (secara tidak
// langsung, lewat hitungKodeReset) memegang rahasia server.
//
// Alur: saat siswa masuk ujian (online), server menghitung R1..R(maks) lewat
// hitungKodeReset() (reset-berurutan.ts, TIDAK BERUBAH), lalu membungkus
// TIAP kode jadi satu amplop AES-256-GCM yang kuncinya diturunkan dari kode
// itu sendiri. Amplop-amplop ini (bukan kodenya) dikirim ke client saat
// pre-cache. Lihat reset-amplop-shared.ts untuk desain lengkap & batasannya.

import { createCipheriv, pbkdf2, randomBytes, createHmac } from 'node:crypto'
import { availableParallelism } from 'node:os'
import { promisify } from 'node:util'
import { AntreanPenuhError, buatPembatasKonkurensi, intDariEnv } from '@/lib/batas-konkurensi'
import { cacheGet, cacheSet } from '@/lib/cache'
import { hitungKodeReset } from '@/lib/reset-berurutan'
import {
  RESET_AMPLOP_VERSI,
  RESET_PBKDF2_ITERASI,
  aadAmplopReset,
  type ResetAmplop,
  type IsiAmplopReset,
} from '@/lib/reset-amplop-shared'

const pbkdf2Async = promisify(pbkdf2)

// Salt PBKDF2 per (sesi, nis, nomor) — deterministik (bukan rahasia, hanya
// supaya kunci turunan bisa di-cache) dan diturunkan dari sumber acak
// berbeda dari kode itu sendiri (label HMAC berbeda) supaya tidak ada
// hubungan yang bisa dieksploitasi antara salt dan kode.
function hitungSaltReset(sesiId: string, nis: string, nomor: number): Buffer {
  // Tidak butuh rahasia server di sini — salt bukan rahasia, cukup unik &
  // deterministik. Pakai HMAC dengan kunci tetap non-rahasia agar tidak
  // collision dengan pemakaian HMAC lain di aplikasi ini.
  return createHmac('sha256', 'reset-amplop-salt-v1')
    .update(JSON.stringify([sesiId, nis, nomor]))
    .digest()
    .subarray(0, 16)
}

// Derivasi yang SEDANG berjalan, per kunci cache. Cache biasa baru terisi SETELAH
// PBKDF2 selesai (~100 ms CPU), jadi dua request validasi untuk (sesi, nis,
// nomor) yang sama yang tiba berdekatan (klik ganda, retry client saat respons
// lambat) sebelumnya sama-sama menghitung ulang. Dengan ini keduanya berbagi
// satu perhitungan. Hasil & keamanan tidak berubah: kunci identik, IV tetap acak
// per amplop.
const derivasiBerjalan = new Map<string, Promise<Buffer>>()

async function ambilKunciReset(sesiId: string, nis: string, nomor: number): Promise<Buffer> {
  const cacheKey = `reset-amplop-kunci:${sesiId}:${nis}:${nomor}`
  const hit = cacheGet<Buffer>(cacheKey)
  if (hit) return hit
  const berjalan = derivasiBerjalan.get(cacheKey)
  if (berjalan) return berjalan
  const kode = hitungKodeReset(sesiId, nis, nomor)
  const janji = pbkdf2Async(kode, hitungSaltReset(sesiId, nis, nomor), RESET_PBKDF2_ITERASI, 32, 'sha256')
    .then((kunci) => {
      cacheSet(cacheKey, kunci, 60 * 60)
      return kunci
    })
    .finally(() => {
      derivasiBerjalan.delete(cacheKey)
    })
  derivasiBerjalan.set(cacheKey, janji)
  return janji
}

/** Bungkus SATU nomor reset (1..maks) jadi amplop AES-256-GCM. */
export async function buatAmplopReset(sesiId: string, nis: string, nomor: number): Promise<ResetAmplop> {
  const kunci = await ambilKunciReset(sesiId, nis, nomor)
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', kunci, iv)
  cipher.setAAD(Buffer.from(aadAmplopReset(sesiId, nis, nomor), 'utf8'))
  const isi: IsiAmplopReset = { sesiId, nis, nomor }
  const ct = Buffer.concat([cipher.update(JSON.stringify(isi), 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return {
    v: RESET_AMPLOP_VERSI,
    nomor,
    salt: hitungSaltReset(sesiId, nis, nomor).toString('base64'),
    iv: iv.toString('base64'),
    ct: Buffer.concat([ct, tag]).toString('base64'),
    iter: RESET_PBKDF2_ITERASI,
  }
}

// Pembatas untuk masuk-ujian serentak. SATU slot = SATU siswa (seluruh R1..R3),
// bukan satu derivasi, supaya siswa yang sudah mulai tidak antre ulang di antara
// siswa lain. Bawaan: konkurensi = jumlah CPU terlihat (maks 4, sesuai threadpool
// libuv), antrean maks 25 siswa (~7 dtk di 1 core). Bisa disetel lewat env:
//   RESET_PBKDF2_KONKURENSI (1..4), RESET_PBKDF2_ANTREAN_MAKS (0..500)
const pembatasMasuk = buatPembatasKonkurensi(
  intDariEnv('RESET_PBKDF2_KONKURENSI', Math.min(4, Math.max(1, availableParallelism())), 1, 4),
  intDariEnv('RESET_PBKDF2_ANTREAN_MAKS', 25, 0, 500),
)

export { AntreanPenuhError }

/** Apakah kunci R1..R(maks) siswa ini sudah ada di cache (tidak butuh PBKDF2 sama sekali)? */
function semuaKunciSudahDiCache(sesiId: string, nis: string, maks: number): boolean {
  for (let n = 1; n <= maks; n++) {
    if (!cacheGet<Buffer>(`reset-amplop-kunci:${sesiId}:${nis}:${n}`)) return false
  }
  return true
}

/**
 * R1..R(maks) sekaligus, untuk dikirim ke client saat pre-cache (masuk ujian).
 *
 * Masuk-ulang siswa yang kuncinya sudah di-cache langsung dikerjakan (hanya AES,
 * hitungan milidetik) tanpa antre. Siswa yang butuh PBKDF2 diantrekan; kalau
 * antrean penuh dilempar AntreanPenuhError (BELUM ada yang ditulis ke database
 * pada titik ini — aman diulang siswa).
 */
export async function buatSemuaAmplopReset(sesiId: string, nis: string, maks: number): Promise<ResetAmplop[]> {
  const kerja = async () => {
    const hasil: ResetAmplop[] = []
    for (let n = 1; n <= maks; n++) hasil.push(await buatAmplopReset(sesiId, nis, n))
    return hasil
  }
  if (semuaKunciSudahDiCache(sesiId, nis, maks)) return kerja()
  return pembatasMasuk.jalankan(kerja)
}
