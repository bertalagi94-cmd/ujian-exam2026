import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'

const LIMIT = 20

export async function GET(req: NextRequest) {
  const auth = requireRole(req, ['ADMIN', 'SISWA'])
  if ('error' in auth) return auth.error
  const { user } = auth

  const { searchParams } = new URL(req.url)
  const nis = searchParams.get('nis')
  const sesiId = searchParams.get('sesiId')
  if (!nis || !sesiId) {
    return NextResponse.json({ error: 'nis dan sesiId wajib diisi' }, { status: 400 })
  }

  const db = createAdminClient()
  let query = db.from('live_screen_signal')
    .select('id, type, payload, admin_username, created_at')
    .eq('nis', nis)
    .eq('sesi_id', sesiId)
    .order('created_at', { ascending: true })
    .limit(LIMIT)

  if (user.role === 'ADMIN') {
    // Admin cuma boleh lihat pesan yang ditujukan buat DIA SENDIRI (bukan
    // sesi "Minta layar" yang dibuka admin lain terhadap siswa yang sama).
    query = query.eq('target_role', 'ADMIN').eq('admin_username', user.username)
  } else {
    if (nis !== user.nis) {
      return NextResponse.json({ error: 'Tidak boleh membaca sinyal siswa lain' }, { status: 403 })
    }
    query = query.eq('target_role', 'SISWA')
  }

  const { data: rows, error } = await query
  if (error) {
    return NextResponse.json({ error: 'Gagal memuat sinyal' }, { status: 500 })
  }
  if (!rows?.length) {
    return NextResponse.json({ messages: [] })
  }

  // Sekali diambil, langsung dihapus (delivered-once) — tidak ada replay,
  // tidak ada riwayat yang menumpuk.
  const ids = rows.map(r => r.id)
  await db.from('live_screen_signal').delete().in('id', ids)

  const messages = rows.map((r: { id: string; type: string; payload: string | null; admin_username: string; created_at: string }) => ({
    id: r.id,
    type: r.type,
    payload: r.payload ? JSON.parse(r.payload) : null,
    adminUsername: r.admin_username,
    createdAt: r.created_at,
  }))

  return NextResponse.json({ messages })
}
