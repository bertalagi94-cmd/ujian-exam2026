import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'

export async function GET(req: NextRequest) {
  const auth = requireRole(req, ['ADMIN'])
  if ('error' in auth) return auth.error

  const db = createAdminClient()

  const [
    { count: totalSiswa },
    { count: totalGuru },
    { count: totalSoal },
    { count: totalNilai },
    { count: totalMapel },
    { count: jadwalAktif },
    { count: paketMenunggu },
    { data: nilaiAll },
    { data: recentNilai },
    { data: nilaiMapel },
  ] = await Promise.all([
    db.from('siswa').select('*', { count: 'exact', head: true }).eq('status', 'AKTIF').neq('is_tester', 'YES'),
    db.from('users').select('*', { count: 'exact', head: true }).eq('status', 'AKTIF').neq('is_tester', 'YES'),
    db.from('soal').select('*', { count: 'exact', head: true }).eq('status', 'DISETUJUI'),
    db.from('nilai').select('*', { count: 'exact', head: true }),
    db.from('mapel').select('*', { count: 'exact', head: true }),
    db.from('jadwal').select('*', { count: 'exact', head: true }).eq('status', 'AKTIF'),
    db.from('paket_soal').select('*', { count: 'exact', head: true }).eq('status', 'MENUNGGU'),
    db.from('nilai').select('nilai'),
    db.from('nilai').select('nis, nilai, grade, lulus, timestamp, mapel_id, kelas').order('timestamp', { ascending: false }).limit(20),
    db.from('nilai').select('mapel_id, nilai').not('nilai', 'is', null),
  ])

  const rataRataNilai = nilaiAll?.length
    ? Math.round((nilaiAll as { nilai: number }[]).reduce((s, r) => s + (r.nilai || 0), 0) / nilaiAll.length)
    : 0

  // Enrich recent nilai with names
  const nisSet = [...new Set((recentNilai ?? []).map(r => r.nis))]
  const mapelSet = [...new Set((recentNilai ?? []).map(r => r.mapel_id))]
  const [{ data: siswaNames }, { data: mapelNames }] = await Promise.all([
    db.from('siswa').select('nis, nama').in('nis', nisSet),
    db.from('mapel').select('id, nama').in('id', mapelSet),
  ])
  const siswaMap = Object.fromEntries((siswaNames ?? []).map(s => [s.nis, s.nama]))
  const mapelMap = Object.fromEntries((mapelNames ?? []).map(m => [m.id, m.nama]))

  const enrichedNilai = (recentNilai ?? []).map(r => ({
    ...r,
    nama_siswa: siswaMap[r.nis] ?? r.nis,
    nama_mapel: mapelMap[r.mapel_id] ?? r.mapel_id,
  }))

  // Aggregate nilai per mapel
  const mapelAgg: Record<string, { total: number; sum: number }> = {}
  for (const r of (nilaiMapel ?? []) as { mapel_id: string; nilai: number }[]) {
    if (!mapelAgg[r.mapel_id]) mapelAgg[r.mapel_id] = { total: 0, sum: 0 }
    mapelAgg[r.mapel_id].total++
    mapelAgg[r.mapel_id].sum += r.nilai || 0
  }
  const nilaiPerMapel = await Promise.all(
    Object.entries(mapelAgg)
      .sort((a, b) => b[1].total - a[1].total)
      .slice(0, 10)
      .map(async ([id, agg]) => ({
        nama: mapelMap[id] ?? id,
        rata: Math.round(agg.sum / agg.total),
        total: agg.total,
      }))
  )

  return NextResponse.json({
    stats: {
      totalSiswa: totalSiswa ?? 0,
      totalGuru: totalGuru ?? 0,
      totalSoal: totalSoal ?? 0,
      totalNilai: totalNilai ?? 0,
      totalMapel: totalMapel ?? 0,
      jadwalAktif: jadwalAktif ?? 0,
      paketMenunggu: paketMenunggu ?? 0,
      rataRataNilai,
    },
    recentNilai: enrichedNilai,
    nilaiPerMapel,
  })
}
