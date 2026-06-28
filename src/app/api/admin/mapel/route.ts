import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'
import { generateId } from '@/lib/utils'

function parseKelasList(kelasList: string | null | undefined): string[] {
  return (kelasList ?? '').split(',').map(s => s.trim()).filter(Boolean)
}

// Cek apakah ada kelas yang sudah diampu guru LAIN untuk mapel dengan nama yang sama.
// Mencegah, misalnya, Guru A dan Guru B berebut mengampu KIMIA di kelas 12 yang sama
// (yang akan membuat jadwal/soal salah pilih baris mapel karena nama mapel kembar).
async function findKelasConflict(
  db: ReturnType<typeof createAdminClient>,
  namaNormalized: string,
  guruId: string | null | undefined,
  kelasList: string[],
  excludeId?: string
): Promise<{ kelas: string; guruNama: string }[]> {
  if (!guruId || kelasList.length === 0) return []

  let query = db.from('mapel').select('id, guru_id, kelas_list').eq('nama', namaNormalized)
  if (excludeId) query = query.neq('id', excludeId)
  const { data: rows } = await query

  const otherRows = (rows ?? []).filter((r: { guru_id: string | null }) => r.guru_id && r.guru_id !== guruId)
  if (otherRows.length === 0) return []

  const conflicts: { kelas: string; guruId: string }[] = []
  for (const row of otherRows as { guru_id: string; kelas_list: string | null }[]) {
    const rowKelas = parseKelasList(row.kelas_list)
    for (const k of kelasList) {
      if (rowKelas.includes(k)) conflicts.push({ kelas: k, guruId: row.guru_id })
    }
  }
  if (conflicts.length === 0) return []

  const guruIds = [...new Set(conflicts.map(c => c.guruId))]
  const { data: guruRows } = await db.from('users').select('username, nama').in('username', guruIds)
  const guruMap = Object.fromEntries((guruRows ?? []).map((g: { username: string; nama: string }) => [g.username, g.nama]))

  return conflicts.map(c => ({ kelas: c.kelas, guruNama: guruMap[c.guruId] ?? c.guruId }))
}

export async function GET(req: NextRequest) {
  const auth = requireRole(req, ['ADMIN', 'GURU', 'KEPSEK', 'SISWA'])
  if ('error' in auth) return auth.error

  const db = createAdminClient()
  const { searchParams } = new URL(req.url)
  const guruId = searchParams.get('guru_id')

  // Gunakan query biasa, BUKAN FK join notation (!fkey)
  // karena FK constraint tidak didefinisikan di schema
  let query = db.from('mapel').select('*').order('nama')
  if (guruId) query = query.eq('guru_id', guruId)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Manual lookup nama guru dari tabel users
  const guruIds = [...new Set((data ?? []).map((m: Record<string, string>) => m.guru_id).filter(Boolean))]
  const { data: guruList } = guruIds.length
    ? await db.from('users').select('username, nama').in('username', guruIds)
    : { data: [] }
  const guruMap = Object.fromEntries((guruList ?? []).map((g: { username: string; nama: string }) => [g.username, g.nama]))

  const enriched = (data ?? []).map((m: Record<string, unknown>) => ({
    ...m,
    nama_guru: guruMap[m.guru_id as string] ?? (m.guru_id as string) ?? '',
  }))

  return NextResponse.json({ data: enriched })
}

export async function POST(req: NextRequest) {
  const auth = requireRole(req, ['ADMIN'])
  if ('error' in auth) return auth.error

  const db = createAdminClient()
  const body = await req.json()

  const namaNormalized = String(body.nama).toUpperCase()

  // Cek duplikasi: nama mapel + guru_id yang sama sudah ada
  const { data: existing } = body.guru_id
    ? await db.from('mapel').select('id').eq('nama', namaNormalized).eq('guru_id', body.guru_id).limit(1)
    : await db.from('mapel').select('id').eq('nama', namaNormalized).is('guru_id', null).limit(1)

  if (existing && existing.length > 0) {
    return NextResponse.json(
      { error: `Mata pelajaran "${namaNormalized}" dengan guru yang sama sudah ada dalam daftar.` },
      { status: 409 }
    )
  }

  // Cek tabrakan kelas: mapel dengan nama sama tidak boleh diampu lebih dari satu guru
  // untuk kelas yang sama (mis. KIMIA kelas 12 tidak boleh dipegang Guru A dan Guru B sekaligus).
  const kelasListArr = parseKelasList(body.kelas_list)
  const conflicts = await findKelasConflict(db, namaNormalized, body.guru_id, kelasListArr)
  if (conflicts.length > 0) {
    const detail = conflicts.map(c => `Kelas ${c.kelas} (sudah diampu ${c.guruNama})`).join(', ')
    return NextResponse.json(
      { error: `Tidak bisa disimpan, ada tabrakan kelas pada mapel "${namaNormalized}": ${detail}.` },
      { status: 409 }
    )
  }

  const { error } = await db.from('mapel').insert({
    id: generateId('MPL'),
    nama: namaNormalized,
    guru_id: body.guru_id || null,
    kelas_list: body.kelas_list || '',
    jumlah_opsi: body.jumlah_opsi || 4,
    kkm: body.kkm || 75,
  })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ message: 'Mata pelajaran berhasil ditambahkan' }, { status: 201 })
}

export async function PUT(req: NextRequest) {
  const auth = requireRole(req, ['ADMIN'])
  if ('error' in auth) return auth.error

  const db = createAdminClient()
  const { id, ...update } = await req.json()
  if (!id) return NextResponse.json({ error: 'ID mapel diperlukan' }, { status: 400 })

  // Ambil nama final (kalau nama tidak dikirim di payload, pakai nama lama)
  let namaFinal = update.nama ? String(update.nama).toUpperCase() : undefined
  if (!namaFinal) {
    const { data: current } = await db.from('mapel').select('nama').eq('id', id).single()
    namaFinal = current?.nama
  }

  if (namaFinal) {
    const kelasListArr = parseKelasList(update.kelas_list)
    const conflicts = await findKelasConflict(db, namaFinal, update.guru_id, kelasListArr, id)
    if (conflicts.length > 0) {
      const detail = conflicts.map(c => `Kelas ${c.kelas} (sudah diampu ${c.guruNama})`).join(', ')
      return NextResponse.json(
        { error: `Tidak bisa disimpan, ada tabrakan kelas pada mapel "${namaFinal}": ${detail}.` },
        { status: 409 }
      )
    }
  }

  const { error } = await db.from('mapel').update({
    nama: namaFinal,
    guru_id: update.guru_id || null,
    kelas_list: update.kelas_list,
    jumlah_opsi: update.jumlah_opsi,
    kkm: update.kkm,
  }).eq('id', id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ message: 'Mata pelajaran berhasil diperbarui' })
}

export async function DELETE(req: NextRequest) {
  const auth = requireRole(req, ['ADMIN'])
  if ('error' in auth) return auth.error

  const db = createAdminClient()
  const { id } = await req.json()
  if (!id) return NextResponse.json({ error: 'ID mapel diperlukan' }, { status: 400 })

  const { error } = await db.from('mapel').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ message: 'Mata pelajaran berhasil dihapus' })
}
