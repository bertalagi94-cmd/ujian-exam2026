import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'

export async function GET(req: NextRequest) {
  const auth = requireRole(req, ['GURU', 'GURU_KEPSEK'])
  if ('error' in auth) return auth.error
  const { user } = auth

  const db = createAdminClient()
  const guruId = user.username

  const [
    { count: totalSoal },
    { count: soalDisetujui },
    { count: soalMenunggu },
    { count: soalDitolak },
    { count: totalPaket },
    { data: paketTerbaru },
  ] = await Promise.all([
    db.from('soal').select('*', { count: 'exact', head: true }).eq('guru_id', guruId),
    db.from('soal').select('*', { count: 'exact', head: true }).eq('guru_id', guruId).eq('status', 'DISETUJUI'),
    db.from('soal').select('*', { count: 'exact', head: true }).eq('guru_id', guruId).eq('status', 'MENUNGGU'),
    db.from('soal').select('*', { count: 'exact', head: true }).eq('guru_id', guruId).eq('status', 'DITOLAK'),
    db.from('paket_soal').select('*', { count: 'exact', head: true }).eq('guru_id', guruId),
    db.from('paket_soal').select('*').eq('guru_id', guruId).order('tanggal', { ascending: false }).limit(5),
  ])

  // Enrich paket with mapel & kelas names
  const mapelIds = [...new Set((paketTerbaru ?? []).map(p => p.mapel_id).filter(Boolean))]
  const kelasIds = [...new Set((paketTerbaru ?? []).map(p => p.kelas_id).filter(Boolean))]
  const [{ data: mapelList }, { data: kelasList }] = await Promise.all([
    db.from('mapel').select('id, nama').in('id', mapelIds),
    db.from('kelas').select('id, nama').in('id', kelasIds),
  ])
  const mapelMap = Object.fromEntries((mapelList ?? []).map(m => [m.id, m.nama]))
  const kelasMap = Object.fromEntries((kelasList ?? []).map(k => [k.id, String(k.nama)]))

  const enrichedPaket = (paketTerbaru ?? []).map(p => ({
    ...p,
    nama_mapel: mapelMap[p.mapel_id] ?? p.mapel_id,
    nama_kelas: kelasMap[p.kelas_id] ?? p.kelas_id,
  }))

  // Get nilai for mapels taught by this guru
  const { data: guruMapel } = await db.from('mapel').select('id').eq('guru_id', guruId)
  const mapelGuruIds = (guruMapel ?? []).map(m => m.id)

  const { data: nilaiAll } = await db
    .from('nilai')
    .select('nilai, nis, mapel_id, grade, kelas, timestamp')
    .in('mapel_id', mapelGuruIds.length ? mapelGuruIds : ['__none__'])
    .order('timestamp', { ascending: false })
    .limit(50)

  const rataRataNilai = nilaiAll?.length
    ? Math.round((nilaiAll as { nilai: number }[]).reduce((s, r) => s + (r.nilai || 0), 0) / nilaiAll.length)
    : 0

  // Enrich recent nilai
  const recent = (nilaiAll ?? []).slice(0, 8)
  const nisSet = [...new Set(recent.map(r => r.nis))]
  const { data: siswaList } = await db.from('siswa').select('nis, nama').in('nis', nisSet)
  const siswaMap = Object.fromEntries((siswaList ?? []).map(s => [s.nis, s.nama]))

  const nilaiTerbaru = recent.map(r => ({
    ...r,
    nama_siswa: siswaMap[r.nis] ?? r.nis,
    nama_mapel: mapelMap[r.mapel_id] ?? r.mapel_id,
  }))

  return NextResponse.json({
    stats: {
      totalSoal: totalSoal ?? 0,
      soalDisetujui: soalDisetujui ?? 0,
      soalMenunggu: soalMenunggu ?? 0,
      soalDitolak: soalDitolak ?? 0,
      totalPaket: totalPaket ?? 0,
      totalNilai: nilaiAll?.length ?? 0,
      rataRataNilai,
    },
    paketTerbaru: enrichedPaket,
    nilaiTerbaru,
  })
}
