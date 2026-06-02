import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'

interface Ctx { params: { id: string } }

export async function PUT(req: NextRequest, { params }: Ctx) {
  const auth = requireRole(req, ['GURU', 'GURU_KEPSEK'])
  if ('error' in auth) return auth.error
  const { user } = auth

  const db = createAdminClient()
  const body = await req.json()

  // Verify ownership
  const { data: existing } = await db.from('soal').select('guru_id, status').eq('id', params.id).single()
  if (!existing || existing.guru_id !== user.username) {
    return NextResponse.json({ error: 'Tidak memiliki izin' }, { status: 403 })
  }

  const { error } = await db.from('soal').update({
    mapel_id: body.mapel_id,
    kelas_id: body.kelas_id,
    teks: body.teks,
    opsi_a: body.opsi_a,
    opsi_b: body.opsi_b,
    opsi_c: body.opsi_c,
    opsi_d: body.opsi_d || null,
    opsi_e: body.opsi_e || null,
    kunci: body.kunci,
    pembahasan: body.pembahasan || null,
    tingkat: body.tingkat,
    jumlah_opsi: parseInt(body.jumlah_opsi) || 4,
    acak: body.acak,
    // Reset to draft if edited
    status: existing.status === 'DISETUJUI' ? 'DRAFT' : existing.status,
  }).eq('id', params.id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ message: 'Soal berhasil diperbarui' })
}

export async function DELETE(req: NextRequest, { params }: Ctx) {
  const auth = requireRole(req, ['GURU', 'GURU_KEPSEK'])
  if ('error' in auth) return auth.error
  const { user } = auth

  const db = createAdminClient()
  const { data: existing } = await db.from('soal').select('guru_id, status').eq('id', params.id).single()

  if (!existing || existing.guru_id !== user.username) {
    return NextResponse.json({ error: 'Tidak memiliki izin' }, { status: 403 })
  }
  if (existing.status !== 'DRAFT') {
    return NextResponse.json({ error: 'Hanya soal berstatus DRAFT yang bisa dihapus' }, { status: 400 })
  }

  const { error } = await db.from('soal').delete().eq('id', params.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ message: 'Soal berhasil dihapus' })
}
