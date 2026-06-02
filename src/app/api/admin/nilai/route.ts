import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'

export async function GET(req: NextRequest) {
  const auth = requireRole(req, ['ADMIN', 'KEPSEK', 'GURU_KEPSEK'])
  if ('error' in auth) return auth.error

  const db = createAdminClient()
  const { searchParams } = new URL(req.url)
  const mapelId = searchParams.get('mapel_id')
  const kelasId = searchParams.get('kelas')
  const page = parseInt(searchParams.get('page') ?? '1')
  const perPage = parseInt(searchParams.get('per_page') ?? '50')

  let query = db
    .from('nilai')
    .select('*', { count: 'exact' })
    .order('timestamp', { ascending: false })

  if (mapelId) query = query.eq('mapel_id', mapelId)
  if (kelasId) query = query.eq('kelas', kelasId)

  const from = (page - 1) * perPage
  query = query.range(from, from + perPage - 1)

  const { data, count, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  if (!data || data.length === 0) return NextResponse.json({ data: [], total: 0 })

  // Enrich with names
  const nisSet = [...new Set(data.map(r => r.nis))]
  const mapelSet = [...new Set(data.map(r => r.mapel_id).filter(Boolean))]

  const [{ data: siswaList }, { data: mapelList }] = await Promise.all([
    db.from('siswa').select('nis, nama').in('nis', nisSet),
    db.from('mapel').select('id, nama').in('id', mapelSet),
  ])

  const siswaMap = Object.fromEntries((siswaList ?? []).map(s => [s.nis, s.nama]))
  const mapelMap = Object.fromEntries((mapelList ?? []).map(m => [m.id, m.nama]))

  const enriched = data.map(r => ({
    ...r,
    nama_siswa: siswaMap[r.nis] ?? r.nis,
    nama_mapel: mapelMap[r.mapel_id] ?? r.mapel_id,
  }))

  return NextResponse.json({ data: enriched, total: count ?? 0 })
}
