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

  let query = db.from('mapel').select('*, users!mapel_guru_id_fkey(nama)').order('nama')
  if (guruId) query = query.eq('guru_id', guruId)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const enriched = (data ?? []).map((m: Record<string, unknown>) => ({
    ...m,
    nama_guru: (m.users as { nama: string } | null)?.nama ?? m.guru_id,
    users: undefined,
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
    guru_id: update.guru_id,
    kelas_list: update.kelas_list,
    jumlah_opsi: update.jumlah_opsi,
    kkm: update.kkm,
  }).eq('id', id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ message: 'Mata pelajaran berhasil diperbarui' })
}
