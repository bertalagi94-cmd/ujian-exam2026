import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'
import { stripHtmlTags } from '@/lib/utils'

interface Ctx { params: { id: string } }

export async function PUT(req: NextRequest, { params }: Ctx) {
  const auth = requireRole(req, ['GURU'])
  if ('error' in auth) return auth.error
  const { user } = auth

  const db = createAdminClient()
  const body = await req.json()

  const { data: existing } = await db.from('soal').select('guru_id, status').eq('id', params.id).single()
  if (!existing || existing.guru_id !== user.username) {
    return NextResponse.json({ error: 'Tidak memiliki izin' }, { status: 403 })
  }
  if (['DISETUJUI', 'MENUNGGU'].includes(existing.status)) {
    return NextResponse.json({ error: 'Soal yang sudah dikirim/disetujui tidak bisa diedit' }, { status: 400 })
  }

  // Validasi: teks opsi wajib diisi KECUALI kalau gambar opsi sudah ada.
  const jumlahOpsi = parseInt(body.jumlah_opsi) || 4
  const opsiWajib = ['a', 'b', 'c', ...(jumlahOpsi >= 4 ? ['d'] : []), ...(jumlahOpsi >= 5 ? ['e'] : [])]
  const opsiKurang = opsiWajib.filter(l => {
    const teks = stripHtmlTags(body[`opsi_${l}`])
    const gambar = body[`gambar_opsi_${l}`] || null
    return !teks && !gambar
  })
  if (opsiKurang.length > 0) {
    return NextResponse.json({
      error: `Opsi ${opsiKurang.map((l: string) => l.toUpperCase()).join(', ')} harus diisi teks atau gambar.`,
    }, { status: 400 })
  }

  const { error } = await db.from('soal').update({
    mapel_id: body.mapel_id,
    kelas_id: body.kelas_id,
    teks: stripHtmlTags(body.teks),
    // FIX: gunakan nama kolom yang sama dengan POST dan SELECT (gambar_pertanyaan, gambar_opsi_*)
    // Bug sebelumnya memakai gambar_url / gambar_a–e (nama lama) sehingga gambar hilang setelah diedit
    gambar_pertanyaan: body.gambar_pertanyaan || null,
    opsi_a: stripHtmlTags(body.opsi_a),
    opsi_b: stripHtmlTags(body.opsi_b),
    opsi_c: stripHtmlTags(body.opsi_c),
    opsi_d: body.opsi_d ? stripHtmlTags(body.opsi_d) : null,
    opsi_e: body.opsi_e ? stripHtmlTags(body.opsi_e) : null,
    gambar_opsi_a: body.gambar_opsi_a || null,
    gambar_opsi_b: body.gambar_opsi_b || null,
    gambar_opsi_c: body.gambar_opsi_c || null,
    gambar_opsi_d: body.gambar_opsi_d || null,
    gambar_opsi_e: body.gambar_opsi_e || null,
    kunci: body.kunci,
    pembahasan: body.pembahasan ? stripHtmlTags(body.pembahasan) : null,
    tingkat: body.tingkat,
    jumlah_opsi: parseInt(body.jumlah_opsi) || 4,
    status: existing.status === 'DITOLAK' ? 'DRAFT' : existing.status,
  }).eq('id', params.id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ message: 'Soal berhasil diperbarui' })
}

export async function DELETE(req: NextRequest, { params }: Ctx) {
  const auth = requireRole(req, ['GURU'])
  if ('error' in auth) return auth.error
  const { user } = auth

  const db = createAdminClient()
  const { data: existing } = await db.from('soal').select('guru_id, status').eq('id', params.id).single()

  if (!existing || existing.guru_id !== user.username) {
    return NextResponse.json({ error: 'Tidak memiliki izin' }, { status: 403 })
  }
  if (!['DRAFT', 'DITOLAK'].includes(existing.status)) {
    return NextResponse.json({ error: 'Soal yang sudah dikirim atau disetujui tidak bisa dihapus' }, { status: 400 })
  }

  const { error } = await db.from('soal').delete().eq('id', params.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ message: 'Soal berhasil dihapus' })
}
