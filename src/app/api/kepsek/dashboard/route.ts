import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'

export async function GET(req: NextRequest) {
  const auth = requireRole(req, ['KEPSEK', 'GURU_KEPSEK', 'ADMIN'])
  if ('error' in auth) return auth.error

  const db = createAdminClient()

  const [
    { count: totalSiswa },
    { count: totalGuru },
    { count: totalUjian },
    { data: nilaiAll },
  ] = await Promise.all([
    db.from('siswa').select('*', { count: 'exact', head: true }).eq('status', 'AKTIF'),
    db.from('users').select('*', { count: 'exact', head: true }).eq('status', 'AKTIF'),
    db.from('nilai').select('*', { count: 'exact', head: true }),
    db.from('nilai').select('nilai, kelas, mapel_id, lulus'),
  ])

  const nums = (nilaiAll ?? []).map(n => n.nilai || 0)
  const rataRata = nums.length ? Math.round(nums.reduce((a, b) => a + b, 0) / nums.length) : 0

  // Per kelas
  const kelasAgg: Record<string, { sum: number; total: number; lulus: number }> = {}
  for (const n of (nilaiAll ?? [])) {
    const k = String(n.kelas)
    if (!kelasAgg[k]) kelasAgg[k] = { sum: 0, total: 0, lulus: 0 }
    kelasAgg[k].sum += n.nilai || 0
    kelasAgg[k].total++
    if (n.lulus) kelasAgg[k].lulus++
  }
  const nilaiPerKelas = Object.entries(kelasAgg)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([kelas, agg]) => ({
      kelas,
      rata: Math.round(agg.sum / agg.total),
      total: agg.total,
      lulus: agg.lulus,
    }))

  // Per mapel
  const mapelAgg: Record<string, { sum: number; total: number }> = {}
  for (const n of (nilaiAll ?? [])) {
    if (!n.mapel_id) continue
    if (!mapelAgg[n.mapel_id]) mapelAgg[n.mapel_id] = { sum: 0, total: 0 }
    mapelAgg[n.mapel_id].sum += n.nilai || 0
    mapelAgg[n.mapel_id].total++
  }

  const mapelIds = Object.keys(mapelAgg)
  const { data: mapelList } = await db.from('mapel').select('id, nama').in('id', mapelIds.length ? mapelIds : ['__'])
  const mapelMap = Object.fromEntries((mapelList ?? []).map(m => [m.id, m.nama]))

  const nilaiPerMapel = Object.entries(mapelAgg)
    .sort((a, b) => b[1].total - a[1].total)
    .slice(0, 15)
    .map(([id, agg]) => ({
      nama: mapelMap[id] ?? id,
      rata: Math.round(agg.sum / agg.total),
      total: agg.total,
    }))

  return NextResponse.json({
    stats: { totalSiswa: totalSiswa ?? 0, totalGuru: totalGuru ?? 0, totalUjian: totalUjian ?? 0, rataRata },
    nilaiPerKelas,
    nilaiPerMapel,
  })
}
