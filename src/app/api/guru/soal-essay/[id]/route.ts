// Edit/hapus soal essay individual. Sekarang terkunci berdasarkan status
// SOAL itu sendiri (DRAFT/DITOLAK = boleh, MENUNGGU/DISETUJUI = terkunci),
// persis pola yang sama dengan guru/soal/[id]/route.ts (PG) — bukan lagi
// berdasarkan status sesi_ujian per jadwal.
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

  const { data: existing } = await db
    .from('soal_essay')
    .select('id, guru_id, status, paket_essay_id')
    .eq('id', params.id)
    .single()

  if (!existing || existing.guru_id !== user.username) {
    return NextResponse.json({ error: 'Soal essay tidak ditemukan' }, { status: 404 })
  }

  if (['MENUNGGU', 'DISETUJUI'].includes(existing.status)) {
    return NextResponse.json({ error: 'Soal yang sudah dikirim/disetujui tidak bisa diedit' }, { status: 400 })
  }

  const update: Record<string, unknown> = {}
  if (body.teks !== undefined) {
    const teks = stripHtmlTags(body.teks)
    if (!teks) return NextResponse.json({ error: 'Teks soal wajib diisi' }, { status: 400 })
    update.teks = teks
  }
  if (body.gambar_url !== undefined) update.gambar_url = body.gambar_url || null
  if (body.bobot_maks !== undefined) {
    const bobotMaks = Number(body.bobot_maks)
    if (!bobotMaks || bobotMaks <= 0) {
      return NextResponse.json({ error: 'Bobot maksimal soal harus lebih dari 0' }, { status: 400 })
    }
    update.bobot_maks = bobotMaks
  }
  if (body.urutan !== undefined) update.urutan = Number(body.urutan)
  // Kalau soal ini sebelumnya DITOLAK, edit mengembalikannya ke DRAFT
  // (sama seperti pola PG) supaya bisa dikirim ulang.
  if (existing.status === 'DITOLAK') update.status = 'DRAFT'

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: 'Tidak ada perubahan' }, { status: 400 })
  }

  const { error } = await db.from('soal_essay').update(update).eq('id', params.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ message: 'Soal essay berhasil diperbarui' })
}

export async function DELETE(req: NextRequest, { params }: Ctx) {
  const auth = requireRole(req, ['GURU'])
  if ('error' in auth) return auth.error
  const { user } = auth

  const db = createAdminClient()

  const { data: existing } = await db
    .from('soal_essay')
    .select('id, guru_id, status, paket_essay_id')
    .eq('id', params.id)
    .single()

  if (!existing || existing.guru_id !== user.username) {
    return NextResponse.json({ error: 'Soal essay tidak ditemukan' }, { status: 404 })
  }

  if (!['DRAFT', 'DITOLAK'].includes(existing.status)) {
    return NextResponse.json({ error: 'Soal yang sudah dikirim atau disetujui tidak bisa dihapus' }, { status: 400 })
  }

  const { error } = await db.from('soal_essay').delete().eq('id', params.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  if (existing.paket_essay_id) {
    const { count } = await db
      .from('soal_essay')
      .select('id', { count: 'exact', head: true })
      .eq('paket_essay_id', existing.paket_essay_id)
    await db.from('paket_essay').update({ jumlah_soal: count ?? 0 }).eq('id', existing.paket_essay_id)
  }

  return NextResponse.json({ message: 'Soal essay berhasil dihapus' })
}
