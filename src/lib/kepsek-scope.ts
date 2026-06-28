/**
 * Helper untuk mendapatkan daftar kelas yang boleh dilihat Kepsek,
 * berdasarkan sekolah_id yang tersimpan di akun Kepsek.
 * 
 * Kalau Kepsek tidak punya sekolah_id (belum diset admin),
 * kembalikan array kosong dan flag noScope=true agar API bisa
 * memberikan respons yang tepat.
 */
import { createAdminClient } from '@/lib/supabase'

export interface KepsekScope {
  kelasList: string[]   // nama-nama kelas yang boleh diakses
  sekolahId: string | null
  noScope: boolean      // true = kepsek belum diset sekolahnya
}

export async function getKepsekScope(username: string): Promise<KepsekScope> {
  const db = createAdminClient()

  // 1. Ambil sekolah_id milik kepsek ini
  const { data: userRow } = await db
    .from('users')
    .select('sekolah_id')
    .eq('username', username)
    .maybeSingle()

  const sekolahId = userRow?.sekolah_id ?? null

  if (!sekolahId) {
    return { kelasList: [], sekolahId: null, noScope: true }
  }

  // 2. Ambil semua kelas yang terikat ke sekolah ini
  const { data: kelasRows } = await db
    .from('kelas')
    .select('nama')
    .eq('sekolah_id', sekolahId)

  const kelasList = (kelasRows ?? []).map(k => k.nama)

  return { kelasList, sekolahId, noScope: false }
}
