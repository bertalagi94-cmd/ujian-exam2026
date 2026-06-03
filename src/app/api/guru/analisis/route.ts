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

  // Ambil semua soal guru ini yang sudah DISETUJUI
  let soalQuery = db
    .from('soal')
    .select('id, teks, mapel_id, kelas_id, tingkat, kunci, paket_id')
    .eq('guru_id', user.username)
    .eq('status', 'DISETUJUI')

  if (filterMapel) soalQuery = soalQuery.eq('mapel_id', filterMapel)

  const { data: soalList, error } = await soalQuery
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!soalList?.length) {
    const { data: mapelGuru } = await db.from('mapel').select('id, nama').eq('guru_id', user.username)
    return NextResponse.json({ data: [], mapelList: mapelGuru ?? [] })
  }

  const soalIds = soalList.map(s => s.id)

  // Ambil semua jawaban untuk soal ini
  const { data: jawabanAll } = await db
    .from('jawaban')
    .select('soal_id, jawaban')
    .in('soal_id', soalIds)

  // Hitung statistik per soal
  const jawabanBySoal: Record<string, string[]> = {}
  for (const j of jawabanAll ?? []) {
    if (!jawabanBySoal[j.soal_id]) jawabanBySoal[j.soal_id] = []
    if (j.jawaban) jawabanBySoal[j.soal_id].push(j.jawaban)
  }

  const analisis = soalList.map(soal => {
    const jawaban = jawabanBySoal[soal.id] ?? []
    const totalDijawab = jawaban.length
    const benar = jawaban.filter(j => j === soal.kunci).length
    const tingkatKesulitanAktual = totalDijawab > 0 ? Math.round((benar / totalDijawab) * 100) : null

    // Distribusi pilihan
    const distribusi: Record<string, number> = { A: 0, B: 0, C: 0, D: 0, E: 0 }
    for (const j of jawaban) {
      if (distribusi[j] !== undefined) distribusi[j]++
    }

    return {
      id: soal.id,
      teks: soal.teks.length > 80 ? soal.teks.slice(0, 80) + '...' : soal.teks,
      mapel_id: soal.mapel_id,
      tingkat: soal.tingkat,
      kunci: soal.kunci,
      totalDijawab,
      benar,
      persenBenar: tingkatKesulitanAktual,
      distribusi,
    }
  })

  // Mapel list guru
  const mapelIds = [...new Set(soalList.map(s => s.mapel_id).filter(Boolean))]
  const { data: mapelList } = await db.from('mapel').select('id, nama').eq('guru_id', user.username)
  const mapelMap = Object.fromEntries((mapelList ?? []).map(m => [m.id, m.nama]))

  const enriched = analisis.map(a => ({ ...a, nama_mapel: mapelMap[a.mapel_id] ?? a.mapel_id }))

  // Ringkasan
  const dijawab = enriched.filter(a => a.totalDijawab > 0)
  const ringkasan = {
    totalSoal: enriched.length,
    soalPernahDijawab: dijawab.length,
    rataPersenBenar: dijawab.length
      ? Math.round(dijawab.reduce((s, a) => s + (a.persenBenar ?? 0), 0) / dijawab.length)
      : 0,
    soalMudah: dijawab.filter(a => (a.persenBenar ?? 0) >= 70).length,
    soalSedang: dijawab.filter(a => (a.persenBenar ?? 0) >= 40 && (a.persenBenar ?? 0) < 70).length,
    soalSulit: dijawab.filter(a => (a.persenBenar ?? 0) < 40).length,
  }

  return NextResponse.json({ data: enriched, mapelList: mapelList ?? [], ringkasan })
}
