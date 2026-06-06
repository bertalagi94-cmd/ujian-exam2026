import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'

interface Jadwal {
  id: string
  tanggal: string
  sesi: number
  jam_mulai: string
  jam_selesai: string
  mapel_id: string
  kelas: string
  pengawas: string
  durasi: number
  status: string
}

export async function GET(req: NextRequest) {
  const auth = requireRole(req, ['ADMIN'])
  if ('error' in auth) return auth.error

  const db = createAdminClient()
  const { searchParams } = new URL(req.url)
  const tanggal = searchParams.get('tanggal')
  if (!tanggal) return NextResponse.json({ error: 'Parameter tanggal diperlukan' }, { status: 400 })

  const { data: jadwalList, error } = await db
    .from('jadwal')
    .select('id, tanggal, sesi, jam_mulai, jam_selesai, mapel_id, kelas, pengawas, durasi, status')
    .eq('tanggal', tanggal)
    .order('sesi')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!jadwalList?.length) return NextResponse.json({ data: [] })

  const list = jadwalList as Jadwal[]

  const mapelIds   = [...new Set(list.map(j => j.mapel_id).filter(Boolean))]
  const pengawasIds = [...new Set(list.map(j => j.pengawas).filter(Boolean))]

  const [{ data: mapelList }, { data: pengawasList }, { data: pengaturan }] = await Promise.all([
    db.from('mapel').select('id, nama').in('id', mapelIds.length ? mapelIds : ['__']),
    db.from('users').select('username, nama').in('username', pengawasIds.length ? pengawasIds : ['__']),
    db.from('pengaturan').select('key, value').in('key', ['namaSekolah', 'npsn', 'alamat', 'kota', 'tahunAjaran', 'namaKepsek', 'logoUrl']),
  ])

  const mapelMap    = Object.fromEntries((mapelList    ?? []).map(m => [m.id,       m.nama]))
  const pengawasMap = Object.fromEntries((pengawasList ?? []).map(p => [p.username, p.nama]))
  const settingMap  = Object.fromEntries(
    ((pengaturan ?? []) as { key: string; value: string }[]).map(p => [p.key, p.value])
  )

  const result = await Promise.all(list.map(async (j) => {
    const { data: siswaList } = await db
      .from('siswa')
      .select('nis, nama')
      .eq('kelas', j.kelas)
      .eq('status', 'AKTIF')
      .order('nama')

    return {
      ...j,
      nama_mapel:    mapelMap[j.mapel_id]  ?? j.mapel_id,
      nama_pengawas: pengawasMap[j.pengawas] ?? j.pengawas ?? '',
      siswa: siswaList ?? [],
    }
  }))

  return NextResponse.json({ data: result, sekolah: settingMap })
}
