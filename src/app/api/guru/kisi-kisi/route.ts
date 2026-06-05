import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'
import { generateId } from '@/lib/utils'

// GET /api/guru/kisi-kisi
// Tampilkan SEMUA kisi-kisi dari semua guru (1 aplikasi = 1 sekolah)
export async function GET(req: NextRequest) {
  const auth = requireRole(req, ['GURU'])
  if ('error' in auth) return auth.error
  const { user } = auth
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
    is_mine: k.guru_id === user.username,
  }))

  return NextResponse.json({ data: enriched })
}

// POST /api/guru/kisi-kisi — buat kisi-kisi baru
export async function POST(req: NextRequest) {
  const auth = requireRole(req, ['GURU'])
  if ('error' in auth) return auth.error
  const { user } = auth
  const db = createAdminClient()
  const body = await req.json()
  const { mapel_id, kelas_id, konten, status } = body

  if (!mapel_id || !kelas_id || !konten) {
    return NextResponse.json({ error: 'mapel_id, kelas_id, dan konten wajib diisi' }, { status: 400 })
  }

  const { data: mapel } = await db
    .from('mapel')
    .select('id')
    .eq('id', mapel_id)
    .eq('guru_id', user.username)
    .single()

  if (!mapel) {
    return NextResponse.json({ error: 'Anda tidak mengampu mapel ini' }, { status: 403 })
  }

  const { data: existing } = await db
    .from('kisi_kisi')
    .select('id')
    .eq('mapel_id', mapel_id)
    .eq('kelas_id', kelas_id)
    .maybeSingle()

  if (existing) {
    return NextResponse.json({ error: 'Kisi-kisi untuk kelas dan mapel ini sudah ada. Silakan edit yang sudah ada.' }, { status: 409 })
  }

  const { error } = await db.from('kisi_kisi').insert({
    id: generateId('KSK'),
    mapel_id,
    kelas_id,
    guru_id: user.username,
    konten,
    status: status === 'TERKIRIM' ? 'TERKIRIM' : 'DRAFT',
    updated_at: new Date().toISOString(),
  })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ message: 'Kisi-kisi berhasil disimpan' }, { status: 201 })
}

// PUT /api/guru/kisi-kisi — edit kisi-kisi (hanya milik sendiri)
export async function PUT(req: NextRequest) {
  const auth = requireRole(req, ['GURU'])
  if ('error' in auth) return auth.error
  const { user } = auth
  const db = createAdminClient()
  const body = await req.json()
  const { id, konten, status } = body

  if (!id || !konten) {
    return NextResponse.json({ error: 'id dan konten wajib diisi' }, { status: 400 })
  }

  const { data: existing } = await db
    .from('kisi_kisi')
    .select('id, guru_id')
    .eq('id', id)
    .single()

  if (!existing) return NextResponse.json({ error: 'Kisi-kisi tidak ditemukan' }, { status: 404 })
  if (existing.guru_id !== user.username) {
    return NextResponse.json({ error: 'Anda hanya dapat mengedit kisi-kisi milik sendiri' }, { status: 403 })
  }

  const { error } = await db
    .from('kisi_kisi')
    .update({
      konten,
      status: status === 'TERKIRIM' ? 'TERKIRIM' : 'DRAFT',
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ message: 'Kisi-kisi berhasil diperbarui' })
}

// DELETE /api/guru/kisi-kisi — hapus kisi-kisi (hanya milik sendiri)
export async function DELETE(req: NextRequest) {
  const auth = requireRole(req, ['GURU'])
  if ('error' in auth) return auth.error
  const { user } = auth
  const db = createAdminClient()
  const { searchParams } = new URL(req.url)
  const id = searchParams.get('id')

  if (!id) return NextResponse.json({ error: 'id wajib diisi' }, { status: 400 })

  const { data: existing } = await db
    .from('kisi_kisi')
    .select('id, guru_id')
    .eq('id', id)
    .single()

  if (!existing) return NextResponse.json({ error: 'Kisi-kisi tidak ditemukan' }, { status: 404 })
  if (existing.guru_id !== user.username) {
    return NextResponse.json({ error: 'Anda hanya dapat menghapus kisi-kisi milik sendiri' }, { status: 403 })
  }

  const { error } = await db.from('kisi_kisi').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ message: 'Kisi-kisi berhasil dihapus' })
}
