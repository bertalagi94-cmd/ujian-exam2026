import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'
import { getZonaWaktuSekolah, tanggalHariIni } from '@/lib/pengaturan-waktu'

export async function GET(req: NextRequest) {
  const auth = requireRole(req, ['SISWA'])
  if ('error' in auth) return auth.error
  const { user } = auth

  const db = createAdminClient()
  const { data, error } = await db
    .from('jadwal')
    .select('*')
    .eq('kelas', user.kelas!)
    .order('tanggal', { ascending: false })
    .limit(30)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data?.length) return NextResponse.json({ data: [] })

  const mapelIds = [...new Set(data.map(j => j.mapel_id).filter(Boolean))]
  const { data: mapelList } = await db.from('mapel').select('id, nama').in('id', mapelIds)
  const mapelMap = Object.fromEntries((mapelList ?? []).map(m => [m.id, m.nama]))

  // FIX: sinkronkan status — jadwal yang tanggalnya sudah lewat tapi masih AKTIF
  // di-override ke SELESAI agar konsisten dengan tampilan guru
  const zona = await getZonaWaktuSekolah()
  const today = tanggalHariIni(zona)

  return NextResponse.json({
    data: data.map(j => {
      const tanggal = j.tanggal?.slice(0, 10) ?? j.tanggal
      // Override status jika tanggal sudah lewat dan status masih AKTIF
      const status = (j.status === 'AKTIF' && tanggal < today) ? 'SELESAI' : j.status
      return {
        ...j,
        status,                                          // ← FIX
        nama_mapel: mapelMap[j.mapel_id] ?? j.mapel_id,
      }
    })
  })
}
