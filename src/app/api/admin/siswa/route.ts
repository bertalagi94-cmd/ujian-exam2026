import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { tenantDb, yayasanIdDari } from '@/lib/tenant'
import { requireRole } from '@/lib/auth'
import { generateId } from '@/lib/utils'

export async function GET(req: NextRequest) {
  const auth = requireRole(req, ['ADMIN'])
  if ('error' in auth) return auth.error

  const db = tenantDb(yayasanIdDari(auth.user))
  const { searchParams } = new URL(req.url)
  const page = parseInt(searchParams.get('page') ?? '1')
  const perPage = parseInt(searchParams.get('per_page') ?? '20')
  const search = searchParams.get('search') ?? ''
  const kelas = searchParams.get('kelas') ?? ''
  const tester = searchParams.get('tester') === 'true'

  let query = db
    .from('siswa')
    .select('*', { count: 'exact' })
    .order('nama')

  // ?tester=true -> tampilkan HANYA akun tester (tab "Akun Tester" di admin).
  // Default -> tampilkan siswa reguler seperti sebelumnya.
  query = tester ? query.eq('is_tester', 'YES') : query.neq('is_tester', 'YES')

  // Bersihkan karakter spesial PostgREST (, ( ) % *) supaya nama seperti
  // "Budi, S.Pd" tidak merusak sintaks .or() (sama seperti admin/pelanggaran).
  const safeSearch = search.replace(/[,()%*]/g, ' ').trim()
  if (safeSearch) {
    query = query.or(`nama.ilike.%${safeSearch}%,nis.ilike.%${safeSearch}%`)
  }
  if (kelas) {
    query = query.eq('kelas', kelas)
  }

  const from = (page - 1) * perPage
  query = query.range(from, from + perPage - 1)

  const { data, count, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Jangan kirim hash password ke browser (select('*') membawanya).
  const aman = (data ?? []).map((row: Record<string, unknown>) => {
    const { password_hash: _ph, ...sisanya } = row
    void _ph
    return sisanya
  })

  return NextResponse.json({ data: aman, total: count ?? 0 })
}

export async function POST(req: NextRequest) {
  const auth = requireRole(req, ['ADMIN'])
  if ('error' in auth) return auth.error

  const db = tenantDb(yayasanIdDari(auth.user))
  const body = await req.json()
  const { nis, nama, kelas, jenis_kelamin, tempat_lahir, tanggal_lahir, status } = body

  if (!nis || !nama || !kelas) {
    return NextResponse.json({ error: 'NISN, nama, dan kelas wajib diisi' }, { status: 400 })
  }

  const kelasNama = String(kelas).trim().toUpperCase()

  // Jika kelas belum ada di tabel kelas, otomatis buat entry baru
  // FIX Bug #5: gunakan ilike (case-insensitive) agar tidak ada duplikat
  // akibat perbedaan casing (mis. "10a" vs "10A" jadi dua kelas berbeda).
  // Siswa dengan kelas casing berbeda tidak akan cocok dengan jadwal ujian.
  const { data: kelasExist } = await db
    .from('kelas')
    .select('id')
    .ilike('nama', kelasNama)
    .maybeSingle()

  if (!kelasExist) {
    await db.from('kelas').insert({
      id: generateId('KLS'),
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
    if (error.code === '23505') return NextResponse.json({ error: 'NISN sudah terdaftar' }, { status: 409 })
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ message: 'Siswa berhasil ditambahkan' }, { status: 201 })
}
