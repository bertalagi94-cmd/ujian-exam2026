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
//                            (boleh lebih dari satu agama, mis. "Kristen,Katolik"
//                            untuk sekolah yang menggabungkan PAK; siswa yang
//                            agamanya salah satu dari daftar itu ikut)
//   - siswa.agama kosong  -> tetap dihitung peserta mapel agama apa pun
//                            (supaya data lama tidak tiba-tiba terkunci;
//                            admin cukup melengkapi agama siswa)
//
// Semua pembacaan kolom `agama` dibuat TAHAN-GAGAL: kalau migrasi
// 61_agama_siswa_dan_mapel.sql belum dijalankan (kolom belum ada), semua mapel
// dianggap umum sehingga perilaku aplikasi sama seperti sebelumnya.

import type { createAdminClient } from '@/lib/supabase'
import { ambilSemuaBaris } from '@/lib/ambil-semua'

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

// ── Daftar agama pada MAPEL ─────────────────────────────────────────────────
// Kolom mapel.agama berisi satu nama ("Islam") ATAU beberapa nama dipisah koma
// ("Kristen,Katolik"), selalu dalam urutan DAFTAR_AGAMA. Data lama (satu agama)
// tetap valid tanpa diubah. Pemisah yang diterima saat input: koma, titik koma,
// garis miring, "&", baris baru, atau kata "dan".
const PEMISAH_AGAMA = /[,;\/|&\n]+|\s+dan\s+/i

function pecahAgama(raw: unknown): string[] {
  if (raw === null || raw === undefined) return []
  const teks = Array.isArray(raw) ? raw.map((x) => String(x ?? '')).join(',') : String(raw)
  return teks.split(PEMISAH_AGAMA).map((x) => x.trim()).filter(Boolean)
}

/** Agama baku dari isian bebas (string/array), unik, urut sesuai DAFTAR_AGAMA. */
export function daftarAgamaMapel(raw: unknown): Agama[] {
  const set = new Set<Agama>()
  for (const b of pecahAgama(raw)) {
    const a = normalisasiAgama(b)
    if (a) set.add(a)
  }
  return DAFTAR_AGAMA.filter((a) => set.has(a))
}

/** Bagian isian yang tidak dikenali (untuk pesan error validasi). */
export function agamaMapelTidakDikenali(raw: unknown): string[] {
  return pecahAgama(raw).filter((b) => !normalisasiAgama(b))
}

/** Bentuk simpan ke DB: "Kristen,Katolik"; null kalau kosong (= mapel umum). */
export function gabungAgamaMapel(raw: unknown): string | null {
  const d = daftarAgamaMapel(raw)
  return d.length ? d.join(',') : null
}

/** Label tampilan: "Kristen & Katolik" (atau sambung lain, mis. " atau "). */
export function labelAgamaMapel(raw: unknown, sambung = ' & '): string {
  return daftarAgamaMapel(raw).join(sambung)
}

/**
 * Apakah siswa (dengan agama `agamaSiswa`) menjadi peserta mapel yang
 * `agamaMapel`-nya diberikan (satu agama, daftar, atau teks "A,B")? Lihat
 * aturan di kepala file.
 */
export function cocokAgama(agamaMapel: unknown, agamaSiswa: unknown): boolean {
  const m = daftarAgamaMapel(agamaMapel)
  if (m.length === 0) return true // mapel umum
  const s = normalisasiAgama(agamaSiswa)
  if (!s) return true // agama siswa belum diisi -> tetap peserta
  return m.includes(s)
}

/** Daftar agama khusus sebuah mapel (null = mapel umum / kolom belum ada). */
export async function ambilAgamaMapel(db: DbClient, mapelId: string | null | undefined): Promise<Agama[] | null> {
  if (!mapelId) return null
  try {
    const { data, error } = await db.from('mapel').select('agama').eq('id', mapelId).maybeSingle()
    if (error || !data) return null
    const d = daftarAgamaMapel((data as { agama?: unknown }).agama)
    return d.length ? d : null
  } catch {
    return null
  }
}

/** Versi banyak-mapel: Map mapelId -> daftar agama (hanya mapel khusus agama yang masuk). */
export async function ambilAgamaMapelBanyak(db: DbClient, mapelIds: Array<string | null | undefined>): Promise<Map<string, Agama[]>> {
  const hasil = new Map<string, Agama[]>()
  const ids = [...new Set(mapelIds.filter((x): x is string => !!x))]
  if (!ids.length) return hasil
  try {
    const { data, error } = await db.from('mapel').select('id, agama').in('id', ids)
    if (error) return hasil
    for (const r of (data ?? []) as Array<{ id: string; agama?: unknown }>) {
      const d = daftarAgamaMapel(r.agama)
      if (d.length) hasil.set(r.id, d)
    }
  } catch { /* kolom belum ada -> semua mapel dianggap umum */ }
  return hasil
}

/** Info ringkas satu mapel: nama + daftar agama khusus (kosong = mapel umum). */
export interface InfoMapel { nama: string; agama: Agama[] }

/**
 * Versi HEMAT-QUERY: ambil nama DAN agama banyak mapel dalam SATU query.
 *
 * Dulu endpoint siswa (dashboard, jadwal) memanggil ambilAgamaMapelBanyak()
 * untuk penyaringan agama, lalu satu-dua query `mapel` lagi hanya untuk nama —
 * semuanya untuk id mapel yang sama. Sekarang cukup satu pembacaan, hasilnya
 * dipakai bersama (lihat parameter `infoMapel` di saringJadwalSeagama).
 *
 * Tetap TAHAN-GAGAL seperti ambilAgamaMapelBanyak: kalau kolom `agama` belum
 * ada (migrasi 61 belum dijalankan) query pertama error, lalu dicoba ulang
 * tanpa kolom itu — nama tetap terbaca dan semua mapel dianggap umum.
 */
export async function ambilInfoMapelBanyak(
  db: DbClient,
  mapelIds: Array<string | null | undefined>
): Promise<Map<string, InfoMapel>> {
  const hasil = new Map<string, InfoMapel>()
  const ids = [...new Set(mapelIds.filter((x): x is string => !!x))]
  if (!ids.length) return hasil
  type Baris = { id: string; nama: string | null; agama?: unknown }
  try {
    let adaKolomAgama = true
    let baris: Baris[]
    const percobaan1 = await db.from('mapel').select('id, nama, agama').in('id', ids)
    if (!percobaan1.error) {
      baris = (percobaan1.data ?? []) as Baris[]
    } else {
      adaKolomAgama = false
      const percobaan2 = await db.from('mapel').select('id, nama').in('id', ids)
      if (percobaan2.error) return hasil
      baris = (percobaan2.data ?? []) as Baris[]
    }
    for (const r of baris) {
      hasil.set(r.id, { nama: r.nama ?? '', agama: adaKolomAgama ? daftarAgamaMapel(r.agama) : [] })
    }
  } catch { /* gagal baca -> kosong: nama jatuh ke id, semua mapel dianggap umum */ }
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
 * Saring daftar siswa: sisakan hanya peserta mapel dengan `agamaMapel`
 * (satu agama atau daftar agama).
 * `agamaMapel` null/kosong -> daftar dikembalikan apa adanya (tanpa query tambahan).
 */
export async function saringSiswaSeagama<T extends { nis: string }>(
  db: DbClient,
  siswa: T[],
  agamaMapel: Agama | Agama[] | null
): Promise<T[]> {
  if (!agamaMapel || daftarAgamaMapel(agamaMapel).length === 0 || !siswa.length) return siswa
  const peta = await ambilAgamaSiswa(db, siswa.map(s => s.nis))
  return siswa.filter(s => cocokAgama(agamaMapel, peta.get(s.nis) ?? null))
}

/**
 * Saring jadwal untuk SATU siswa: jadwal mapel khusus agama lain disembunyikan.
 * Tanpa jadwal mapel khusus agama -> tidak ada query tambahan.
 *
 * `infoMapel` (opsional): hasil ambilInfoMapelBanyak() yang SUDAH dibaca
 * pemanggil untuk id mapel jadwal ini. Kalau diberikan, tidak ada query
 * `mapel` lagi di sini (hemat 1 request). Tanpa itu, perilaku seperti semula.
 */
export async function saringJadwalSeagama<T extends { mapel_id?: string | null }>(
  db: DbClient,
  jadwal: T[],
  nis: string | null | undefined,
  infoMapel?: Map<string, InfoMapel>
): Promise<T[]> {
  if (!jadwal.length) return jadwal
  let agamaMapelMap: Map<string, Agama[]>
  if (infoMapel) {
    agamaMapelMap = new Map()
    for (const [id, info] of infoMapel) if (info.agama.length) agamaMapelMap.set(id, info.agama)
  } else {
    agamaMapelMap = await ambilAgamaMapelBanyak(db, jadwal.map(j => j.mapel_id))
  }
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
): Promise<{ boleh: true } | { boleh: false; agamaMapel: Agama[]; agamaSiswa: Agama | null }> {
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

// ── Pilihan agama untuk form mapel: diambil dari DATA SISWA ─────────────────
// Admin tidak mengetik / memilih dari daftar buatan sendiri. Pilihan di form
// mapel adalah agama yang benar-benar ada pada siswa aktif yayasan ini, lengkap
// dengan jumlah siswanya, sehingga salah ketik atau salah baca tidak mungkin
// terjadi. Isian siswa yang tidak dikenali (kemungkinan typo) dilaporkan agar
// bisa diperbaiki di Data Siswa.
export interface RingkasanAgamaSiswa {
  /** Agama baku yang ada pada siswa aktif, urut DAFTAR_AGAMA, dengan jumlah siswa. */
  agama: Array<{ nama: Agama; jumlah: number }>
  /** Isian agama siswa yang tidak dikenali (kemungkinan typo), dengan jumlah siswa. */
  tidakDikenali: Array<{ nilai: string; jumlah: number }>
  /** Siswa aktif yang agamanya belum diisi. */
  belumDiisi: number
  totalAktif: number
  /** true bila kolom siswa.agama belum ada (migrasi 61 belum dijalankan). */
  kolomBelumAda?: boolean
}

export async function ringkasanAgamaSiswa(db: DbClient): Promise<RingkasanAgamaSiswa> {
  const kosong: RingkasanAgamaSiswa = { agama: [], tidakDikenali: [], belumDiisi: 0, totalAktif: 0 }
  const { data, error } = await ambilSemuaBaris<{ nis: string; agama?: unknown }>((dari, sampai) =>
    db.from('siswa').select('nis, agama').eq('status', 'AKTIF')
      .order('nis', { ascending: true }).range(dari, sampai)
  )
  if (error) {
    if (/agama/i.test(error.message)) return { ...kosong, kolomBelumAda: true }
    throw new Error(error.message)
  }

  const hitung = new Map<Agama, number>()
  const asing = new Map<string, number>()
  let belumDiisi = 0
  for (const r of data) {
    const a = normalisasiAgama(r.agama)
    if (a) hitung.set(a, (hitung.get(a) ?? 0) + 1)
    else if (adaIsianAgama(r.agama)) {
      const nilai = String(r.agama).trim()
      asing.set(nilai, (asing.get(nilai) ?? 0) + 1)
    } else belumDiisi++
  }
  return {
    agama: DAFTAR_AGAMA.filter((a) => hitung.has(a)).map((a) => ({ nama: a, jumlah: hitung.get(a) ?? 0 })),
    tidakDikenali: [...asing.entries()].map(([nilai, jumlah]) => ({ nilai, jumlah })).sort((x, y) => y.jumlah - x.jumlah),
    belumDiisi,
    totalAktif: data.length,
  }
}
