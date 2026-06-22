import { createAdminClient } from '@/lib/supabase'
import { cacheGet, cacheSet } from '@/lib/cache'
import { ZONA_WAKTU_INFO, ZonaWaktu, ZonaWaktuInfo, getZonaWaktuByProvinsiId } from '@/lib/wilayah'

const CACHE_KEY = 'pengaturan:lokasi-sekolah'
const CACHE_TTL_DETIK = 60 // cukup pendek — perubahan pengaturan langsung kerasa, tapi tidak query DB tiap request

export interface LokasiSekolah {
  provinsiId: string | null
  kabupaten: string | null
  zonaWaktu: ZonaWaktuInfo | null // null jika belum diatur sama sekali
}

/**
 * Ambil pengaturan lokasi sekolah (provinsi, kabupaten) dari tabel
 * `pengaturan`, lalu turunkan zona waktunya. Hasil di-cache sebentar agar
 * tidak query DB di setiap request status jadwal.
 *
 * Mengembalikan `zonaWaktu: null` jika admin belum mengisi provinsi sama
 * sekali — pemanggil WAJIB menangani kasus ini (lihat `getZonaWaktuSekolah`
 * di bawah untuk versi dengan fallback).
 */
export async function getLokasiSekolah(): Promise<LokasiSekolah> {
  const cached = cacheGet<LokasiSekolah>(CACHE_KEY)
  if (cached) return cached

  const db = createAdminClient()
  const { data } = await db
    .from('pengaturan')
    .select('key, value')
    .in('key', ['provinsiId', 'kabupaten'])

  const map = Object.fromEntries((data ?? []).map((r: { key: string; value: string }) => [r.key, r.value]))
  const provinsiId = map.provinsiId || null
  const kabupaten = map.kabupaten || null
  const zonaWaktu = provinsiId ? getZonaWaktuByProvinsiId(provinsiId) : null

  const result: LokasiSekolah = { provinsiId, kabupaten, zonaWaktu }
  cacheSet(CACHE_KEY, result, CACHE_TTL_DETIK)
  return result
}

/**
 * Sama seperti `getLokasiSekolah().zonaWaktu`, tapi dengan fallback WIB
 * supaya fitur yang SUDAH BERJALAN (status jadwal, dsb) tidak tiba-tiba
 * crash atau salah total kalau admin belum sempat mengisi provinsi.
 *
 * PENTING: fallback ini hanya jaring pengaman teknis. Untuk aksi yang
 * BARU dibuat (misalnya membuat jadwal baru), jangan pakai fallback ini —
 * pakai `getLokasiSekolah()` dan blokir aksinya, lihat
 * `pastikanLokasiSekolahLengkap()` di bawah.
 */
export async function getZonaWaktuSekolah(): Promise<ZonaWaktuInfo> {
  const { zonaWaktu } = await getLokasiSekolah()
  return zonaWaktu ?? ZONA_WAKTU_INFO.WIB
}

/**
 * Dipanggil sebelum membuat jadwal baru. Mengembalikan pesan error jika
 * lokasi sekolah (provinsi) belum diatur — supaya admin diarahkan mengisi
 * menu Pengaturan dulu sebelum status ujian bisa dihitung dengan benar.
 */
export async function pastikanLokasiSekolahLengkap(): Promise<{ ok: true } | { ok: false; error: string }> {
  const { provinsiId, zonaWaktu } = await getLokasiSekolah()
  if (!provinsiId || !zonaWaktu) {
    return {
      ok: false,
      error: 'Lokasi sekolah belum diatur. Lengkapi Provinsi & Kabupaten di menu Pengaturan → Informasi Sekolah agar zona waktu dan status ujian (Akan Datang / Berlangsung / Selesai) dapat dihitung dengan benar.',
    }
  }
  return { ok: true }
}

/**
 * Tanggal "hari ini" dalam format YYYY-MM-DD, dihitung pada zona waktu
 * sekolah (bukan UTC, bukan timezone server/device).
 *
 * `now` adalah instant UTC yang sebenarnya (selalu otomatis & akurat dari
 * `new Date()` di server — server time sudah sinkron NTP). Yang perlu
 * eksplisit hanyalah ZONA untuk menerjemahkan instant itu ke tanggal lokal
 * yang benar. Tanpa ini, `toISOString().slice(0,10)` akan memberi tanggal
 * UTC, yang mundur satu hari setiap dini hari WIB/WITA/WIT.
 */
export function tanggalHariIni(zona: ZonaWaktuInfo, now: Date = new Date()): string {
  const shifted = new Date(now.getTime() + zona.utcOffsetJam * 60 * 60 * 1000)
  return shifted.toISOString().slice(0, 10)
}

/**
 * Parse "YYYY-MM-DD" + "HH:mm" sebagai waktu pada zona sekolah menjadi
 * instant (Date) yang valid — bukan diparse sebagai UTC atau timezone
 * proses Node.js (yang bisa berbeda-beda tergantung server/region deploy).
 */
export function parseJadwalKeInstant(tanggal: string, jam: string, zona: ZonaWaktuInfo): Date {
  const tgl = tanggal.slice(0, 10)
  const jamFull = jam.length === 5 ? `${jam}:00` : jam
  return new Date(`${tgl}T${jamFull}${zona.offset}`)
}
