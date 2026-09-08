// Taruh di: src/app/api/siswa/ujian/essay/jawab/route.ts
// Autosave jawaban essay MODE DIGITAL SAJA. Pola sama seperti
// src/app/api/siswa/ujian/sync/route.ts (untuk PG).
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'

// POST { sesiId, jawaban: [{ soal_essay_id, jawaban_teks }] }
export async function POST(req: NextRequest) {
  const auth = requireRole(req, ['SISWA'])
  if ('error' in auth) return auth.error
  const { user } = auth

  const db = createAdminClient()
  const { sesiId, jawaban } = await req.json()
  if (!sesiId) return NextResponse.json({ error: 'sesiId diperlukan' }, { status: 400 })

  const { data: sesi } = await db.from('sesi_ujian').select('status, info_json').eq('id', sesiId).single()
  if (!sesi) return NextResponse.json({ error: 'Sesi tidak ditemukan' }, { status: 404 })
  if (sesi.status !== 'BERJALAN') {
    return NextResponse.json({ error: 'Sesi ujian sudah ditutup, jawaban tidak bisa disimpan lagi.' }, { status: 409 })
  }
  if (sesi.info_json?.essay_mode_jawaban !== 'DIGITAL') {
    return NextResponse.json({ error: 'Sesi ini tidak menggunakan mode jawaban digital' }, { status: 400 })
  }

  const { data: siswaUjian } = await db
    .from('siswa_ujian')
    .select('status, status_essay')
    .eq('sesi_id', sesiId)
    .eq('nis', user.nis!)
    .single()

  if (!siswaUjian) return NextResponse.json({ error: 'Data ujian Anda tidak ditemukan' }, { status: 404 })
  if (siswaUjian.status === 'TERKUNCI' || siswaUjian.status === 'RESET') {
    return NextResponse.json({ error: 'Akses ujian Anda sedang dikunci/menunggu reset.' }, { status: 403 })
  }
  if (siswaUjian.status_essay !== 'MENGERJAKAN') {
    return NextResponse.json({ error: 'Sesi essay belum dimulai atau sudah selesai.' }, { status: 409 })
  }

  if (Array.isArray(jawaban) && jawaban.length > 0) {
    const records = jawaban.map((j: { soal_essay_id: string; jawaban_teks: string }) => ({
      sesi_id: sesiId,
      nis: user.nis!,
      soal_essay_id: j.soal_essay_id,
      jawaban_teks: j.jawaban_teks ?? '',
      updated_at: new Date().toISOString(),
    }))

    const { error } = await db
      .from('jawaban_essay')
      .upsert(records, { onConflict: 'sesi_id,nis,soal_essay_id' })

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const { count } = await db
    .from('jawaban_essay')
    .select('*', { count: 'exact', head: true })
    .eq('sesi_id', sesiId)
    .eq('nis', user.nis!)

  return NextResponse.json({ totalTersimpan: count ?? 0 })
}

// GET ?sesiId=... — pulihkan progres jawaban essay digital (refresh halaman)
export async function GET(req: NextRequest) {
  const auth = requireRole(req, ['SISWA'])
  if ('error' in auth) return auth.error
  const { user } = auth

  const db = createAdminClient()
  const { searchParams } = new URL(req.url)
  const sesiId = searchParams.get('sesiId')
  if (!sesiId) return NextResponse.json({ error: 'sesiId diperlukan' }, { status: 400 })

  const { data, error } = await db
    .from('jawaban_essay')
    .select('soal_essay_id, jawaban_teks')
    .eq('sesi_id', sesiId)
    .eq('nis', user.nis!)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ jawaban: data ?? [] })
}
