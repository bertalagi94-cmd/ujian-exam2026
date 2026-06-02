import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string; action: string } }
) {
  const auth = requireRole(req, ['GURU', 'GURU_KEPSEK'])
  if ('error' in auth) return auth.error
  const { user } = auth
  const db = createAdminClient()
  const paketId = params.id
  const action = params.action // 'kirim' | 'tarik'

  // Verify ownership
  const { data: paket } = await db
    .from('paket_soal')
    .select('guru_id, status, jumlah_soal')
    .eq('id', paketId)
    .single()

  if (!paket || paket.guru_id !== user.username) {
    return NextResponse.json({ error: 'Tidak memiliki izin' }, { status: 403 })
  }

  if (action === 'kirim') {
    if (!['DRAFT', 'DITOLAK'].includes(paket.status)) {
      return NextResponse.json({ error: 'Paket tidak bisa dikirim' }, { status: 400 })
    }
    // Count soal in paket
    const { count } = await db
      .from('soal')
      .select('*', { count: 'exact', head: true })
      .eq('paket_id', paketId)

    if (!count || count < 1) {
      return NextResponse.json({ error: 'Paket harus memiliki minimal 1 soal' }, { status: 400 })
    }

    const { error } = await db
      .from('paket_soal')
      .update({ status: 'MENUNGGU', jumlah_soal: count, catatan: null })
      .eq('id', paketId)

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    // Update all soal status to MENUNGGU
    await db.from('soal').update({ status: 'MENUNGGU' }).eq('paket_id', paketId).eq('status', 'DRAFT')
    return NextResponse.json({ message: 'Paket berhasil dikirim untuk validasi' })
  }

  if (action === 'tarik') {
    if (paket.status !== 'MENUNGGU') {
      return NextResponse.json({ error: 'Hanya paket berstatus MENUNGGU yang bisa ditarik' }, { status: 400 })
    }
    const { error } = await db
      .from('paket_soal')
      .update({ status: 'DRAFT' })
      .eq('id', paketId)

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    await db.from('soal').update({ status: 'DRAFT' }).eq('paket_id', paketId).eq('status', 'MENUNGGU')
    return NextResponse.json({ message: 'Paket berhasil ditarik' })
  }

  return NextResponse.json({ error: 'Action tidak valid' }, { status: 400 })
}
