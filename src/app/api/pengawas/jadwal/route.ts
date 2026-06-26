// /api/pengawas/jadwal/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'
import { getZonaWaktuSekolah } from '@/lib/pengaturan-waktu'
import { computeStatusSoalDetailMap, buildStatusSoalKey } from '@/lib/soal-status'

export async function GET(req: NextRequest) {
  const auth = requireRole(req, ['PENGAWAS', 'GURU', 'ADMIN'])
  if ('error' in auth) return auth.error
  const { user } = auth

  const db = createAdminClient()

  let query = db
    .from('jadwal')
    .select('*')
    .in('status', ['AKTIF', 'BERJALAN'])
    .order('tanggal', { ascending: true })
    .order('jam_mulai')

  // Pengawas only sees their own jadwal
  if (user.role === 'PENGAWAS') {
    query = query.eq('pengawas', user.username)
  }

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const zonaWaktu = await getZonaWaktuSekolah()

  if (!data?.length) return NextResponse.json({ data: [], zonaWaktu })

  const mapelIds = [...new Set(data.map(j => j.mapel_id).filter(Boolean))]
  const { data: mapelList } = await db.from('mapel').select('id, nama').in('id', mapelIds)
  const mapelMap = Object.fromEntries((mapelList ?? []).map(m => [m.id, m.nama]))

  // Enrich status_soal supaya pengawas bisa melihat (dan UI bisa menonaktifkan
  // tombol "Buka Sesi") sebelum mencoba membuka sesi untuk jadwal yang soalnya
  // belum siap.
  const statusSoalMap = await computeStatusSoalDetailMap(
    data.map(j => ({ mapel_id: j.mapel_id, kelas: String(j.kelas) }))
  )

  return NextResponse.json({
    data: data.map(j => {
      const detail = statusSoalMap[buildStatusSoalKey(j.mapel_id, j.kelas)] ?? { status: 'BELUM_ADA', namaGuru: null }
      return {
        ...j,
        nama_mapel: mapelMap[j.mapel_id] ?? j.mapel_id,
        status_soal: detail.status,
        status_soal_guru: detail.namaGuru,
      }
    }),
    zonaWaktu,
  })
}
