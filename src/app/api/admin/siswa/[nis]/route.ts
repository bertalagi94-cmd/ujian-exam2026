import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { createAdminClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'

interface RouteContext {
  params: { nis: string }
}

export async function PUT(req: NextRequest, { params }: RouteContext) {
  const auth = requireRole(req, ['ADMIN'])
  if ('error' in auth) return auth.error

  const db = createAdminClient()
  const body = await req.json()
  const { nama, kelas, jenis_kelamin, tempat_lahir, tanggal_lahir, status } = body

  const { error } = await db
    .from('siswa')
    .update({
      nama: nama ? String(nama).toUpperCase() : undefined,
      kelas: kelas || undefined,
      jenis_kelamin: jenis_kelamin || null,
      tempat_lahir: tempat_lahir || null,
      tanggal_lahir: tanggal_lahir || null,
      status: status || undefined,
    })
    .eq('nis', params.nis)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ message: 'Data berhasil diperbarui' })
}

export async function DELETE(req: NextRequest, { params }: RouteContext) {
  const auth = requireRole(req, ['ADMIN'])
  if ('error' in auth) return auth.error

  const db = createAdminClient()
  const { error } = await db.from('siswa').delete().eq('nis', params.nis)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ message: 'Siswa berhasil dihapus' })
}
