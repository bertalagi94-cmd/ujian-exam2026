import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { createAdminClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'

interface Ctx { params: { username: string } }

export async function PUT(req: NextRequest, { params }: Ctx) {
  const auth = requireRole(req, ['ADMIN'])
  if ('error' in auth) return auth.error

  const db = createAdminClient()
  const { nama, role, status, no_hp, nip, sekolah_id } = await req.json()

  // Role akun yang sah hanya 4 ini — lihat catatan di POST /api/admin/users
  // dan src/lib/auth.ts. "Pengawas" tidak boleh diset lewat edit juga.
  if (role !== undefined) {
    const VALID_ROLES = ['ADMIN', 'GURU', 'KEPSEK']
    if (!VALID_ROLES.includes(role)) {
      return NextResponse.json({ error: `Role tidak valid. Role yang diizinkan: ${VALID_ROLES.join(', ')}` }, { status: 400 })
    }
  }

  const { error } = await db.from('users').update({
    nama: nama ? String(nama).toUpperCase() : undefined,
    role: role || undefined,
    status: status || undefined,
    no_hp: no_hp !== undefined ? (no_hp ? String(no_hp).trim() : null) : undefined,
    nip: nip !== undefined ? String(nip ?? '').trim() : undefined,
    sekolah_id: role === 'KEPSEK' ? (sekolah_id || null) : null,
  }).eq('username', params.username)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ message: 'Data berhasil diperbarui' })
}

export async function DELETE(req: NextRequest, { params }: Ctx) {
  const auth = requireRole(req, ['ADMIN'])
  if ('error' in auth) return auth.error

  const db = createAdminClient()
  const { error } = await db.from('users').delete().eq('username', params.username)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ message: 'Pengguna berhasil dihapus' })
}
