import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'

export async function GET(req: NextRequest) {
  const auth = requireRole(req, ['GURU', 'GURU_KEPSEK'])
  if ('error' in auth) return auth.error
  const { user } = auth

  const db = createAdminClient()
  const { searchParams } = new URL(req.url)
  const filterMapel = searchParams.get('mapel_id') ?? ''
  const filterKelas = searchParams.get('kelas') ?? ''

  // Ambil mapel yang diajar guru ini
  const { data: guruMapel } = await db
    .from('mapel')
    .select('id, nama')
    .eq('guru_id', user.username)

  const mapelIds = (guruMapel ?? []).map(m => m.id)
  if (!mapelIds.length) return NextResponse.json({ data: [], stats: null, mapelList: [] })

  let query = db
    .from('nilai')
    .select('*')
    .in('mapel_id', mapelIds)
    .order('timestamp', { ascending: false })

  if (filterMapel) query = query.eq('mapel_id', filterMapel)
  if (filterKelas) query = query.eq('kelas', filterKelas)

  const { data: nilaiData, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!nilaiData?.length) return NextResponse.json({ data: [], stats: null, mapelList: guruMapel })

  // Enrich dengan nama siswa
  const nisSet = [...new Set(nilaiData.map(r => r.nis))]
  const { data: siswaList } = await db.from('siswa').select('nis, nama').in('nis', nisSet)
  const siswaMap = Object.fromEntries((siswaList ?? []).map(s => [s.nis, s.nama]))
  const mapelMap = Object.fromEntries((guruMapel ?? []).map(m => [m.id, m.nama]))

  const enriched = nilaiData.map(r => ({
    ...r,
    nama_siswa: siswaMap[r.nis] ?? r.nis,
    nama_mapel: mapelMap[r.mapel_id] ?? r.mapel_id,
  }))

  // Stats
  const vals = enriched.map(r => r.nilai)
  const stats = {
    total: enriched.length,
    rataRata: vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : 0,
    tertinggi: vals.length ? Math.max(...vals) : 0,
    terendah: vals.length ? Math.min(...vals) : 0,
    lulus: enriched.filter(r => r.lulus).length,
    tidakLulus: enriched.filter(r => !r.lulus).length,
  }

  return NextResponse.json({ data: enriched, stats, mapelList: guruMapel })
}
