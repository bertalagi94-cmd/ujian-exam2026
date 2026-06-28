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

  type SekolahRow = { id: string; nama_sekolah: string; npsn: string; nama_kepsek: string; nip_kepsek: string; alamat: string; kota: string; tahun_ajaran: string; logo_url: string; label: string }

  const [{ data: siswaList, error }, { data: kelasData }] = await Promise.all([
    db.from('siswa').select('nis, nama, kelas, jenis_kelamin, tempat_lahir, tanggal_lahir')
      .eq('kelas', kelas).eq('status', 'AKTIF').neq('is_tester', 'YES').order('nama'),
    db.from('kelas')
      .select('nama, jurusan, sekolah:sekolah_id(id, label, nama_sekolah, npsn, nama_kepsek, nip_kepsek, alamat, kota, tahun_ajaran, logo_url)')
      .eq('nama', kelas).single(),
  ])

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Validasi: kelas harus sudah punya sekolah
  const sekolahRow = (kelasData as { nama: string; jurusan?: string; sekolah: SekolahRow | null } | null)?.sekolah ?? null
  if (!sekolahRow) {
    return NextResponse.json({
      error: `Kelas ${kelas} belum diatur sekolahnya. Buka menu Kelas → Edit dan pilih sekolah terlebih dahulu.`
    }, { status: 422 })
  }

  const sekolahMap = {
    namaSekolah: sekolahRow.nama_sekolah,
    npsn: sekolahRow.npsn,
    namaKepsek: sekolahRow.nama_kepsek,
    nipKepsek: sekolahRow.nip_kepsek,
    alamat: sekolahRow.alamat,
    kota: sekolahRow.kota,
    tahunAjaran: sekolahRow.tahun_ajaran,
    logoUrl: sekolahRow.logo_url,
    label: sekolahRow.label,
  }

  return NextResponse.json({
    siswa: siswaList ?? [],
    sekolah: sekolahMap,
    kelas: kelasData,
  })
}
