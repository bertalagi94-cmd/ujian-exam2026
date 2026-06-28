import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'
import { generateId } from '@/lib/utils'

export async function GET(req: NextRequest) {
  const auth = requireRole(req, ['ADMIN', 'KEPSEK'])
  if ('error' in auth) return auth.error

  const db = createAdminClient()
  const { data, error } = await db
    .from('sekolah')
    .select('*')
    .order('urutan')
    .order('created_at')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ data: data ?? [] })
}

export async function POST(req: NextRequest) {
  const auth = requireRole(req, ['ADMIN'])
  if ('error' in auth) return auth.error

  const db = createAdminClient()
  const body = await req.json()
  const { label, nama_sekolah, npsn, nama_kepsek, nip_kepsek, alamat, kota, tahun_ajaran, logo_url, urutan } = body

  if (!label || !nama_sekolah) {
    return NextResponse.json({ error: 'Label jenjang dan nama sekolah wajib diisi' }, { status: 400 })
  }

  const { error } = await db.from('sekolah').insert({
    id: generateId('SKL'),
    label: String(label).trim(),
    nama_sekolah: String(nama_sekolah).trim(),
    npsn: npsn ?? '',
    nama_kepsek: nama_kepsek ?? '',
    nip_kepsek: nip_kepsek ?? '',
    alamat: alamat ?? '',
    kota: kota ?? '',
    tahun_ajaran: tahun_ajaran ?? '',
    logo_url: logo_url ?? '',
    urutan: urutan ?? 0,
  })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ message: 'Sekolah berhasil ditambahkan' }, { status: 201 })
}
