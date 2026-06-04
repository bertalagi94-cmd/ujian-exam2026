import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'

export async function GET(req: NextRequest) {
  const auth = requireRole(req, ['GURU'])
  if ('error' in auth) return auth.error
  const { user } = auth

  const db = createAdminClient()

  // Ambil semua jadwal yang pengawasnya adalah guru ini
  const { data: jadwalList, error } = await db
    .from('jadwal')
    .select('*')
    .eq('pengawas', user.username)
    .order('tanggal', { ascending: true })
    .order('sesi')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!jadwalList?.length) return NextResponse.json({ data: [] })

  // Enrich dengan nama mapel dan nama kelas
  const mapelIds = [...new Set(jadwalList.map(j => j.mapel_id).filter(Boolean))]
  const kelasIds = [...new Set(jadwalList.map(j => j.kelas).filter(Boolean))]

  const [{ data: mapelList }, { data: kelasList }] = await Promise.all([
    db.from('mapel').select('id, nama').in('id', mapelIds),
    db.from('kelas').select('id, nama').in('id', kelasIds),
  ])

  const mapelMap = Object.fromEntries((mapelList ?? []).map(m => [m.id, m.nama]))
  const kelasMap = Object.fromEntries((kelasList ?? []).map(k => [k.id, k.nama]))

  const enriched = jadwalList.map(j => ({
    ...j,
    nama_mapel: mapelMap[j.mapel_id] ?? j.mapel_id,
    nama_kelas: kelasMap[j.kelas] ?? j.kelas,
  }))

  return NextResponse.json({ data: enriched, hasJadwal: enriched.length > 0 })
}
