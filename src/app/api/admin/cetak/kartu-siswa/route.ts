// GET /api/admin/cetak/kartu-siswa?kelas=8
// Mengembalikan semua siswa di kelas + data sekolah untuk kartu peserta ujian
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'

export async function GET(req: NextRequest) {
  const auth = requireRole(req, ['ADMIN'])
  if ('error' in auth) return auth.error

  const db = createAdminClient()
  const { searchParams } = new URL(req.url)
  const kelas = searchParams.get('kelas')

  if (!kelas) return NextResponse.json({ error: 'Parameter kelas diperlukan' }, { status: 400 })

  const [{ data: siswaList, error }, { data: pengaturan }, { data: kelasData }] = await Promise.all([
    db.from('siswa').select('nis, nama, kelas, jenis_kelamin, tempat_lahir, tanggal_lahir')
      .eq('kelas', kelas).eq('status', 'AKTIF').neq('is_tester', 'YES').order('nama'),
    db.from('pengaturan').select('key, value')
      .in('key', ['namaSekolah', 'npsn', 'tahunAjaran', 'logoUrl', 'kota']),
    db.from('kelas').select('nama, jurusan').eq('nama', kelas).single(),
  ])

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const settingMap = Object.fromEntries((pengaturan ?? [] as { key: string; value: string }[]).map(p => [p.key, p.value]))

  return NextResponse.json({
    siswa: siswaList ?? [],
    sekolah: settingMap,
    kelas: kelasData,
  })
}
