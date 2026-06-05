import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'
import { generateId } from '@/lib/utils'

function generateKodeSesi7(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let code = ''
  for (let i = 0; i < 7; i++) {
    code += chars[Math.floor(Math.random() * chars.length)]
  }
  return code
}

export async function GET(req: NextRequest) {
  const auth = requireRole(req, ['GURU'])
  if ('error' in auth) return auth.error
  const { user } = auth

  const db = createAdminClient()

  // Ambil jadwal hari ini — gunakan gte/lte agar cover format DATE maupun TIMESTAMPTZ
  const today = new Date().toISOString().slice(0, 10)
  const todayStart = `${today}T00:00:00`
  const todayEnd   = `${today}T23:59:59`

  const { data: jadwalList, error } = await db
    .from('jadwal')
    .select('*')
    .eq('pengawas', user.username)
    .or(`tanggal.eq.${today},and(tanggal.gte.${todayStart},tanggal.lte.${todayEnd})`)
    .order('sesi')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!jadwalList?.length) return NextResponse.json({ data: [], sesiAktif: [] })

  // Enrich nama mapel & kelas
  const mapelIds = [...new Set(jadwalList.map(j => j.mapel_id).filter(Boolean))]
  const kelasIds = [...new Set(jadwalList.map(j => j.kelas).filter(Boolean))]
  const [{ data: mapelList }, { data: kelasList }] = await Promise.all([
    db.from('mapel').select('id, nama').in('id', mapelIds),
    db.from('kelas').select('id, nama').in('id', kelasIds),
  ])
  const mapelMap = Object.fromEntries((mapelList ?? []).map(m => [m.id, m.nama]))
  const kelasMap = Object.fromEntries((kelasList ?? []).map(k => [k.id, k.nama]))

  // Ambil sesi aktif yang terkait jadwal hari ini
  const jadwalIds = jadwalList.map(j => j.id)
  const { data: sesiList } = await db
    .from('sesi_ujian')
    .select('*')
    .in('jadwal_id', jadwalIds)

  // Ambil jumlah peserta & selesai dari siswa_ujian (data live, lebih akurat dari jumlah_peserta)
  const sesiIds = (sesiList ?? []).map(s => s.id)
  let siswaUjianMap: Record<string, { total: number; selesai: number }> = {}
  if (sesiIds.length > 0) {
    const { data: siswaUjianList } = await db
      .from('siswa_ujian')
      .select('sesi_id, status')
      .in('sesi_id', sesiIds)

    for (const su of siswaUjianList ?? []) {
      if (!siswaUjianMap[su.sesi_id]) siswaUjianMap[su.sesi_id] = { total: 0, selesai: 0 }
      siswaUjianMap[su.sesi_id].total++
      if (su.status === 'SELESAI') siswaUjianMap[su.sesi_id].selesai++
    }
  }

  const enrichedJadwal = jadwalList.map(j => {
    const sesiTerkait = (sesiList ?? []).find(s => s.jadwal_id === j.id)
    // Sinkronkan status jadwal dengan status sesi aktual
    let status = j.status
    if (sesiTerkait?.status === 'BERJALAN') status = 'BERJALAN'
    if (sesiTerkait?.status === 'SELESAI' && status !== 'BERJALAN') status = 'SELESAI'

    return {
      ...j,
      tanggal: j.tanggal?.slice(0, 10) ?? j.tanggal,
      status,
      nama_mapel: mapelMap[j.mapel_id] ?? j.mapel_id,
      nama_kelas: kelasMap[j.kelas] ?? j.kelas,
      sesi_ujian: sesiTerkait ? {
        ...sesiTerkait,
        jumlah_peserta: siswaUjianMap[sesiTerkait.id]?.total ?? sesiTerkait.jumlah_peserta ?? 0,
        jumlah_selesai: siswaUjianMap[sesiTerkait.id]?.selesai ?? 0,
      } : null,
    }
  })

  return NextResponse.json({ data: enrichedJadwal })
}

export async function POST(req: NextRequest) {
  const auth = requireRole(req, ['GURU'])
  if ('error' in auth) return auth.error
  const { user } = auth

  const db = createAdminClient()
  const { jadwalId } = await req.json()

  // Verify jadwal belongs to this guru as pengawas
  const { data: jadwal } = await db
    .from('jadwal')
    .select('*')
    .eq('id', jadwalId)
    .eq('pengawas', user.username)
    .single()

  if (!jadwal) return NextResponse.json({ error: 'Jadwal tidak ditemukan atau Anda bukan pengawas' }, { status: 404 })

  // Cek apakah sesi sudah ada & berjalan
  const { data: existingSesi } = await db
    .from('sesi_ujian')
    .select('id, kode_sesi')
    .eq('jadwal_id', jadwalId)
    .eq('status', 'BERJALAN')
    .single()

  if (existingSesi) {
    return NextResponse.json({
      message: 'Sesi sudah berjalan',
      sesiId: existingSesi.id,
      kodeSesi: existingSesi.kode_sesi,
      sudahAda: true,
    })
  }

  const sesiId = generateId('SES')
  const kodeSesi = generateKodeSesi7()

  const { error } = await db.from('sesi_ujian').insert({
    id: sesiId,
    jadwal_id: jadwalId,
    mapel_id: jadwal.mapel_id,
    kelas: String(jadwal.kelas),
    durasi: jadwal.durasi,
    kode_sesi: kodeSesi,
    status: 'BERJALAN',
    waktu_mulai: new Date().toISOString(),
    jumlah_peserta: 0,
  })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await db.from('jadwal').update({ status: 'BERJALAN' }).eq('id', jadwalId)

  return NextResponse.json({ message: 'Sesi berhasil dibuka', sesiId, kodeSesi }, { status: 201 })
}
