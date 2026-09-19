import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { getTokenFromRequest } from '@/lib/auth'

// POST /api/auth/lihat-sebagai/ping
// Dipanggil banner admin tiap 30 detik selama mode Lihat-sebagai atas SISWA
// aktif: menyegarkan penanda "sedang dipantau" (src/lib/dipantau.ts). Sengaja
// TIDAK memakai requireRole (token viewAs memang ditolak untuk POST); token
// tetap diverifikasi penuh, jadi token kedaluwarsa (2 jam) otomatis ditolak
// dan penanda ikut mati. Efeknya hanya menyentuh 1 baris penanda miliknya.
export async function POST(req: NextRequest) {
  const user = getTokenFromRequest(req)
  if (!user?.viewAs || !user.viewAsSid) {
    return NextResponse.json({ error: 'Bukan sesi Lihat-sebagai siswa' }, { status: 400 })
  }
  const { error } = await createAdminClient()
    .from('log_aktivitas')
    .update({ created_at: new Date().toISOString() })
    .eq('id', user.viewAsSid)
    .eq('aksi', 'DIPANTAU_MULAI')
  if (error) {
    console.error('Gagal ping dipantau:', error)
    return NextResponse.json({ error: 'Gagal' }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}
