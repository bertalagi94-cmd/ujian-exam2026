// src/lib/agama.ts
//
// ── MAPEL KHUSUS AGAMA ──────────────────────────────────────────────────────
// Dalam satu kelas, siswa bisa berbeda agama dan tiap agama punya mapel
// Pendidikan Agama sendiri (mis. PAI untuk siswa Islam, PAK untuk siswa
// Kristen). Tanpa pemisahan ini SELURUH siswa kelas dihitung peserta ujian
// PAI, sehingga siswa Kristen tampil "belum login" di akun pengawas.
//
// Aturan (dipakai SEMUA endpoint yang menghitung peserta):
//   - mapel.agama kosong  -> mapel umum: semua siswa kelas adalah peserta
//   - mapel.agama terisi  -> hanya siswa dengan agama SAMA yang peserta
//   - siswa.agama kosong  -> tetap dihitung peserta mapel agama apa pun
//                            (supaya data lama tidak tiba-tiba terkunci;
//                            admin cukup melengkapi agama siswa)
//
// Semua pembacaan kolom `agama` dibuat TAHAN-GAGAL: kalau migrasi
// 61_agama_siswa_dan_mapel.sql belum dijalankan (kolom belum ada), semua mapel
// dianggap umum sehingga perilaku aplikasi sama seperti sebelumnya.

import type { createAdminClient } from '@/lib/supabase'

type DbClient = ReturnType<typeof createAdminClient>

export const DAFTAR_AGAMA = ['Islam', 'Kristen', 'Katolik', 'Hindu', 'Buddha', 'Konghucu'] as const
export type Agama = (typeof DAFTAR_AGAMA)[number]

/**
 * Samakan isian bebas (Excel/form) ke nama agama baku. Mengembalikan null kalau
 * kosong ATAU tidak dikenali. Gunakan `adaIsianAgama()` untuk membedakan
 * keduanya (mis. agar impor bisa memberi peringatan untuk isian aneh).
 */
export function normalisasiAgama(raw: unknown): Agama | null {
  if (raw === null || raw === undefined) return null
  const s = String(raw).toLowerCase().replace(/[^a-z]/g, '')
  if (!s) return null
  if (s.includes('katolik') || s.includes('katholik') || s.includes('catholic')) return 'Katolik'
  if (s.includes('kristen') || s.includes('protestan') || s.includes('christian')) return 'Kristen'
  if (s.includes('islam') || s.includes('muslim')) return 'Islam'
  if (s.includes('hindu')) return 'Hindu'
  if (s.includes('budha') || s.includes('buddha') || s.includes('buddhis')) return 'Buddha'
  if (s.includes('konghucu') || s.includes('khonghucu') || s.includes('konfusius') || s.includes('confuci')) return 'Konghucu'
  return null
}

/** true kalau isian tidak kosong (setelah dipangkas). */
export function adaIsianAgama(raw: unknown): boolean {
  return raw !== null && raw !== undefined && String(raw).trim() !== ''
}

/**
 * Apakah siswa (dengan agama `agamaSiswa`) menjadi peserta mapel yang
 * `agamaMapel`-nya diberikan? Lihat aturan di kepala file.
 */
export function cocokAgama(agamaMapel: unknown, agamaSiswa: unknown): boolean {
  const m = normalisasiAgama(agamaMapel)
  if (!m) return true // mapel umum
  const s = normalisasiAgama(agamaSiswa)
  if (!s) return true // agama siswa belum diisi -> tetap peserta
  return m === s
}

/** Agama khusus sebuah mapel (null = mapel umum / kolom belum ada). */
export async function ambilAgamaMapel(db: DbClient, mapelId: string | null | undefined): Promise<Agama | null> {
  if (!mapelId) return null
  try {
    const { data, error } = await db.from('mapel').select('agama').eq('id', mapelId).maybeSingle()
    if (error || !data) return null
    return normalisasiAgama((data as { agama?: unknown }).agama)
  } catch {
    return null
  }
}

/** Versi banyak-mapel: Map mapelId -> agama (hanya mapel khusus agama yang masuk). */
export async function ambilAgamaMapelBanyak(db: DbClient, mapelIds: Array<string | null | undefined>): Promise<Map<string, Agama>> {
  const hasil = new Map<string, Agama>()
  const ids = [...new Set(mapelIds.filter((x): x is string => !!x))]
  if (!ids.length) return hasil
  try {
    const { data, error } = await db.from('mapel').select('id, agama').in('id', ids)
    if (error) return hasil
    for (const r of (data ?? []) as Array<{ id: string; agama?: unknown }>) {
      const a = normalisasiAgama(r.agama)
      if (a) hasil.set(r.id, a)
    }
  } catch { /* kolom belum ada -> semua mapel dianggap umum */ }
  return hasil
}

/** Map nis -> agama baku siswa (hanya yang terisi). Dibaca per potongan 200 NIS. */
export async function ambilAgamaSiswa(db: DbClient, nisList: string[]): Promise<Map<string, Agama>> {
  const hasil = new Map<string, Agama>()
  const unik = [...new Set(nisList)]
  const UKURAN = 200
  try {
    for (let i = 0; i < unik.length; i += UKURAN) {
      const { data, error } = await db.from('siswa').select('nis, agama').in('nis', unik.slice(i, i + UKURAN))
      if (error) return hasil
      for (const r of (data ?? []) as Array<{ nis: string; agama?: unknown }>) {
        const a = normalisasiAgama(r.agama)
        if (a) hasil.set(String(r.nis), a)
      }
    }
  } catch { /* kolom belum ada */ }
  return hasil
}

/**
 * Saring daftar siswa: sisakan hanya peserta mapel dengan `agamaMapel`.
 * `agamaMapel` null -> daftar dikembalikan apa adanya (tanpa query tambahan).
 */
export async function saringSiswaSeagama<T extends { nis: string }>(
  db: DbClient,
  siswa: T[],
  agamaMapel: Agama | null
): Promise<T[]> {
  if (!agamaMapel || !siswa.length) return siswa
  const peta = await ambilAgamaSiswa(db, siswa.map(s => s.nis))
  return siswa.filter(s => cocokAgama(agamaMapel, peta.get(s.nis) ?? null))
}

/**
 * Saring jadwal untuk SATU siswa: jadwal mapel khusus agama lain disembunyikan.
 * Tanpa jadwal mapel khusus agama -> tidak ada query tambahan.
 */
export async function saringJadwalSeagama<T extends { mapel_id?: string | null }>(
  db: DbClient,
  jadwal: T[],
  nis: string | null | undefined
): Promise<T[]> {
  if (!jadwal.length) return jadwal
  const agamaMapelMap = await ambilAgamaMapelBanyak(db, jadwal.map(j => j.mapel_id))
  if (agamaMapelMap.size === 0) return jadwal
  const agamaSiswa = nis ? (await ambilAgamaSiswa(db, [nis])).get(nis) ?? null : null
  return jadwal.filter(j => cocokAgama(j.mapel_id ? agamaMapelMap.get(j.mapel_id) ?? null : null, agamaSiswa))
}

/**
 * Apakah SATU siswa boleh mengikuti mapel ini? Mengembalikan info agama untuk
 * pesan penolakan. Aman bila kolom belum ada (selalu boleh).
 */
export async function cekSiswaBolehMapel(
  db: DbClient,
  mapelId: string | null | undefined,
  nis: string
): Promise<{ boleh: true } | { boleh: false; agamaMapel: Agama; agamaSiswa: Agama | null }> {
  const agamaMapel = await ambilAgamaMapel(db, mapelId)
  if (!agamaMapel) return { boleh: true }
  const agamaSiswa = (await ambilAgamaSiswa(db, [nis])).get(nis) ?? null
  if (cocokAgama(agamaMapel, agamaSiswa)) return { boleh: true }
  return { boleh: false, agamaMapel, agamaSiswa }
}

/**
 * Penyaring peserta untuk laporan yang menghitung "belum ujian" per mapel+kelas.
 * Mengembalikan fungsi `(mapelId, nis) => boolean` (true = siswa ini peserta
 * mapel tsb). Kalau tidak ada mapel khusus agama di `mapelIds`, tidak ada query
 * agama siswa sama sekali dan semuanya dianggap peserta.
 */
export async function bangunPenyaringPeserta(
  db: DbClient,
  mapelIds: Array<string | null | undefined>,
  nisList: string[]
): Promise<(mapelId: string | null | undefined, nis: string) => boolean> {
  const agamaMapelMap = await ambilAgamaMapelBanyak(db, mapelIds)
  if (agamaMapelMap.size === 0) return () => true
  const agamaSiswaMap = await ambilAgamaSiswa(db, nisList)
  return (mapelId, nis) =>
    cocokAgama(mapelId ? agamaMapelMap.get(mapelId) ?? null : null, agamaSiswaMap.get(nis) ?? null)
}

/** Label tampilan untuk badge/pesan. */
export function labelAgama(a: unknown): string {
  return normalisasiAgama(a) ?? ''
}
