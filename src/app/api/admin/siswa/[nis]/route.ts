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
  const { nis } = params

  // Hapus semua data turunan milik siswa ini sebelum hapus baris siswa-nya.
  // Tidak ada FK/CASCADE di schema, jadi cascade dilakukan manual di sini —
  // sama persis dengan pola yang dipakai di DELETE /api/admin/kelas/route.ts.
  // Urutan: data "daun" dulu, baru "induk" siswa.
  const { error: pelanggaranError } = await db.from('pelanggaran').delete().eq('nis', nis)
  if (pelanggaranError) return NextResponse.json({ error: pelanggaranError.message }, { status: 500 })

  const { error: nilaiError } = await db.from('nilai').delete().eq('nis', nis)
  if (nilaiError) return NextResponse.json({ error: nilaiError.message }, { status: 500 })

  const { error: jawabanError } = await db.from('jawaban').delete().eq('nis', nis)
  if (jawabanError) return NextResponse.json({ error: jawabanError.message }, { status: 500 })

  const { error: siswaUjianError } = await db.from('siswa_ujian').delete().eq('nis', nis)
  if (siswaUjianError) return NextResponse.json({ error: siswaUjianError.message }, { status: 500 })

  const { error } = await db.from('siswa').delete().eq('nis', nis)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ message: 'Siswa beserta data nilai, jawaban, dan pelanggaran terkait berhasil dihapus' })
}
