import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const auth = requireRole(req, ['GURU'])
  if ('error' in auth) return auth.error

  const { user } = auth
  const db = createAdminClient()
  const paketId = params.id

  // Ambil data paket, pastikan milik guru ini
  const { data: paket, error: fetchError } = await db
    .from('paket_soal')
    .select('guru_id, status')
    .eq('id', paketId)
    .single()

  if (fetchError || !paket) {
    return NextResponse.json({ error: 'Paket tidak ditemukan' }, { status: 404 })
  }

  if (paket.guru_id !== user.username) {
    return NextResponse.json({ error: 'Tidak memiliki izin' }, { status: 403 })
  }

  // Hanya boleh hapus jika status DRAFT atau DITOLAK
  if (!['DRAFT', 'DITOLAK'].includes(paket.status)) {
    return NextResponse.json(
      { error: 'Paket hanya bisa dihapus jika berstatus DRAFT atau DITOLAK' },
      { status: 400 }
    )
  }

  // Hapus semua soal dalam paket terlebih dahulu
  const { error: deleteSoalError } = await db
    .from('soal')
    .delete()
    .eq('paket_id', paketId)

  if (deleteSoalError) {
    return NextResponse.json({ error: deleteSoalError.message }, { status: 500 })
  }

  // Hapus paket
  const { error: deletePaketError } = await db
    .from('paket_soal')
    .delete()
    .eq('id', paketId)

  if (deletePaketError) {
    return NextResponse.json({ error: deletePaketError.message }, { status: 500 })
  }

  return NextResponse.json({ message: 'Paket berhasil dihapus' })
}
