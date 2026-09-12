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

// FITUR BARU: guru bisa mengubah `mode_jawaban` (DIGITAL/KERTAS) paket Essay
// setelah dibuat, sama persis polanya dengan PG (lihat
// src/app/api/guru/paket/[id]/route.ts), dengan aturan:
//   - Status DRAFT / MENUNGGU / DITOLAK -> boleh diubah (termasuk saat
//     sedang MENUNGGU persetujuan admin — mengubah mode tidak mengubah isi
//     soal, jadi tidak perlu menarik paket dulu).
//   - Status DISETUJUI -> TIDAK boleh diubah langsung. Admin harus
//     membatalkan persetujuan dulu (aksi BATAL_SETUJUI di
//     /api/admin/soal, mengembalikan status ke DRAFT) baru guru bisa
//     mengubah mode.
//   - Kapan pun, kalau sesi ujian mapel+kelas ini sudah pernah dibuka
//     (BERJALAN/SELESAI), mode tidak bisa diubah sama sekali — sama seperti
//     proteksi lain di bank soal (lihat sesi-kelas.ts).
export async function PUT(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const auth = requireRole(req, ['GURU'])
  if ('error' in auth) return auth.error

  const { user } = auth
  const db = createAdminClient()
  const paketId = params.id
  const body = await req.json()

  if (body.mode_jawaban !== 'DIGITAL' && body.mode_jawaban !== 'KERTAS') {
    return NextResponse.json({ error: "mode_jawaban harus 'DIGITAL' atau 'KERTAS'" }, { status: 400 })
  }

  const { data: paket, error: fetchError } = await db
    .from('paket_essay')
    .select('guru_id, status, mapel_id, kelas_id, mode_jawaban')
    .eq('id', paketId)
    .single()

  if (fetchError || !paket) {
    return NextResponse.json({ error: 'Paket tidak ditemukan' }, { status: 404 })
  }

  if (paket.guru_id !== user.username) {
    return NextResponse.json({ error: 'Tidak memiliki izin' }, { status: 403 })
  }

  if (paket.status === 'DISETUJUI') {
    return NextResponse.json(
      {
        error: 'Paket ini sudah disetujui admin, jadi mode jawaban tidak bisa diubah langsung. ' +
          'Minta admin membatalkan persetujuan (kembalikan ke draft) terlebih dahulu, baru mode jawaban bisa diubah.',
      },
      { status: 409 }
    )
  }

  // Status yang diizinkan mengubah mode: DRAFT, MENUNGGU, DITOLAK
  if (!['DRAFT', 'MENUNGGU', 'DITOLAK'].includes(paket.status)) {
    return NextResponse.json({ error: 'Mode jawaban tidak bisa diubah untuk status paket ini' }, { status: 400 })
  }

  // Cegah mengubah mode untuk mapel+kelas yang sesi ujiannya sudah pernah
  // dibuka (sedang berjalan atau sudah selesai) — lihat sesi-kelas.ts
  const sesiSudahMulai = await cekSesiMapelKelasSudahMulai(db, paket.mapel_id, paket.kelas_id)
  if (sesiSudahMulai) {
    return NextResponse.json({ error: pesanBankSoalTerkunci('Essay', sesiSudahMulai, 'mengubah') }, { status: 409 })
  }

  if (paket.mode_jawaban === body.mode_jawaban) {
    return NextResponse.json({ message: 'Mode jawaban tidak berubah' })
  }

  const { error } = await db
    .from('paket_essay')
    .update({ mode_jawaban: body.mode_jawaban })
    .eq('id', paketId)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({
    message: `Mode jawaban berhasil diubah menjadi ${body.mode_jawaban === 'KERTAS' ? 'Kertas' : 'Digital'}`,
  })
}
