// GET /api/admin/cetak?tanggal=2026-06-02
// Mengembalikan semua jadwal pada tanggal tertentu beserta data siswa dan pengawas
// untuk keperluan cetak daftar hadir & berita acara
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'

export async function GET(req: NextRequest) {
  const auth = requireRole(req, ['ADMIN'])
  if ('error' in auth) return auth.error

  const db = createAdminClient()
  const { searchParams } = new URL(req.url)
  const tanggal = searchParams.get('tanggal')

  if (!tanggal) return NextResponse.json({ error: 'Parameter tanggal diperlukan' }, { status: 400 })

  // Ambil semua jadwal di tanggal ini
  const { data: jadwalList, error } = await db
    .from('jadwal')
    .select('*')
    .eq('tanggal', tanggal)
    .order('sesi')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!jadwalList?.length) return NextResponse.json({ data: [] })

  // Enrichment: mapel dan pengawas
  const mapelIds = [...new Set(jadwalList.map(j => j.mapel_id).filter(Boolean))]
  const pengawasIds = [...new Set(jadwalList.map(j => j.pengawas).filter(Boolean))]

  const [{ data: mapelList }, { data: pengawasList }, { data: pengaturan }] = await Promise.all([
    db.from('mapel').select('id, nama').in('id', mapelIds.length ? mapelIds : ['__']),
    db.from('users').select('username, nama').in('username', pengawasIds.length ? pengawasIds : ['__']),
    db.from('pengaturan').select('key, value').in('key', ['namaSekolah', 'npsn', 'alamat', 'kota', 'tahunAjaran', 'namaKepsek', 'logoUrl']),
  ])

  const mapelMap = Object.fromEntries((mapelList ?? []).map(m => [m.id, m.nama]))
  const pengawasMap = Object.fromEntries((pengawasList ?? []).map(p => [p.username, p.nama]))
  const settingMap = Object.fromEntries((pengaturan ?? []).map(p => [p.key, p.value]))

  // Untuk setiap jadwal, ambil daftar siswa di kelas tersebut
  const result = await Promise.all(jadwalList.map(async (j) => {
    const { data: siswaList } = await db
      .from('siswa')
      .select('nis, nama')
      .eq('kelas', j.kelas)
      .eq('status', 'AKTIF')
      .order('nama')

    return {
      ...j,
      nama_mapel: mapelMap[j.mapel_id] ?? j.mapel_id,
      nama_pengawas: pengawasMap[j.pengawas] ?? j.pengawas ?? '',
      siswa: siswaList ?? [],
    }
  }))

  return NextResponse.json({ data: result, sekolah: settingMap })
}
