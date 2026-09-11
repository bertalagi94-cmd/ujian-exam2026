import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'
import { cekSesiMapelKelasSudahMulai, pesanBankSoalTerkunci } from '@/lib/sesi-kelas'

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const auth = requireRole(req, ['GURU'])
  if ('error' in auth) return auth.error

  const { user } = auth
  const db = createAdminClient()
  const paketId = params.id

  const { data: paket, error: fetchError } = await db
    .from('paket_essay')
    .select('guru_id, status, mapel_id, kelas_id')
    .eq('id', paketId)
    .single()

  if (fetchError || !paket) {
    return NextResponse.json({ error: 'Paket tidak ditemukan' }, { status: 404 })
  }

  if (paket.guru_id !== user.username) {
    return NextResponse.json({ error: 'Tidak memiliki izin' }, { status: 403 })
  }

  if (!['DRAFT', 'DITOLAK'].includes(paket.status)) {
    return NextResponse.json(
      { error: 'Paket hanya bisa dihapus jika berstatus DRAFT atau DITOLAK' },
      { status: 400 }
    )
  }

  // Cegah menghapus paket essay untuk mapel+kelas yang sesi ujiannya sudah
  // pernah dibuka (sedang berjalan atau sudah selesai) — lihat sesi-kelas.ts
  const sesiSudahMulai = await cekSesiMapelKelasSudahMulai(db, paket.mapel_id, paket.kelas_id)
  if (sesiSudahMulai) {
    return NextResponse.json({ error: pesanBankSoalTerkunci('Essay', sesiSudahMulai, 'menghapus') }, { status: 409 })
  }

  const { error: deleteSoalError } = await db
    .from('soal_essay')
    .delete()
    .eq('paket_essay_id', paketId)

  if (deleteSoalError) {
    return NextResponse.json({ error: deleteSoalError.message }, { status: 500 })
  }

  const { error: deletePaketError } = await db
    .from('paket_essay')
    .delete()
    .eq('id', paketId)

  if (deletePaketError) {
    return NextResponse.json({ error: deletePaketError.message }, { status: 500 })
  }

  return NextResponse.json({ message: 'Paket berhasil dihapus' })
}
