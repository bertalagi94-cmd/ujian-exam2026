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
// Mapel yang tidak masuk kelompok mana pun tetap memakai aturan lama
// (minimal 1 soal). Pencocokan memakai NAMA mapel (tanpa beda huruf besar/
// kecil), karena satu nama mapel bisa punya beberapa baris (per guru/kelas).

import type { SupabaseClient } from '@supabase/supabase-js'

export type JenisSoal = 'pg' | 'essay'

export interface KelompokBatas {
  min: number
  mapel: string[]
}

export interface BatasMinSoal {
  aktif: boolean
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

/** Parse aman: nilai rusak / kosong = fitur mati (perilaku lama). */
export function parseBatasMinSoal(raw: string | null | undefined): BatasMinSoal {
  const kosong: BatasMinSoal = { aktif: false, pg: [], essay: [] }
  if (!raw) return kosong
  try {
    const o = JSON.parse(raw)
    return {
      aktif: o?.aktif === true,
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
  const hasil: BatasMinSoal = { aktif: o.aktif, pg: [], essay: [] }

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
 * Cek jumlah soal sebuah paket terhadap batas minimal mapelnya.
 * Mengembalikan pesan error (string) kalau KURANG, atau null kalau lolos /
 * fitur mati / mapel tidak masuk kelompok mana pun.
 * `db` harus tenantDb(...) supaya otomatis terbatas ke yayasan yang login.
 */
export async function cekBatasMinSoal(
  db: SupabaseClient,
  opts: { jenis: JenisSoal; mapelId: string; jumlah: number }
): Promise<string | null> {
  const { data: pengaturan } = await db
    .from('pengaturan')
    .select('value')
    .eq('key', KUNCI_BATAS_MIN_SOAL)
    .maybeSingle()

  const cfg = parseBatasMinSoal(pengaturan?.value)
  if (!cfg.aktif) return null

  const kelompok = cfg[opts.jenis]
  if (kelompok.length === 0) return null

  const { data: mapel } = await db.from('mapel').select('nama').eq('id', opts.mapelId).maybeSingle()
  if (!mapel?.nama) return null

  const nama = normNamaMapel(mapel.nama)
  const cocok = kelompok.find(k => k.mapel.some(m => normNamaMapel(m) === nama))
  if (!cocok || opts.jumlah >= cocok.min) return null

  const label = opts.jenis === 'pg' ? 'PG' : 'Essay'
  return `Paket ${label} ${mapel.nama} minimal ${cocok.min} soal, saat ini baru ${opts.jumlah}`
}
