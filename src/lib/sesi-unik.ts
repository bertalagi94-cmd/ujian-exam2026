// src/lib/sesi-unik.ts
//
// Penjaga "satu sesi BERJALAN per jadwal" di level database (migrasi 37:
// partial unique index uq_sesi_berjalan_per_jadwal).
//
// Tiga route membuat sesi_ujian BERJALAN (guru/mode-pengawas, guru/susulan,
// admin/susulan). Semuanya mengecek dulu "sudah ada sesi BERJALAN?" lalu
// insert. Dua request yang nyaris bersamaan bisa sama-sama lolos cek itu;
// index di database memastikan hanya SATU yang berhasil insert, dan yang
// kalah mendapat error unique_violation (SQLSTATE 23505). Helper ini
// mengenali error tersebut supaya route bisa mengembalikan sesi yang sudah
// ada, bukan error 500.

export interface PgErrorLike {
  code?: string | null
  message?: string | null
  details?: string | null
}

/**
 * true kalau error insert sesi_ujian adalah tabrakan "sesi BERJALAN untuk
 * jadwal ini sudah ada". Tabrakan pada kolom kode_sesi (kode acak kebetulan
 * sama) BUKAN termasuk — itu kasus berbeda dan tetap diperlakukan sebagai
 * error biasa.
 */
export function isKonflikSesiBerjalan(err: PgErrorLike | null | undefined): boolean {
  if (!err || err.code !== '23505') return false
  const teks = `${err.message ?? ''} ${err.details ?? ''}`
  return !teks.includes('kode_sesi')
}
