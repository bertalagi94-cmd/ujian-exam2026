// Batas minimal jumlah soal per mapel (opsional, bawaan MATI).
//
// Disimpan di tabel `pengaturan` (key/value, per yayasan) sebagai satu key
// JSON, jadi TIDAK butuh migrasi database:
//
//   key   = 'batasMinSoal'
//   value = {"aktif":true,
//            "pg":   [{"min":30,"mapel":["MATEMATIKA","IPA"]},
//                     {"min":35,"mapel":["BAHASA INDONESIA"]}],
//            "essay":[{"min":5, "mapel":["MATEMATIKA"]}]}
//
// Satu kelompok = satu angka minimal + daftar nama mapel yang dicentang.
// Mapel yang tidak masuk kelompok mana pun memakai BATAS BAWAAN
// (`bawaan.pg` / `bawaan.essay`, opsional). Kalau bawaan juga kosong, tetap
// memakai aturan lama (minimal 1 soal). Contoh lengkap:
//
//   {"aktif":true,
//    "bawaan":{"pg":30,"essay":null},
//    "pg":[{"min":35,"mapel":["BAHASA INDONESIA"]}], "essay":[]}
//   → semua mapel PG wajib 30 soal, kecuali BAHASA INDONESIA wajib 35.
//
// Angka ini = jumlah soal yang TEPAT per paket: guru tidak bisa menambah di
// atasnya (cekBatasTambahSoal) dan tidak bisa mengirim di bawah/di atasnya
// (cekBatasMinSoal). Nama field `min` dipertahankan agar data lama tetap terbaca.
//
// Pencocokan memakai NAMA mapel (tanpa beda huruf besar/kecil), karena satu
// nama mapel bisa punya beberapa baris (per guru/kelas).

import type { SupabaseClient } from '@supabase/supabase-js'

export type JenisSoal = 'pg' | 'essay'

export interface KelompokBatas {
  min: number
  mapel: string[]
}

export interface BatasMinSoal {
  aktif: boolean
  /** Batas untuk mapel yang tidak masuk kelompok mana pun. null = tidak ada (minimal 1). */
  bawaan: { pg: number | null; essay: number | null }
  pg: KelompokBatas[]
  essay: KelompokBatas[]
}

export const KUNCI_BATAS_MIN_SOAL = 'batasMinSoal'
export const MIN_SOAL_MAKS = 500

export const normNamaMapel = (s: string) => s.trim().replace(/\s+/g, ' ').toUpperCase()

function bersihkanKelompok(arr: unknown): KelompokBatas[] {
  if (!Array.isArray(arr)) return []
  const hasil: KelompokBatas[] = []
  for (const k of arr) {
    const min = Math.floor(Number((k as KelompokBatas)?.min))
    const mapel = Array.isArray((k as KelompokBatas)?.mapel)
      ? (k as KelompokBatas).mapel.filter(m => typeof m === 'string' && m.trim()).map(m => m.trim())
      : []
    if (Number.isFinite(min) && min >= 1 && min <= MIN_SOAL_MAKS) hasil.push({ min, mapel })
  }
  return hasil
}

function bersihkanAngka(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = Math.floor(Number(v))
  return Number.isFinite(n) && n >= 1 && n <= MIN_SOAL_MAKS ? n : null
}

/** Parse aman: nilai rusak / kosong = fitur mati (perilaku lama). */
export function parseBatasMinSoal(raw: string | null | undefined): BatasMinSoal {
  const kosong: BatasMinSoal = { aktif: false, bawaan: { pg: null, essay: null }, pg: [], essay: [] }
  if (!raw) return kosong
  try {
    const o = JSON.parse(raw)
    return {
      aktif: o?.aktif === true,
      // Data lama (tanpa `bawaan`) otomatis menjadi null = perilaku lama.
      bawaan: { pg: bersihkanAngka(o?.bawaan?.pg), essay: bersihkanAngka(o?.bawaan?.essay) },
      pg: bersihkanKelompok(o?.pg),
      essay: bersihkanKelompok(o?.essay),
    }
  } catch {
    return kosong
  }
}

/** Validasi input dari admin sebelum disimpan. */
export function validasiBatasMinSoal(
  input: unknown
): { ok: true; data: BatasMinSoal } | { ok: false; error: string } {
  const o = input as Partial<BatasMinSoal> | null
  if (!o || typeof o !== 'object' || typeof o.aktif !== 'boolean') {
    return { ok: false, error: 'Format pengaturan tidak valid' }
  }
  const hasil: BatasMinSoal = { aktif: o.aktif, bawaan: { pg: null, essay: null }, pg: [], essay: [] }

  // Batas bawaan: kosong (null/undefined/'') = tidak ada; selain itu wajib bilangan bulat 1..MAKS.
  for (const jenis of ['pg', 'essay'] as const) {
    const label = jenis === 'pg' ? 'PG' : 'Essay'
    const mentah = (o.bawaan as Partial<BatasMinSoal['bawaan']> | undefined)?.[jenis]
    if (mentah === null || mentah === undefined || (mentah as unknown) === '') continue
    const n = Number(mentah)
    if (!Number.isInteger(n) || n < 1 || n > MIN_SOAL_MAKS) {
      return { ok: false, error: `Batas bawaan ${label} harus bilangan bulat 1 sampai ${MIN_SOAL_MAKS} (atau kosongkan)` }
    }
    hasil.bawaan[jenis] = n
  }

  for (const jenis of ['pg', 'essay'] as const) {
    const label = jenis === 'pg' ? 'PG' : 'Essay'
    const mentah = o[jenis]
    if (!Array.isArray(mentah)) return { ok: false, error: `Data kelompok ${label} tidak valid` }

    const dipakai = new Set<string>()
    for (const k of mentah) {
      const mapel = Array.isArray((k as KelompokBatas)?.mapel)
        ? [...new Set((k as KelompokBatas).mapel.filter(m => typeof m === 'string' && m.trim()).map(m => m.trim()))]
        : []
      // Kelompok tanpa mapel dibuang SEBELUM angkanya divalidasi, supaya
      // kelompok kosong yang baru ditambah (angka belum diisi) tidak
      // membuat penyimpanan gagal.
      if (mapel.length === 0) continue
      const min = Number((k as KelompokBatas)?.min)
      if (!Number.isInteger(min) || min < 1 || min > MIN_SOAL_MAKS) {
        return { ok: false, error: `Batas minimal ${label} harus bilangan bulat 1 sampai ${MIN_SOAL_MAKS} (isi angka untuk kelompok yang mapelnya sudah dicentang)` }
      }
      for (const m of mapel) {
        const n = normNamaMapel(m)
        if (dipakai.has(n)) {
          return { ok: false, error: `Mapel "${m}" dicentang di lebih dari satu kelompok ${label}` }
        }
        dipakai.add(n)
      }
      hasil[jenis].push({ min, mapel })
    }
  }
  return { ok: true, data: hasil }
}

/**
 * Batas minimal yang berlaku untuk satu mapel (PURE, tanpa database):
 *   1. mapel dicentang di sebuah kelompok  → angka kelompok itu (mis. 30 atau 35)
 *   2. tidak masuk kelompok, ada bawaan    → angka bawaan
 *   3. selain itu                          → null (aturan lama: minimal 1 soal)
 * Fitur mati (aktif=false) selalu null.
 */
export function cariBatasMin(cfg: BatasMinSoal, jenis: JenisSoal, namaMapel: string): number | null {
  if (!cfg.aktif) return null
  const nama = normNamaMapel(namaMapel)
  const cocok = cfg[jenis].find(k => k.mapel.some(m => normNamaMapel(m) === nama))
  if (cocok) return cocok.min
  return cfg.bawaan[jenis]
}

async function bacaBatasMapel(
  db: SupabaseClient,
  opts: { jenis: JenisSoal; mapelId: string }
): Promise<{ min: number | null; namaMapel: string | null }> {
  const { data: pengaturan } = await db
    .from('pengaturan')
    .select('value')
    .eq('key', KUNCI_BATAS_MIN_SOAL)
    .maybeSingle()

  const cfg = parseBatasMinSoal(pengaturan?.value)
  if (!cfg.aktif) return { min: null, namaMapel: null }

  const { data: mapel } = await db.from('mapel').select('nama').eq('id', opts.mapelId).maybeSingle()
  if (!mapel?.nama) return { min: null, namaMapel: null }

  return { min: cariBatasMin(cfg, opts.jenis, mapel.nama), namaMapel: mapel.nama }
}

/**
 * Cek jumlah soal sebuah paket SAAT DIKIRIM terhadap jumlah yang ditetapkan
 * admin untuk mapelnya. Angka admin = jumlah soal yang TEPAT: kurang tidak
 * boleh, lebih juga tidak boleh (kelebihan harus dihapus dulu).
 * Mengembalikan pesan error (string), atau null kalau pas / fitur mati /
 * mapel tidak punya batas.
 * `db` harus tenantDb(...) supaya otomatis terbatas ke yayasan yang login.
 */
export async function cekBatasMinSoal(
  db: SupabaseClient,
  opts: { jenis: JenisSoal; mapelId: string; jumlah: number }
): Promise<string | null> {
  const { min, namaMapel } = await bacaBatasMapel(db, opts)
  if (min === null || opts.jumlah === min) return null

  const label = opts.jenis === 'pg' ? 'PG' : 'Essay'
  if (opts.jumlah < min) {
    return `Paket ${label} ${namaMapel} harus tepat ${min} soal, saat ini baru ${opts.jumlah}`
  }
  const lebih = opts.jumlah - min
  return `Paket ${label} ${namaMapel} harus tepat ${min} soal, saat ini ada ${opts.jumlah} (kelebihan ${lebih}, hapus ${lebih} soal dulu)`
}

/**
 * Cek SEBELUM menambah soal (ketik manual atau impor): jumlah soal yang sudah
 * ada + yang akan ditambah tidak boleh melebihi jumlah yang ditetapkan admin.
 * Mengembalikan pesan error, atau null kalau masih muat / tidak ada batas.
 */
export async function cekBatasTambahSoal(
  db: SupabaseClient,
  opts: { jenis: JenisSoal; mapelId: string; sudahAda: number; tambah: number }
): Promise<string | null> {
  const { min, namaMapel } = await bacaBatasMapel(db, opts)
  if (min === null) return null
  const total = opts.sudahAda + opts.tambah
  if (total <= min) return null

  const label = opts.jenis === 'pg' ? 'PG' : 'Essay'
  if (opts.sudahAda >= min) {
    return `Paket ${label} ${namaMapel} sudah berisi ${opts.sudahAda} soal sesuai ketentuan admin (${min} soal), jadi tidak bisa menambah soal lagi`
  }
  const sisa = min - opts.sudahAda
  return `Ketentuan admin untuk paket ${label} ${namaMapel} adalah tepat ${min} soal. Saat ini sudah ${opts.sudahAda}, jadi hanya bisa menambah ${sisa} soal lagi (diminta ${opts.tambah})`
}

/**
 * Cek SEBELUM menduplikasi paket: paket sumber yang jumlah soalnya belum
 * mencapai batas admin tidak boleh diduplikasi (kalau boleh, guru bisa
 * menggandakan paket yang belum lengkap ke banyak kelas). Hanya memblokir
 * kalau KURANG — paket yang pas/lebih tetap boleh, dan fitur mati / mapel
 * tanpa batas selalu lolos. Pesan sengaja singkat karena tampil di toast.
 * Mengembalikan pesan error, atau null kalau boleh diduplikasi.
 */
export async function cekBatasDuplikatSoal(
  db: SupabaseClient,
  opts: { jenis: JenisSoal; mapelId: string; jumlah: number }
): Promise<string | null> {
  const { min, namaMapel } = await bacaBatasMapel(db, opts)
  if (min === null || opts.jumlah >= min) return null

  const label = opts.jenis === 'pg' ? 'PG' : 'Essay'
  return `Belum bisa diduplikasi. Soal ${label} ${namaMapel} baru ${opts.jumlah} dari ${min}, lengkapi dulu.`
}

/**
 * Batas minimal soal untuk satu mapel (dipakai form unduh template & info di
 * halaman guru). null = tidak dibatasi (fitur mati / mapel tanpa batas).
 */
export async function ambilBatasMinMapel(
  db: SupabaseClient,
  opts: { jenis: JenisSoal; mapelId: string }
): Promise<number | null> {
  return (await bacaBatasMapel(db, opts)).min
}
