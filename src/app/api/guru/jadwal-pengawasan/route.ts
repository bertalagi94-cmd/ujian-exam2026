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
  if (!jadwalList?.length) return NextResponse.json({ data: [], hasJadwal: false })

  // Enrich dengan nama mapel dan nama kelas
  const mapelIds = [...new Set(jadwalList.map(j => j.mapel_id).filter(Boolean))]
  const kelasIds = [...new Set(jadwalList.map(j => j.kelas).filter(Boolean))]

  const [{ data: mapelList }, { data: kelasList }] = await Promise.all([
    db.from('mapel').select('id, nama').in('id', mapelIds),
    db.from('kelas').select('id, nama').in('id', kelasIds),
  ])

  const mapelMap = Object.fromEntries((mapelList ?? []).map(m => [m.id, m.nama]))
  const kelasMap = Object.fromEntries((kelasList ?? []).map(k => [k.id, k.nama]))

  // Cek sesi_ujian untuk jadwal hari ini agar status akurat
  const today = new Date().toISOString().slice(0, 10)
  const todayJadwalIds = jadwalList.filter(j => j.tanggal === today || j.tanggal.slice(0, 10) === today).map(j => j.id)

  let sesiMap: Record<string, { status: string }> = {}
  if (todayJadwalIds.length > 0) {
    const { data: sesiList } = await db
      .from('sesi_ujian')
      .select('jadwal_id, status')
      .in('jadwal_id', todayJadwalIds)
    sesiMap = Object.fromEntries((sesiList ?? []).map(s => [s.jadwal_id, { status: s.status }]))
  }

  const enriched = jadwalList.map(j => {
    const tanggal = j.tanggal?.slice(0, 10) ?? j.tanggal
    const isToday = tanggal === today
    // Jika ada sesi berjalan untuk jadwal ini, override status ke BERJALAN
    let status = j.status
    if (isToday && sesiMap[j.id]?.status === 'BERJALAN') status = 'BERJALAN'
    if (isToday && sesiMap[j.id]?.status === 'SELESAI') status = 'SELESAI'

    return {
      ...j,
      tanggal, // normalize to YYYY-MM-DD
      status,
      nama_mapel: mapelMap[j.mapel_id] ?? j.mapel_id,
      nama_kelas: kelasMap[j.kelas] ?? j.kelas,
    }
  })

  return NextResponse.json({ data: enriched, hasJadwal: enriched.length > 0 })
}
