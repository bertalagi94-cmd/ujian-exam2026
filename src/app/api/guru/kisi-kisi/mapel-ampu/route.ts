import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'

// GET /api/guru/kisi-kisi/mapel-ampu
// Mengembalikan daftar mapel dan kelas yang diampu guru ini
// Digunakan saat membuat kisi-kisi baru untuk filter dropdown
export async function GET(req: NextRequest) {
  const auth = requireRole(req, ['GURU'])
  if ('error' in auth) return auth.error
  const { user } = auth
  const db = createAdminClient()

  // Ambil semua mapel yang diampu guru ini
  const { data: mapelList, error: mapelError } = await db
    .from('mapel')
    .select('id, nama, kelas_list')
    .eq('guru_id', user.username)
    .eq('status' as string, 'AKTIF' as string)
    .order('nama')

  // Jika tidak ada filter status, coba tanpa filter
  const { data: mapelAll, error: mapelAllError } = await db
    .from('mapel')
    .select('id, nama, kelas_list')
    .eq('guru_id', user.username)
    .order('nama')

  const mapels = mapelList ?? mapelAll ?? []
  if (!mapels.length) return NextResponse.json({ data: [] })

  // Ambil kelas dari kelas_mapel sesuai mapel yang diampu
  const mapelIds = mapels.map(m => m.id)
  const { data: kelasMapelList } = await db
    .from('kelas_mapel')
    .select('kelas_id, nama_kelas, mapel_id, nama_mapel')
    .in('mapel_id', mapelIds)
    .order('nama_kelas')

  // Susun data: per mapel, kelas apa saja yang tersedia
  const result = mapels.map(m => {
    const kelasList = (kelasMapelList ?? [])
      .filter(km => km.mapel_id === m.id)
      .map(km => ({ id: km.kelas_id, nama: km.nama_kelas }))
    return {
      id: m.id,
      nama: m.nama,
      kelas: kelasList,
    }
  }).filter(m => m.kelas.length > 0) // hanya mapel yang punya kelas

  return NextResponse.json({ data: result })
}
