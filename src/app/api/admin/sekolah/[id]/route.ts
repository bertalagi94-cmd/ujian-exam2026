import { NextRequest, NextResponse } from 'next/server'
import { tenantDb, yayasanIdDari } from '@/lib/tenant'
import { requireRoleAktif } from '@/lib/status-akun'

interface Ctx { params: Promise<{ id: string }> }

export async function PUT(req: NextRequest, props: Ctx) {
  const params = await props.params;
  const auth = await requireRoleAktif(req, ['ADMIN'])
  if ('error' in auth) return auth.error

  const db = tenantDb(yayasanIdDari(auth.user))
  const body = await req.json()
  const { label, nama_sekolah, npsn, nama_kepsek, nip_kepsek, alamat, kota, tahun_ajaran, logo_url, urutan } = body

  if (!label || !nama_sekolah) {
    return NextResponse.json({ error: 'Label jenjang dan nama sekolah wajib diisi' }, { status: 400 })
  }

  const { error } = await db.from('sekolah').update({
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
  }).eq('id', params.id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ message: 'Sekolah berhasil diperbarui' })
}

export async function DELETE(req: NextRequest, props: Ctx) {
  const params = await props.params;
  const auth = await requireRoleAktif(req, ['ADMIN'])
  if ('error' in auth) return auth.error

  const db = tenantDb(yayasanIdDari(auth.user))

  // Cek apakah masih ada kelas yang pakai sekolah ini
  const { count } = await db
    .from('kelas')
    .select('*', { count: 'exact', head: true })
    .eq('sekolah_id', params.id)

  if ((count ?? 0) > 0) {
    return NextResponse.json({
      error: `Tidak bisa dihapus — masih ada ${count} kelas yang menggunakan jenjang ini. Ubah dulu sekolah di tiap kelas tersebut.`
    }, { status: 409 })
  }

  // Lepas relasi di users dulu
  await db.from('users').update({ sekolah_id: null }).eq('sekolah_id', params.id)

  const { error } = await db.from('sekolah').delete().eq('id', params.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ message: 'Sekolah berhasil dihapus' })
}
