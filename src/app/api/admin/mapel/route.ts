import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'
import { generateId } from '@/lib/utils'

export async function GET(req: NextRequest) {
  const auth = requireRole(req, ['ADMIN', 'GURU', 'PENGAWAS', 'KEPSEK', 'GURU_KEPSEK', 'SISWA'])
  if ('error' in auth) return auth.error

  const db = createAdminClient()
  const { searchParams } = new URL(req.url)
  const guruId = searchParams.get('guru_id')

  // Query mapel tanpa JOIN - hindari foreign key error
  let query = db.from('mapel').select('*').order('nama')
  if (guruId) query = query.eq('guru_id', guruId)

  const { data: mapelList, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!mapelList?.length) return NextResponse.json({ data: [] })

  // Ambil nama guru secara terpisah
  const guruIds = [...new Set(mapelList.map(m => m.guru_id).filter(Boolean))]
  let guruMap: Record<string, string> = {}

  if (guruIds.length > 0) {
    const { data: guruList } = await db
      .from('users')
      .select('username, nama')
      .in('username', guruIds)
    guruMap = Object.fromEntries((guruList ?? []).map(g => [g.username, g.nama]))
  }

  const enriched = mapelList.map(m => ({
    ...m,
    nama_guru: guruMap[m.guru_id] ?? m.guru_id ?? '-',
  }))

  return NextResponse.json({ data: enriched })
}

export async function POST(req: NextRequest) {
  const auth = requireRole(req, ['ADMIN'])
  if ('error' in auth) return auth.error

  const db = createAdminClient()
  const body = await req.json()

  const { error } = await db.from('mapel').insert({
    id: generateId('MPL'),
    nama: String(body.nama).toUpperCase(),
    guru_id: body.guru_id || null,
    kelas_list: body.kelas_list || '',
    jumlah_opsi: body.jumlah_opsi || 4,
    kkm: body.kkm || 75,
  })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ message: 'Mata pelajaran berhasil ditambahkan' }, { status: 201 })
}

export async function PUT(req: NextRequest) {
  const auth = requireRole(req, ['ADMIN'])
  if ('error' in auth) return auth.error

  const db = createAdminClient()
  const { id, ...update } = await req.json()

  const { error } = await db.from('mapel').update({
    nama: update.nama ? String(update.nama).toUpperCase() : undefined,
    guru_id: update.guru_id || null,
    kelas_list: update.kelas_list,
    jumlah_opsi: update.jumlah_opsi,
    kkm: update.kkm,
  }).eq('id', id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ message: 'Mata pelajaran berhasil diperbarui' })
}
