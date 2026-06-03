import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'
import { generateId } from '@/lib/utils'

export async function GET(req: NextRequest) {
  const auth = requireRole(req, ['ADMIN', 'GURU', 'PENGAWAS', 'KEPSEK', 'GURU_KEPSEK'])
  if ('error' in auth) return auth.error

  const db = createAdminClient()
  const { data, error } = await db.from('kelas').select('*').order('nama')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ data: data ?? [] })
}

export async function POST(req: NextRequest) {
  const auth = requireRole(req, ['ADMIN'])
  if ('error' in auth) return auth.error

  const db = createAdminClient()
  const body = await req.json()

  const { error } = await db.from('kelas').insert({
    id: generateId('KLS'),
    nama: String(body.nama),
    jurusan: body.jurusan || '-',
    wali_kelas: body.wali_kelas || null,
    jumlah: body.jumlah || 0,
  })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ message: 'Kelas berhasil ditambahkan' }, { status: 201 })
}

export async function PUT(req: NextRequest) {
  const auth = requireRole(req, ['ADMIN'])
  if ('error' in auth) return auth.error

  const db = createAdminClient()
  const body = await req.json()
  const { id, ...update } = body

  const { error } = await db.from('kelas').update(update).eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ message: 'Kelas berhasil diperbarui' })
}

export async function DELETE(req: NextRequest) {
  const auth = requireRole(req, ['ADMIN'])
  if ('error' in auth) return auth.error

  const db = createAdminClient()
  const { id } = await req.json()
  if (!id) return NextResponse.json({ error: 'ID kelas diperlukan' }, { status: 400 })

  const { error } = await db.from('kelas').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ message: 'Kelas berhasil dihapus' })
}
