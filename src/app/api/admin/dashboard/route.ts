import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'
import { cachedFetch } from '@/lib/cache'

async function fetchDashboardData() {
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
  type NilaiRow = { nis: string; nilai: number; grade: string; lulus: boolean; timestamp: string; mapel_id: string; kelas: string }
  const nilaiRows = (recentNilai ?? []) as NilaiRow[]
  const nisSet   = [...new Set(nilaiRows.map(r => r.nis))]
  const mapelSet = [...new Set(nilaiRows.map(r => r.mapel_id))]
  const [{ data: siswaNames }, { data: mapelNames }] = await Promise.all([
    db.from('siswa').select('nis, nama').in('nis', nisSet),
    db.from('mapel').select('id, nama').in('id', mapelSet),
  ])
  const siswaMap = Object.fromEntries(
    ((siswaNames ?? []) as { nis: string; nama: string }[]).map(s => [s.nis, s.nama])
  )
  const mapelMap = Object.fromEntries(
    ((mapelNames ?? []) as { id: string; nama: string }[]).map(m => [m.id, m.nama])
  )

  const enrichedNilai = nilaiRows.map(r => ({
    ...r,
    nama_siswa: siswaMap[r.nis] ?? r.nis,
    nama_mapel: mapelMap[r.mapel_id] ?? r.mapel_id,
  }))

  const nilaiPerMapel = nilaiPerMapelRaw.map(x => ({
    nama: mapelMap[x.mapel_id] ?? x.mapel_id,
    rata: x.rata,
    total: x.total,
  }))

  return {
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
  }
}

export async function GET(req: NextRequest) {
  const auth = requireRole(req, ['ADMIN'])
  if ('error' in auth) return auth.error

  // Cache 30 dtk — dashboard tidak perlu real-time tiap detik.
  // Hemat 9+ query DB per refresh yang sering terjadi saat admin buka halaman berulang.
  const data = await cachedFetch('admin:dashboard', 30, fetchDashboardData)
  return NextResponse.json(data)
}
