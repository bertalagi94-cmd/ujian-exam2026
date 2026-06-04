import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'
import { generateId } from '@/lib/utils'

export async function GET(req: NextRequest) {
  const auth = requireRole(req, ['GURU'])
  if ('error' in auth) return auth.error
  const { user } = auth

  const db = createAdminClient()
  const { searchParams } = new URL(req.url)
  const page = parseInt(searchParams.get('page') ?? '1')
  const perPage = parseInt(searchParams.get('per_page') ?? '15')
  const search = searchParams.get('search') ?? ''
  const status = searchParams.get('status') ?? ''
  const mapelId = searchParams.get('mapel_id') ?? ''

  let query = db
    .from('soal')
    .select('*', { count: 'exact' })
    .eq('guru_id', user.username)
    .order('created_at', { ascending: false })

  if (search) query = query.ilike('teks', `%${search}%`)
  if (status) query = query.eq('status', status)
  if (mapelId) query = query.eq('mapel_id', mapelId)

  const from = (page - 1) * perPage
  query = query.range(from, from + perPage - 1)

  const { data, count, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Enrich with nama_mapel
  const soalList = data ?? []
  if (soalList.length > 0) {
    const mapelIds = [...new Set(soalList.map((s: { mapel_id: string }) => s.mapel_id).filter(Boolean))]
    const { data: mapelList } = await db.from('mapel').select('id, nama').in('id', mapelIds)
    const mapelMap = Object.fromEntries((mapelList ?? []).map((m: { id: string; nama: string }) => [m.id, m.nama]))
    const enriched = soalList.map((s: Record<string, unknown>) => ({ ...s, nama_mapel: mapelMap[s.mapel_id as string] ?? s.mapel_id }))
    return NextResponse.json({ data: enriched, total: count ?? 0 })
  }

  return NextResponse.json({ data: soalList, total: count ?? 0 })
}

export async function POST(req: NextRequest) {
  const auth = requireRole(req, ['GURU'])
  if ('error' in auth) return auth.error
  const { user } = auth

  const db = createAdminClient()
  const body = await req.json()

  const { error } = await db.from('soal').insert({
    id: generateId('SL'),
    mapel_id: body.mapel_id,
    kelas_id: body.kelas_id,
    guru_id: user.username,
    teks: body.teks,
    gambar_url: body.gambar_pertanyaan || null,
    opsi_a: body.opsi_a,
    opsi_b: body.opsi_b,
    opsi_c: body.opsi_c,
    opsi_d: body.opsi_d || null,
    opsi_e: body.opsi_e || null,
    gambar_a: body.gambar_opsi_a || null,
    gambar_b: body.gambar_opsi_b || null,
    gambar_c: body.gambar_opsi_c || null,
    gambar_d: body.gambar_opsi_d || null,
    gambar_e: body.gambar_opsi_e || null,
    kunci: body.kunci,
    pembahasan: body.pembahasan || null,
    tingkat: body.tingkat ?? 'Sedang',
    jumlah_opsi: parseInt(body.jumlah_opsi) || 4,
    status: 'DRAFT',
    paket_id: body.paket_id || null,
  })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ message: 'Soal berhasil ditambahkan' }, { status: 201 })
}
