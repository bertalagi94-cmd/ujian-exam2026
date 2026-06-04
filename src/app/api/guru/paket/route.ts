import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'
import { generateId } from '@/lib/utils'

export async function GET(req: NextRequest) {
  const auth = requireRole(req, ['GURU'])
  if ('error' in auth) return auth.error
  const { user } = auth
  const db = createAdminClient()

  const { data: pakets, error } = await db
    .from('paket_soal')
    .select('*')
    .eq('guru_id', user.username)
    .order('tanggal', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!pakets?.length) return NextResponse.json({ data: [] })

  const mapelIds = [...new Set(pakets.map(p => p.mapel_id).filter(Boolean))]
  const kelasIds = [...new Set(pakets.map(p => p.kelas_id).filter(Boolean))]

  const [{ data: mapelList }, { data: kelasList }] = await Promise.all([
    db.from('mapel').select('id, nama').in('id', mapelIds),
    db.from('kelas').select('id, nama').in('id', kelasIds),
  ])

  const mapelMap = Object.fromEntries((mapelList ?? []).map(m => [m.id, m.nama]))
  const kelasMap = Object.fromEntries((kelasList ?? []).map(k => [k.id, String(k.nama)]))

  const enriched = pakets.map(p => ({
    ...p,
    nama_mapel: mapelMap[p.mapel_id] ?? p.mapel_id,
    nama_kelas: kelasMap[p.kelas_id] ?? p.kelas_id,
  }))

  return NextResponse.json({ data: enriched })
}

export async function POST(req: NextRequest) {
  const auth = requireRole(req, ['GURU'])
  if ('error' in auth) return auth.error
  const { user } = auth
  const db = createAdminClient()
  const body = await req.json()

  const { error } = await db.from('paket_soal').insert({
    id: generateId('PKT'),
    mapel_id: body.mapel_id,
    kelas_id: body.kelas_id,
    guru_id: user.username,
    status: 'DRAFT',
    jumlah_soal: 0,
    acak: body.acak ?? 'YA',
  })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ message: 'Paket berhasil dibuat' }, { status: 201 })
}
