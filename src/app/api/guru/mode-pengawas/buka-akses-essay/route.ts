// Taruh di: src/app/api/guru/mode-pengawas/buka-akses-essay/route.ts
// POST { sesiId, nis? } — nis kosong = buka untuk SEMUA siswa yang sedang
// MENGERJAKAN essay di sesi ini sekaligus (tombol "Buka Akses Kirim Semua").
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'

export async function POST(req: NextRequest) {
  const auth = requireRole(req, ['GURU'])
  if ('error' in auth) return auth.error
  const { user } = auth

  const db = createAdminClient()
  const { sesiId, nis } = await req.json()
  if (!sesiId) return NextResponse.json({ error: 'sesiId diperlukan' }, { status: 400 })

  // Verifikasi guru ini adalah pengawas jadwal terkait sesi tsb.
  const { data: sesi } = await db
    .from('sesi_ujian')
    .select('id, jadwal_id, info_json')
    .eq('id', sesiId)
    .single()

  if (!sesi) return NextResponse.json({ error: 'Sesi tidak ditemukan' }, { status: 404 })

  const { data: jadwal } = await db
    .from('jadwal')
    .select('id, pengawas')
    .eq('id', sesi.jadwal_id)
    .eq('pengawas', user.username)
    .single()

  if (!jadwal) {
    return NextResponse.json({ error: 'Anda bukan pengawas sesi ini' }, { status: 403 })
  }

  if (sesi.info_json?.essay_mode_jawaban !== 'KERTAS') {
    return NextResponse.json({ error: 'Sesi ini tidak menggunakan mode jawaban kertas' }, { status: 400 })
  }

  let query = db
    .from('siswa_ujian')
    .update({ akses_kirim_essay_dibuka: true })
    .eq('sesi_id', sesiId)

  if (nis) {
    query = query.eq('nis', nis)
  } else {
    query = query.eq('status_essay', 'MENGERJAKAN')
  }

  const { error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({
    message: nis ? `Akses kirim dibuka untuk siswa ${nis}` : 'Akses kirim dibuka untuk semua siswa yang sedang mengerjakan essay',
  })
}
