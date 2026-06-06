import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'

export async function GET(req: NextRequest) {
  const auth = requireRole(req, ['ADMIN'])
  if ('error' in auth) return auth.error

  const db = createAdminClient()

  // Semua query paralel, termasuk stats agregat via RPC (tidak tarik semua baris)
  const [
    { count: totalSiswa },
    { count: totalGuru },
    { count: totalSoal },
    { count: totalNilai },
    { count: totalMapel },
    { count: jadwalAktif },
    { count: paketMenunggu },
    { data: statsData },                    // rata-rata + per-mapel dihitung di DB
    { data: recentNilai },
  ] = await Promise.all([
    db.from('siswa').select('*', { count: 'exact', head: true }).eq('status', 'AKTIF').neq('is_tester', 'YES'),
    db.from('users').select('*', { count: 'exact', head: true }).eq('status', 'AKTIF').neq('is_tester', 'YES'),
    db.from('soal').select('*', { count: 'exact', head: true }).eq('status', 'DISETUJUI'),
    db.from('nilai').select('*', { count: 'exact', head: true }),
    db.from('mapel').select('*', { count: 'exact', head: true }),
    db.from('jadwal').select('*', { count: 'exact', head: true }).eq('status', 'AKTIF'),
    db.from('paket_soal').select('*', { count: 'exact', head: true }).eq('status', 'MENUNGGU'),
    db.rpc('get_dashboard_stats'),          // AVG & GROUP BY jalan di PostgreSQL
    db.from('nilai')
      .select('nis, nilai, grade, lulus, timestamp, mapel_id, kelas')
      .order('timestamp', { ascending: false })
      .limit(20),
  ])

  const stats = (statsData as { rata_rata_nilai: number; nilai_per_mapel: { mapel_id: string; rata: number; total: number }[] } | null)
  const rataRataNilai = stats?.rata_rata_nilai ?? 0
  const nilaiPerMapelRaw = stats?.nilai_per_mapel ?? []

  // Enrich recent nilai dengan nama siswa & mapel
  const nisSet   = [...new Set((recentNilai ?? []).map(r => r.nis))]
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

  const nilaiPerMapel = nilaiPerMapelRaw.map(x => ({
    nama: mapelMap[x.mapel_id] ?? x.mapel_id,
    rata: x.rata,
    total: x.total,
  }))

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
