// /api/pengawas/jadwal/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'

export async function GET(req: NextRequest) {
  const auth = requireRole(req, ['PENGAWAS', 'GURU_KEPSEK', 'ADMIN'])
  if ('error' in auth) return auth.error
  const { user } = auth

  const db = createAdminClient()

  let query = db
    .from('jadwal')
    .select('*')
    .in('status', ['AKTIF', 'BERJALAN'])
    .order('tanggal', { ascending: true })
    .order('jam_mulai')

  // Pengawas only sees their own jadwal
  if (user.role === 'PENGAWAS') {
    query = query.eq('pengawas', user.username)
  }

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  if (!data?.length) return NextResponse.json({ data: [] })

  const mapelIds = [...new Set(data.map(j => j.mapel_id).filter(Boolean))]
  const { data: mapelList } = await db.from('mapel').select('id, nama').in('id', mapelIds)
  const mapelMap = Object.fromEntries((mapelList ?? []).map(m => [m.id, m.nama]))

  return NextResponse.json({ data: data.map(j => ({ ...j, nama_mapel: mapelMap[j.mapel_id] ?? j.mapel_id })) })
}
