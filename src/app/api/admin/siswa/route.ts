import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { createAdminClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'

export async function GET(req: NextRequest) {
  const auth = requireRole(req, ['ADMIN'])
  if ('error' in auth) return auth.error

  const db = createAdminClient()
  const { searchParams } = new URL(req.url)
  const page = parseInt(searchParams.get('page') ?? '1')
  const perPage = parseInt(searchParams.get('per_page') ?? '20')
  const search = searchParams.get('search') ?? ''
  const kelas = searchParams.get('kelas') ?? ''

  let query = db
    .from('siswa')
    .select('*', { count: 'exact' })
    .neq('is_tester', 'YES')
    .order('nama')

  if (search) {
    query = query.or(`nama.ilike.%${search}%,nis.ilike.%${search}%`)
  }
  if (kelas) {
    query = query.eq('kelas', kelas)
  }

  const from = (page - 1) * perPage
  query = query.range(from, from + perPage - 1)

  const { data, count, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ data: data ?? [], total: count ?? 0 })
}

export async function POST(req: NextRequest) {
  const auth = requireRole(req, ['ADMIN'])
  if ('error' in auth) return auth.error

  const db = createAdminClient()
  const body = await req.json()
  const { nis, nama, kelas, jenis_kelamin, tempat_lahir, tanggal_lahir, status } = body

  if (!nis || !nama || !kelas) {
    return NextResponse.json({ error: 'NIS, nama, dan kelas wajib diisi' }, { status: 400 })
  }

  const kelasNama = String(kelas).trim()

  // Jika kelas belum ada di tabel kelas, otomatis buat entry baru
  const { data: kelasExist } = await db
    .from('kelas')
    .select('id')
    .eq('nama', kelasNama)
    .maybeSingle()

  if (!kelasExist) {
    await db.from('kelas').insert({
      id: kelasNama,
      nama: kelasNama,
      wali_kelas: null,
      jurusan: '-',
      jumlah: 0,
    })
  }

  const password_hash = await bcrypt.hash(String(nis), 10)

  const { error } = await db.from('siswa').insert({
    nis: String(nis),
    nama: String(nama).toUpperCase(),
    kelas: kelasNama,
    password_hash,
    jenis_kelamin: jenis_kelamin || null,
    tempat_lahir: tempat_lahir || null,
    tanggal_lahir: tanggal_lahir || null,
    status: status ?? 'AKTIF',
  })

  if (error) {
    if (error.code === '23505') return NextResponse.json({ error: 'NIS sudah terdaftar' }, { status: 409 })
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ message: 'Siswa berhasil ditambahkan' }, { status: 201 })
}
