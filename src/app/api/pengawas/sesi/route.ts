import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'
import { generateId } from '@/lib/utils'

export async function GET(req: NextRequest) {
  const auth = requireRole(req, ['GURU', 'ADMIN'])
  if ('error' in auth) return auth.error

  const db = createAdminClient()
  const { searchParams } = new URL(req.url)
  const status = searchParams.get('status') ?? 'BERJALAN'

  const { data, error } = await db
    .from('sesi_ujian')
    .select('*')
    .eq('status', status)
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  if (!data?.length) return NextResponse.json({ data: [] })

  const mapelIds = [...new Set(data.map(s => s.mapel_id).filter(Boolean))]
  const { data: mapelList } = await db.from('mapel').select('id, nama').in('id', mapelIds)
  const mapelMap = Object.fromEntries((mapelList ?? []).map(m => [m.id, m.nama]))

  return NextResponse.json({
    data: data.map(s => ({ ...s, nama_mapel: mapelMap[s.mapel_id] ?? s.mapel_id }))
  })
}

export async function POST(req: NextRequest) {
  const auth = requireRole(req, ['PENGAWAS', 'ADMIN'])
  if ('error' in auth) return auth.error

  const db = createAdminClient()
  const { jadwalId, kodeSesi } = await req.json()

  // Get jadwal info
  const { data: jadwal } = await db.from('jadwal').select('*').eq('id', jadwalId).single()
  if (!jadwal) return NextResponse.json({ error: 'Jadwal tidak ditemukan' }, { status: 404 })

  // Check if sesi already exists and running
  const { data: existingSesi } = await db
    .from('sesi_ujian')
    .select('id, kode_sesi')
    .eq('jadwal_id', jadwalId)
    .eq('status', 'BERJALAN')
    .single()

  if (existingSesi) {
    return NextResponse.json({ error: 'Sesi untuk jadwal ini sudah berjalan' }, { status: 409 })
  }

  // Create new sesi
  const sesiId = generateId('SES')
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

  // Update jadwal status
  await db.from('jadwal').update({ status: 'BERJALAN' }).eq('id', jadwalId)

  return NextResponse.json({ message: 'Sesi berhasil dibuka', sesiId, kodeSesi }, { status: 201 })
}
