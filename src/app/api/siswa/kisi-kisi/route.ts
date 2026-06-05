import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { getTokenFromRequest } from '@/lib/auth'

// GET /api/siswa/kisi-kisi
// Mengembalikan semua kisi-kisi TERKIRIM untuk kelas siswa yang login
export async function GET(req: NextRequest) {
  const user = getTokenFromRequest(req)
  if (!user || user.role !== 'SISWA') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const db = createAdminClient()
  const kelasId = user.kelas

  if (!kelasId) return NextResponse.json({ data: [] })

  // Ambil kisi-kisi yang sudah TERKIRIM untuk kelas siswa ini
  const { data: kisiList, error } = await db
    .from('kisi_kisi')
    .select('*')
    .eq('kelas_id', kelasId)
    .eq('status', 'TERKIRIM')
    .order('updated_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!kisiList?.length) return NextResponse.json({ data: [] })

  const mapelIds = [...new Set(kisiList.map(k => k.mapel_id))]
  const guruIds = [...new Set(kisiList.map(k => k.guru_id))]

  const [{ data: mapelList }, { data: guruList }] = await Promise.all([
    db.from('mapel').select('id, nama').in('id', mapelIds),
    db.from('users').select('username, nama').in('username', guruIds),
  ])

  const mapelMap = Object.fromEntries((mapelList ?? []).map(m => [m.id, m.nama]))
  const guruMap = Object.fromEntries((guruList ?? []).map(g => [g.username, g.nama]))

  const enriched = kisiList.map(k => ({
    id: k.id,
    mapel_id: k.mapel_id,
    nama_mapel: mapelMap[k.mapel_id] ?? k.mapel_id,
    nama_guru: guruMap[k.guru_id] ?? k.guru_id,
    konten: k.konten,
    updated_at: k.updated_at,
  }))

  return NextResponse.json({ data: enriched })
}
