import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'

export async function GET(req: NextRequest) {
  const auth = requireRole(req, ['ADMIN'])
  if ('error' in auth) return auth.error

  const db = createAdminClient()
  const { searchParams } = new URL(req.url)
  const status = searchParams.get('status') ?? 'MENUNGGU'

  const { data: pakets, error } = await db
    .from('paket_soal')
    .select('*')
    .eq('status', status)
    .order('tanggal', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!pakets?.length) return NextResponse.json({ data: [] })

  const guruIds = [...new Set(pakets.map(p => p.guru_id).filter(Boolean))]
  const mapelIds = [...new Set(pakets.map(p => p.mapel_id).filter(Boolean))]
  const kelasIds = [...new Set(pakets.map(p => p.kelas_id).filter(Boolean))]

  const [{ data: guruList }, { data: mapelList }, { data: kelasList }] = await Promise.all([
    db.from('users').select('username, nama').in('username', guruIds),
    db.from('mapel').select('id, nama').in('id', mapelIds),
    db.from('kelas').select('id, nama').in('id', kelasIds),
  ])

  const guruMap = Object.fromEntries((guruList ?? []).map(g => [g.username, g.nama]))
  const mapelMap = Object.fromEntries((mapelList ?? []).map(m => [m.id, m.nama]))
  const kelasMap = Object.fromEntries((kelasList ?? []).map(k => [k.id, String(k.nama)]))

  const enriched = pakets.map(p => ({
    ...p,
    nama_guru: guruMap[p.guru_id] ?? p.guru_id,
    nama_mapel: mapelMap[p.mapel_id] ?? p.mapel_id,
    nama_kelas: kelasMap[p.kelas_id] ?? p.kelas_id,
  }))

  return NextResponse.json({ data: enriched })
}

export async function POST(req: NextRequest) {
  const auth = requireRole(req, ['ADMIN'])
  if ('error' in auth) return auth.error

  const db = createAdminClient()
  const { paket_id, action, catatan } = await req.json()

  let newStatus: string
  if (action === 'SETUJUI') newStatus = 'DISETUJUI'
  else if (action === 'TOLAK') newStatus = 'DITOLAK'
  else if (action === 'BATAL_SETUJUI') newStatus = 'DRAFT'
  else return NextResponse.json({ error: 'Action tidak valid' }, { status: 400 })

  // Update paket + set notif_dibaca=false agar guru dapat badge notifikasi
  const { error: paketErr } = await db
    .from('paket_soal')
    .update({ status: newStatus, catatan: catatan || null, notif_dibaca: false })
    .eq('id', paket_id)

  if (paketErr) return NextResponse.json({ error: paketErr.message }, { status: 500 })

  // Update semua soal dalam paket
  const { error: soalErr } = await db
    .from('soal')
    .update({ status: newStatus })
    .eq('paket_id', paket_id)

  if (soalErr) return NextResponse.json({ error: soalErr.message }, { status: 500 })

  const pesanStatus = newStatus === 'DISETUJUI' ? 'disetujui' : newStatus === 'DITOLAK' ? 'ditolak' : 'dikembalikan ke draft'
  return NextResponse.json({ message: `Paket berhasil ${pesanStatus}` })
}
