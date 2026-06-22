import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'
import { getZonaWaktuSekolah, tanggalHariIni } from '@/lib/pengaturan-waktu'

export async function GET(req: NextRequest) {
  const auth = requireRole(req, ['GURU'])
  if ('error' in auth) return auth.error
  const { user } = auth

  const db = createAdminClient()

  // Ambil semua jadwal yang pengawasnya adalah guru ini
  const { data: jadwalSendiri, error } = await db
    .from('jadwal')
    .select('*')
    .eq('pengawas', user.username)
    .order('tanggal', { ascending: true })
    .order('sesi')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Tambahan: jadwal yang BUKAN milik guru ini sebagai pengawas asli, tapi
  // guru ini ditugaskan ADMIN sebagai pengawas sesi SUSULAN-nya (fitur Ujian
  // Susulan dari menu Admin). Jadwal asli & pengawas aslinya tidak diubah —
  // guru susulan hanya "dipinjamkan" akses agar menu Jadwal Pengawasan /
  // Mode Pengawas ikut muncul di sidebar-nya.
  const { data: sesiSusulanSaya } = await db
    .from('sesi_ujian')
    .select('jadwal_id')
    .eq('status', 'BERJALAN')
    .contains('info_json', { pengawas_susulan: user.username })

  const jadwalIdSusulanSaya = [...new Set((sesiSusulanSaya ?? []).map(s => s.jadwal_id).filter(Boolean))]

  let jadwalSusulanSaya: typeof jadwalSendiri = []
  if (jadwalIdSusulanSaya.length > 0) {
    const sudahAda = new Set((jadwalSendiri ?? []).map(j => j.id))
    const { data: jadwalTambahan } = await db
      .from('jadwal')
      .select('*')
      .in('id', jadwalIdSusulanSaya.filter(id => !sudahAda.has(id)))
    jadwalSusulanSaya = jadwalTambahan ?? []
  }

  const jadwalList = [...(jadwalSendiri ?? []), ...jadwalSusulanSaya]
    .sort((a, b) => (a.tanggal < b.tanggal ? -1 : a.tanggal > b.tanggal ? 1 : (a.sesi ?? 0) - (b.sesi ?? 0)))

  const zona = await getZonaWaktuSekolah()

  if (!jadwalList?.length) return NextResponse.json({ data: [], hasJadwal: false, zonaWaktu: zona })

  // Enrich dengan nama mapel dan nama kelas
  const mapelIds = [...new Set(jadwalList.map(j => j.mapel_id).filter(Boolean))]
  const kelasIds = [...new Set(jadwalList.map(j => j.kelas).filter(Boolean))]

  const [{ data: mapelList }, { data: kelasList }] = await Promise.all([
    db.from('mapel').select('id, nama').in('id', mapelIds),
    db.from('kelas').select('id, nama').in('id', kelasIds),
  ])

  const mapelMap = Object.fromEntries((mapelList ?? []).map(m => [m.id, m.nama]))
  const kelasMap = Object.fromEntries((kelasList ?? []).map(k => [k.id, k.nama]))

  // Ambil sesi_ujian untuk SEMUA jadwal (bukan hanya hari ini)
  // agar tombol susulan bisa muncul kapan pun, tidak terbatas tanggal
  const allJadwalIds = jadwalList.map(j => j.id)
  const { data: sesiList } = await db
    .from('sesi_ujian')
    .select('id, jadwal_id, status')
    .in('jadwal_id', allJadwalIds)
    // Ambil sesi non-susulan (is_darurat = false atau null) untuk status utama
    .order('waktu_mulai', { ascending: false })

  // Buat map: jadwal_id → sesi terbaru (non-susulan lebih diutamakan)
  const sesiMap: Record<string, { id: string; status: string }> = {}
  for (const s of sesiList ?? []) {
    // Simpan sesi pertama yang ditemukan per jadwal (sudah diurutkan terbaru)
    if (!sesiMap[s.jadwal_id]) {
      sesiMap[s.jadwal_id] = { id: s.id, status: s.status }
    }
  }

  const today = tanggalHariIni(zona)

  const enriched = jadwalList.map(j => {
    const tanggal = j.tanggal?.slice(0, 10) ?? j.tanggal
    const sesi = sesiMap[j.id]

    // Override status berdasarkan sesi aktual
    let status = j.status
    if (sesi?.status === 'BERJALAN') status = 'BERJALAN'
    else if (sesi?.status === 'SELESAI') status = 'SELESAI'
    else if (tanggal < today && status === 'AKTIF') status = 'SELESAI'

    return {
      ...j,
      tanggal,
      status,
      nama_mapel: mapelMap[j.mapel_id] ?? j.mapel_id,
      nama_kelas: kelasMap[j.kelas] ?? j.kelas,
      // Selalu sertakan sesi_ujian agar halaman bisa menampilkan tombol susulan
      sesi_ujian: sesi ? { id: sesi.id, status: sesi.status } : null,
    }
  })

  return NextResponse.json({ data: enriched, hasJadwal: enriched.length > 0, zonaWaktu: zona })
}
