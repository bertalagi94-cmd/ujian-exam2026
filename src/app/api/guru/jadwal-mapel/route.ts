// GET /api/guru/jadwal-mapel
//
// Daftar jadwal ujian untuk mapel yang DIAMPU guru ini (mapel.guru_id),
// siapa pun pengawasnya. Berbeda dengan /api/guru/jadwal-pengawasan yang
// hanya berisi jadwal di mana guru ini bertugas sebagai PENGAWAS ruangan —
// menu "Jadwal Mapel Saya" menjawab pertanyaan "mapel saya diujikan kapan,
// di kelas mana, dan siapa yang mengawasi?".
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'
import { getZonaWaktuSekolah, tanggalHariIni } from '@/lib/pengaturan-waktu'

export async function GET(req: NextRequest) {
  const auth = requireRole(req, ['GURU'])
  if ('error' in auth) return auth.error
  const { user } = auth

  const db = createAdminClient()
  const zona = await getZonaWaktuSekolah()
  const hariIni = tanggalHariIni(zona)

  const { data: mapelSaya, error: mapelError } = await db
    .from('mapel')
    .select('id, nama')
    .eq('guru_id', user.username)
    .order('nama')

  if (mapelError) return NextResponse.json({ error: mapelError.message }, { status: 500 })

  const mapelList = mapelSaya ?? []
  if (!mapelList.length) {
    return NextResponse.json({ data: [], mapelList: [], hariIni, zonaWaktu: zona })
  }

  const mapelIds = mapelList.map(m => m.id)
  const mapelMap = Object.fromEntries(mapelList.map(m => [m.id, m.nama]))

  const { data: jadwalList, error } = await db
    .from('jadwal')
    .select('id, tanggal, sesi, jam_mulai, jam_selesai, mapel_id, kelas, pengawas, durasi, status')
    .in('mapel_id', mapelIds)
    .order('tanggal', { ascending: true })
    .order('sesi')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!jadwalList?.length) {
    return NextResponse.json({ data: [], mapelList, hariIni, zonaWaktu: zona })
  }

  const kelasIds = [...new Set(jadwalList.map(j => j.kelas).filter(Boolean))]
  const pengawasUsernames = [...new Set(jadwalList.map(j => j.pengawas).filter((p): p is string => !!p))]
  const jadwalIds = jadwalList.map(j => j.id)

  const [{ data: kelasRows }, { data: pengawasRows }, { data: sesiList }] = await Promise.all([
    kelasIds.length
      ? db.from('kelas').select('id, nama').in('id', kelasIds)
      : Promise.resolve({ data: [] as { id: string; nama: string }[] }),
    pengawasUsernames.length
      ? db.from('users').select('username, nama').in('username', pengawasUsernames)
      : Promise.resolve({ data: [] as { username: string; nama: string }[] }),
    db.from('sesi_ujian')
      .select('id, jadwal_id, status')
      .in('jadwal_id', jadwalIds)
      .order('waktu_mulai', { ascending: false }),
  ])

  const kelasMap = Object.fromEntries((kelasRows ?? []).map(k => [k.id, k.nama]))
  const pengawasMap = Object.fromEntries((pengawasRows ?? []).map(u => [u.username, u.nama]))

  // Sesi terbaru per jadwal (data sudah diurutkan terbaru dulu) — dipakai
  // untuk menentukan status sebenarnya, sama seperti jadwal-pengawasan.
  const sesiMap: Record<string, { status: string }> = {}
  for (const s of sesiList ?? []) {
    if (!sesiMap[s.jadwal_id]) sesiMap[s.jadwal_id] = { status: s.status }
  }

  const data = jadwalList.map(j => {
    const tanggal = j.tanggal?.slice(0, 10) ?? j.tanggal
    const sesi = sesiMap[j.id]

    let status: string = j.status
    if (sesi?.status === 'BERJALAN') status = 'BERJALAN'
    else if (sesi?.status === 'SELESAI') status = 'SELESAI'
    else if (tanggal < hariIni && status === 'AKTIF') status = 'SELESAI'

    return {
      id: j.id,
      tanggal,
      sesi: j.sesi,
      jam_mulai: j.jam_mulai,
      jam_selesai: j.jam_selesai,
      durasi: j.durasi,
      status,
      mapel_id: j.mapel_id,
      nama_mapel: mapelMap[j.mapel_id] ?? j.mapel_id,
      kelas: j.kelas,
      nama_kelas: kelasMap[j.kelas] ?? j.kelas,
      pengawas: j.pengawas,
      nama_pengawas: j.pengawas ? (pengawasMap[j.pengawas] ?? j.pengawas) : null,
    }
  })

  return NextResponse.json({ data, mapelList, hariIni, zonaWaktu: zona })
}
