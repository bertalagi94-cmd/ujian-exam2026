import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'
import { generateId } from '@/lib/utils'

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = requireRole(req, ['GURU'])
  if ('error' in auth) return auth.error
  const { user } = auth

  const db = createAdminClient()
  const body = await req.json()
  const { kelas_id: kelasTarget } = body

  if (!kelasTarget) {
    return NextResponse.json({ error: 'Kelas tujuan wajib dipilih' }, { status: 400 })
  }

  const { data: paketSumber } = await db
    .from('paket_essay')
    .select('*')
    .eq('id', params.id)
    .eq('guru_id', user.username)
    .single()

  if (!paketSumber) {
    return NextResponse.json({ error: 'Paket tidak ditemukan atau bukan milik Anda' }, { status: 404 })
  }

  // FIX BUG: sama seperti /api/guru/paket/[id]/duplicate — sebelumnya
  // kelas_id dari body diterima tanpa verifikasi apakah guru pemilik paket
  // ini benar-benar mengampu mapel tsb di kelas tujuan. Validasi terhadap
  // kelas_list milik baris `mapel` paket sumber.
  const { data: mapelSumber } = await db
    .from('mapel')
    .select('kelas_list')
    .eq('id', paketSumber.mapel_id)
    .single()
  const { data: kelasTujuanRow } = await db
    .from('kelas')
    .select('nama')
    .eq('id', kelasTarget)
    .single()
  const kelasDiMapel = (mapelSumber?.kelas_list ?? '').split(',').map((s: string) => s.trim()).filter(Boolean)
  if (!kelasTujuanRow || !kelasDiMapel.includes(kelasTujuanRow.nama)) {
    return NextResponse.json(
      { error: 'Anda tidak mengampu mata pelajaran ini di kelas tujuan tersebut.' },
      { status: 403 }
    )
  }

  const { data: existing } = await db
    .from('paket_essay')
    .select('id')
    .eq('guru_id', user.username)
    .eq('mapel_id', paketSumber.mapel_id)
    .eq('kelas_id', kelasTarget)
    .in('status', ['DRAFT', 'MENUNGGU', 'DISETUJUI'])
    .maybeSingle()

  if (existing) {
    return NextResponse.json({ error: 'Anda sudah memiliki paket aktif untuk mapel dan kelas tersebut' }, { status: 400 })
  }

  const newPaketId = generateId('PKE')
  const { error: paketErr } = await db.from('paket_essay').insert({
    id: newPaketId,
    mapel_id: paketSumber.mapel_id,
    kelas_id: kelasTarget,
    guru_id: user.username,
    status: 'DRAFT',
    jumlah_soal: 0,
    mode_jawaban: paketSumber.mode_jawaban,
    durasi_menit: paketSumber.durasi_menit,
    bobot_pg_persen: paketSumber.bobot_pg_persen,
    bobot_essay_persen: paketSumber.bobot_essay_persen,
  })

  if (paketErr) return NextResponse.json({ error: paketErr.message }, { status: 500 })

  const { data: soalSumber } = await db
    .from('soal_essay')
    .select('*')
    .eq('paket_essay_id', params.id)
    .order('urutan', { ascending: true })

  if (soalSumber && soalSumber.length > 0) {
    const soalBaru = soalSumber.map((s: Record<string, unknown>, idx: number) => ({
      id: generateId('SE'),
      paket_essay_id: newPaketId,
      mapel_id: paketSumber.mapel_id,
      kelas_id: kelasTarget,
      guru_id: user.username,
      teks: s.teks,
      gambar_url: s.gambar_url || null,
      bobot_maks: s.bobot_maks,
      urutan: idx + 1,
      status: 'DRAFT',
    }))

    const { error: soalErr } = await db.from('soal_essay').insert(soalBaru)
    if (soalErr) {
      await db.from('paket_essay').delete().eq('id', newPaketId)
      return NextResponse.json({ error: soalErr.message }, { status: 500 })
    }

    await db.from('paket_essay').update({ jumlah_soal: soalBaru.length }).eq('id', newPaketId)
  }

  return NextResponse.json({ message: 'Paket berhasil diduplikasi', id: newPaketId }, { status: 201 })
}
