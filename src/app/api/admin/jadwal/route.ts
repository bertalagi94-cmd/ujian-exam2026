import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'
import { generateId } from '@/lib/utils'

export async function GET(req: NextRequest) {
  const auth = requireRole(req, ['ADMIN', 'GURU', 'PENGAWAS', 'KEPSEK', 'SISWA'])
  if ('error' in auth) return auth.error

  const db = createAdminClient()
  const { searchParams } = new URL(req.url)
  const status = searchParams.get('status')
  const kelas = searchParams.get('kelas')

  let query = db.from('jadwal').select('*').order('tanggal', { ascending: false }).order('sesi')
  if (status) query = query.eq('status', status)
  if (kelas) query = query.eq('kelas', kelas)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  if (!data?.length) return NextResponse.json({ data: [] })

  const mapelIds = [...new Set(data.map(r => r.mapel_id).filter(Boolean))]
  const { data: mapelList } = await db.from('mapel').select('id, nama').in('id', mapelIds)
  const mapelMap = Object.fromEntries((mapelList ?? []).map(m => [m.id, m.nama]))

  const enriched = data.map(r => ({
    ...r,
    nama_mapel: mapelMap[r.mapel_id] ?? r.mapel_id,
  }))

  return NextResponse.json({ data: enriched })
}

export async function POST(req: NextRequest) {
  const auth = requireRole(req, ['ADMIN'])
  if ('error' in auth) return auth.error

  const db = createAdminClient()
  const body = await req.json()

  const { error } = await db.from('jadwal').insert({
    id: generateId('JDW'),
    tanggal: body.tanggal,
    sesi: body.sesi || 1,
    jam_mulai: body.jam_mulai,
    jam_selesai: body.jam_selesai,
    mapel_id: body.mapel_id,
    kelas: String(body.kelas),
    pengawas: body.pengawas || null,
    durasi: body.durasi || 90,
    status: 'AKTIF',
  })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ message: 'Jadwal berhasil ditambahkan' }, { status: 201 })
}

export async function PUT(req: NextRequest) {
  const auth = requireRole(req, ['ADMIN'])
  if ('error' in auth) return auth.error

  const db = createAdminClient()
  const { id, ...update } = await req.json()

  const { error } = await db.from('jadwal').update(update).eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ message: 'Jadwal berhasil diperbarui' })
}

export async function DELETE(req: NextRequest) {
  const auth = requireRole(req, ['ADMIN'])
  if ('error' in auth) return auth.error

  const db = createAdminClient()
  const { id } = await req.json()

  const { error } = await db.from('jadwal').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ message: 'Jadwal berhasil dihapus' })
}
