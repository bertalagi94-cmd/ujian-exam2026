// Helper tunggal untuk durasi ujian = durasi PG + durasi Essay.
//
// KEPUTUSAN DESAIN (opsi 2): ADMIN yang menetapkan durasi essay, di jadwal
// (jadwal.essay_durasi_menit). Guru hanya MENGUSULKAN lewat
// paket_essay.durasi_menit. Saat sesi dibuka, nilai yang dipakai:
//
//     jadwal.essay_durasi_menit (admin)  ->  kalau kosong:
//     paket_essay.durasi_menit  (usulan guru)  ->  kalau kosong: 30
//
// Nilai akhir disalin ke sesi_ujian.info_json.essay_durasi_menit (sama seperti
// sebelumnya), jadi semua kode siswa (timer essay, batas waktu server) tidak
// berubah. File ini TIDAK mengimpor klien database, aman dipakai di client.

export const DURASI_ESSAY_DEFAULT_MENIT = 30
export const DURASI_ESSAY_MIN_DEFAULT = 10
export const DURASI_ESSAY_MAX_DEFAULT = 180

export type SumberDurasiEssay = 'ADMIN' | 'USULAN_GURU' | 'DEFAULT'

function angkaPositif(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null
}

/** Pilih durasi essay efektif beserta asal nilainya. */
export function tentukanDurasiEssay(a: {
  durasiAdmin?: unknown // jadwal.essay_durasi_menit
  usulanGuru?: unknown // paket_essay.durasi_menit
}): { menit: number; sumber: SumberDurasiEssay } {
  const admin = angkaPositif(a.durasiAdmin)
  if (admin) return { menit: admin, sumber: 'ADMIN' }
  const guru = angkaPositif(a.usulanGuru)
  if (guru) return { menit: guru, sumber: 'USULAN_GURU' }
  return { menit: DURASI_ESSAY_DEFAULT_MENIT, sumber: 'DEFAULT' }
}

/**
 * Durasi essay sebuah sesi dari info_json-nya (0 kalau sesi tanpa essay).
 * Dipakai untuk menghitung waktu selesai sesi (monitoring, pengingat tutup
 * sesi, popup sesi terlupa).
 */
export function durasiEssaySesi(infoJson: unknown): number {
  const info = (infoJson ?? {}) as { essay_aktif?: unknown; essay_durasi_menit?: unknown }
  if (!info.essay_aktif) return 0
  return angkaPositif(info.essay_durasi_menit) ?? DURASI_ESSAY_DEFAULT_MENIT
}

/** Total waktu maksimum sesi: durasi PG + durasi essay (kalau ada essay). */
export function durasiTotalSesi(durasiPg: number | null | undefined, infoJson: unknown): number {
  const pg = durasiPg && durasiPg > 0 ? durasiPg : 0
  if (pg === 0) return 0 // tanpa durasi PG, pemanggil memakai default miliknya sendiri
  return pg + durasiEssaySesi(infoJson)
}

/** Teks ringkas untuk tampilan, mis. "PG 90 + Essay 30 = 120 menit". */
export function labelDurasiTotal(durasiPg: number, durasiEssay: number | null | undefined): string {
  if (!durasiEssay || durasiEssay <= 0) return `${durasiPg} menit`
  return `PG ${durasiPg} + Essay ${durasiEssay} = ${durasiPg + durasiEssay} menit`
}

/**
 * Validasi nilai durasi essay yang diisi admin di jadwal.
 * - kosong / null  -> sah, artinya "pakai usulan guru" (dikembalikan null)
 * - angka di luar batas Pengaturan -> error
 */
export function validasiDurasiEssayAdmin(
  nilai: unknown,
  batas: { min: number; max: number }
): { ok: true; nilai: number | null } | { ok: false; error: string } {
  if (nilai === null || nilai === undefined || String(nilai).trim() === '') {
    return { ok: true, nilai: null }
  }
  const n = Number(nilai)
  if (!Number.isFinite(n) || !Number.isInteger(n)) {
    return { ok: false, error: 'Durasi essay harus berupa bilangan bulat (menit).' }
  }
  if (n < batas.min || n > batas.max) {
    return { ok: false, error: `Durasi essay harus antara ${batas.min} dan ${batas.max} menit (batas di Pengaturan).` }
  }
  return { ok: true, nilai: n }
}

/** Baca batas min/maks durasi essay dari baris tabel pengaturan. */
export function bacaBatasDurasiEssay(rows: Array<{ key: string; value: string | null }> | null | undefined) {
  const map = Object.fromEntries((rows ?? []).map(r => [r.key, r.value]))
  return {
    min: Number(map.batas_durasi_essay_min_menit) || DURASI_ESSAY_MIN_DEFAULT,
    max: Number(map.batas_durasi_essay_max_menit) || DURASI_ESSAY_MAX_DEFAULT,
  }
}
