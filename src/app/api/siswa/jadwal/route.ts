import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'

export async function GET(req: NextRequest) {
  const auth = requireRole(req, ['SISWA'])
  if ('error' in auth) return auth.error
  const { user } = auth

  const db = createAdminClient()
  const { data, error } = await db
    .from('jadwal')
    .select('*')
    .eq('kelas', user.kelas!)
    .order('tanggal', { ascending: false })
    .limit(30)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  if (!data?.length) return NextResponse.json({ data: [] })

  const mapelIds = [...new Set(data.map(j => j.mapel_id).filter(Boolean))]
  const { data: mapelList } = await db.from('mapel').select('id, nama').in('id', mapelIds)
  const mapelMap = Object.fromEntries((mapelList ?? []).map(m => [m.id, m.nama]))

  return NextResponse.json({
    data: data.map(j => ({ ...j, nama_mapel: mapelMap[j.mapel_id] ?? j.mapel_id }))
  })
}
