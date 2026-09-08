// Taruh file ini di: src/app/api/guru/soal-essay/[id]/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'
import { stripHtmlTags } from '@/lib/utils'

type Params = { params: Promise<{ id: string }> }

export async function PUT(req: NextRequest, { params }: Params) {
  const auth = requireRole(req, ['GURU'])
  if ('error' in auth) return auth.error
  const { user } = auth
  const { id } = await params

  const db = createAdminClient()
  const body = await req.json()

  const { data: existing } = await db
    .from('soal_essay')
    .select('id, guru_id, jadwal_id')
    .eq('id', id)
    .single()

  if (!existing || existing.guru_id !== user.username) {
    return NextResponse.json({ error: 'Soal essay tidak ditemukan' }, { status: 404 })
  }

  // FIX BUG: sebelumnya PUT tidak pernah mengecek status sesi, tidak seperti
  // DELETE di bawah yang sudah menolak perubahan saat sesi BERJALAN. Akibatnya
  // guru masih bisa mengubah teks/bobot_maks/status soal essay yang SEDANG
  // dikerjakan siswa — bisa membuat siswa melihat soal berubah di tengah
  // ujian, atau bobot_maks berubah setelah siswa submit tapi sebelum guru
  // koreksi, sehingga skala nilai essay jadi tidak konsisten.
  const { data: sesiBerjalanUntukEdit } = await db
    .from('sesi_ujian')
    .select('id')
    .eq('jadwal_id', existing.jadwal_id)
    .eq('status', 'BERJALAN')
    .maybeSingle()

  if (sesiBerjalanUntukEdit) {
    return NextResponse.json(
      { error: 'Tidak bisa mengubah soal essay saat sesi ujian untuk jadwal ini sedang berjalan' },
      { status: 409 }
    )
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
  // FIX: batasi nilai status yang boleh disimpan hanya 'DRAFT' atau
  // 'DISETUJUI' — sebelumnya body.status disimpan mentah-mentah tanpa
  // validasi, padahal endpoint siswa (essay/soal, essay/info) dan koreksi
  // guru sekarang bergantung pada status ini untuk memutuskan soal mana
  // yang ditampilkan/dihitung (lihat FIX di essay/soal/route.ts).
  if (body.status !== undefined) {
    if (body.status !== 'DRAFT' && body.status !== 'DISETUJUI') {
      return NextResponse.json({ error: "status harus 'DRAFT' atau 'DISETUJUI'" }, { status: 400 })
    }
    update.status = body.status
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: 'Tidak ada perubahan' }, { status: 400 })
  }

  const { error } = await db.from('soal_essay').update(update).eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ message: 'Soal essay berhasil diperbarui' })
}

export async function DELETE(req: NextRequest, { params }: Params) {
  const auth = requireRole(req, ['GURU'])
  if ('error' in auth) return auth.error
  const { user } = auth
  const { id } = await params

  const db = createAdminClient()

  const { data: existing } = await db
    .from('soal_essay')
    .select('id, guru_id, jadwal_id')
    .eq('id', id)
    .single()

  if (!existing || existing.guru_id !== user.username) {
    return NextResponse.json({ error: 'Soal essay tidak ditemukan' }, { status: 404 })
  }

  // Jangan izinkan hapus soal essay kalau sesi untuk jadwal ini SUDAH BERJALAN
  // (siswa mungkin sudah mulai mengerjakan) — cegah data jawaban jadi yatim.
  const { data: sesiBerjalan } = await db
    .from('sesi_ujian')
    .select('id')
    .eq('jadwal_id', existing.jadwal_id)
    .eq('status', 'BERJALAN')
    .maybeSingle()

  if (sesiBerjalan) {
    return NextResponse.json(
      { error: 'Tidak bisa menghapus soal essay saat sesi ujian untuk jadwal ini sedang berjalan' },
      { status: 409 }
    )
  }

  const { error } = await db.from('soal_essay').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Kalau ini soal essay terakhir untuk jadwal tsb, matikan essay_aktif lagi
  const { count } = await db
    .from('soal_essay')
    .select('id', { count: 'exact', head: true })
    .eq('jadwal_id', existing.jadwal_id)

  if (!count) {
    await db.from('jadwal').update({ essay_aktif: false }).eq('id', existing.jadwal_id)
  }

  return NextResponse.json({ message: 'Soal essay berhasil dihapus' })
}
