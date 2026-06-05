import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'

// GET /api/admin/kisi-kisi — lihat semua kisi-kisi
export async function GET(req: NextRequest) {
  const auth = requireRole(req, ['ADMIN'])
  if ('error' in auth) return auth.error
  const db = createAdminClient()

  const { data: kisiList, error } = await db
    .from('kisi_kisi')
    .select('*')
    .order('updated_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!kisiList?.length) return NextResponse.json({ data: [] })

  const mapelIds = [...new Set(kisiList.map(k => k.mapel_id))]
  const kelasIds = [...new Set(kisiList.map(k => k.kelas_id))]
  const guruIds = [...new Set(kisiList.map(k => k.guru_id))]

  const [{ data: mapelList }, { data: kelasList }, { data: guruList }] = await Promise.all([
    db.from('mapel').select('id, nama').in('id', mapelIds),
    db.from('kelas').select('id, nama').in('id', kelasIds),
    db.from('users').select('username, nama').in('username', guruIds),
  ])

  const mapelMap = Object.fromEntries((mapelList ?? []).map(m => [m.id, m.nama]))
  const kelasMap = Object.fromEntries((kelasList ?? []).map(k => [k.id, k.nama]))
  const guruMap = Object.fromEntries((guruList ?? []).map(g => [g.username, g.nama]))

  const enriched = kisiList.map(k => ({
    ...k,
    nama_mapel: mapelMap[k.mapel_id] ?? k.mapel_id,
    nama_kelas: kelasMap[k.kelas_id] ?? k.kelas_id,
    nama_guru: guruMap[k.guru_id] ?? k.guru_id,
  }))

  return NextResponse.json({ data: enriched })
}

// DELETE /api/admin/kisi-kisi?id=xxx — admin bisa hapus kisi-kisi manapun
export async function DELETE(req: NextRequest) {
  const auth = requireRole(req, ['ADMIN'])
  if ('error' in auth) return auth.error
  const db = createAdminClient()
  const { searchParams } = new URL(req.url)
  const id = searchParams.get('id')

  if (!id) return NextResponse.json({ error: 'id wajib diisi' }, { status: 400 })

  const { error } = await db.from('kisi_kisi').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ message: 'Kisi-kisi berhasil dihapus' })
}
