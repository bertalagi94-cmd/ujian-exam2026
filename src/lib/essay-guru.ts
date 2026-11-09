// Saklar "Nonaktifkan pengisian soal essay oleh guru" (diatur admin).
//
// Untuk sekolah yang tidak menyelenggarakan ujian essay. Disimpan di tabel
// `pengaturan` (key/value per yayasan), jadi TIDAK butuh migrasi database:
//
//   key   = 'essayGuruNonaktif'
//   value = 'true'  -> guru TIDAK bisa membuat / mengisi / mengirim soal essay
//           lainnya (atau key belum ada) -> perilaku lama, essay bebas dipakai
//
// Yang diblokir (di server, bukan hanya di tampilan): membuat paket essay,
// mengubah paket, menambah/mengedit/mengimpor soal essay, menduplikasi paket,
// dan mengirim paket essay (termasuk ikut terkirim bersama paket PG).
// Yang TIDAK diblokir: melihat, menghapus, dan menarik paket essay yang sudah
// ada, serta seluruh alur ujian/koreksi essay yang sudah berjalan.

import { NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'

export const KUNCI_ESSAY_GURU_NONAKTIF = 'essayGuruNonaktif'

/** Pesan untuk guru (dipakai di kartu terkunci dan respons API). */
export const PESAN_ESSAY_NONAKTIF =
  'Sekolah ini tidak menyelenggarakan ujian essay, jadi pengisian soal essay dinonaktifkan oleh admin.'

export const essayNonaktifDariNilai = (v: string | null | undefined): boolean =>
  String(v ?? '').trim().toLowerCase() === 'true'

/**
 * true = admin sudah menonaktifkan pengisian soal essay untuk yayasan ini.
 * Gagal membaca database -> false (fail-open): gangguan sesaat tidak boleh
 * membuat guru terkunci dari fitur yang normalnya aktif.
 */
export async function essayGuruNonaktif(db: SupabaseClient): Promise<boolean> {
  try {
    const { data } = await db
      .from('pengaturan')
      .select('value')
      .eq('key', KUNCI_ESSAY_GURU_NONAKTIF)
      .maybeSingle()
    return essayNonaktifDariNilai((data as { value?: string } | null)?.value)
  } catch {
    return false
  }
}

/**
 * Pakai di awal handler API guru yang MENULIS data essay:
 *   const blok = await tolakJikaEssayNonaktif(db)
 *   if (blok) return blok
 */
export async function tolakJikaEssayNonaktif(db: SupabaseClient): Promise<NextResponse | null> {
  if (await essayGuruNonaktif(db)) {
    return NextResponse.json({ error: PESAN_ESSAY_NONAKTIF, kode: 'ESSAY_NONAKTIF' }, { status: 403 })
  }
  return null
}
