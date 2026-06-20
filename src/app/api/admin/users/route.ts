import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { createAdminClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'

export async function GET(req: NextRequest) {
  const auth = requireRole(req, ['ADMIN'])
  if ('error' in auth) return auth.error

  const db = createAdminClient()
  const { data, error } = await db
    .from('users')
    .select('username, nama, role, last_login, status, is_tester, no_hp')
    .neq('is_tester', 'YES')
    .order('nama')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ data: data ?? [] })
}

export async function POST(req: NextRequest) {
  const auth = requireRole(req, ['ADMIN'])
  if ('error' in auth) return auth.error

  const db = createAdminClient()
  const body = await req.json()
  const { username, nama, role, password, status, no_hp } = body

  if (!username || !nama || !role || !password) {
    return NextResponse.json({ error: 'Username, nama, role, dan password wajib diisi' }, { status: 400 })
  }

  const password_hash = await bcrypt.hash(String(password), 10)

  const { error } = await db.from('users').insert({
    username: String(username).trim(),
    nama: String(nama).toUpperCase(),
    role,
    password_hash,
    status: status ?? 'AKTIF',
    no_hp: no_hp ? String(no_hp).trim() : null,
  })

  if (error) {
    if (error.code === '23505') return NextResponse.json({ error: 'Username sudah digunakan' }, { status: 409 })
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ message: 'Pengguna berhasil ditambahkan' }, { status: 201 })
}
