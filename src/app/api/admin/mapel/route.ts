import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'
import { generateId } from '@/lib/utils'

export async function GET(req: NextRequest) {
  const auth = requireRole(req, ['ADMIN', 'GURU', 'PENGAWAS', 'KEPSEK', 'SISWA'])
  if ('error' in auth) return auth.error

  const db = createAdminClient()
  const { searchParams } = new URL(req.url)
  const guruId = searchParams.get('guru_id')

  // Gunakan query biasa, BUKAN FK join notation (!fkey)
  // karena FK constraint tidak didefinisikan di schema
  let query = db.from('mapel').select('*').order('nama')
  if (guruId) query = query.eq('guru_id', guruId)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Manual lookup nama guru dari tabel users
  const guruIds = [...new Set((data ?? []).map((m: Record<string, string>) => m.guru_id).filter(Boolean))]
  const { data: guruList } = guruIds.length
    ? await db.from('users').select('username, nama').in('username', guruIds)
    : { data: [] }
  const guruMap = Object.fromEntries((guruList ?? []).map((g: { username: string; nama: string }) => [g.username, g.nama]))

  const enriched = (data ?? []).map((m: Record<string, unknown>) => ({
    ...m,
    nama_guru: guruMap[m.guru_id as string] ?? (m.guru_id as string) ?? '',
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

export async function DELETE(req: NextRequest) {
  const auth = requireRole(req, ['ADMIN'])
  if ('error' in auth) return auth.error

  const db = createAdminClient()
  const { id } = await req.json()
  if (!id) return NextResponse.json({ error: 'ID mapel diperlukan' }, { status: 400 })

  const { error } = await db.from('mapel').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ message: 'Mata pelajaran berhasil dihapus' })
}
