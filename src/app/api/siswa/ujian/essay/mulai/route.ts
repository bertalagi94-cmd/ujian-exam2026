// Taruh di: src/app/api/siswa/ujian/essay/mulai/route.ts
// POST { sesiId } — mulai timer essay (idempotent: kalau sudah MENGERJAKAN, kembalikan waktu_mulai_essay yang sudah ada, jangan reset timer)
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'

export async function POST(req: NextRequest) {
  const auth = requireRole(req, ['SISWA'])
  if ('error' in auth) return auth.error
  const { user } = auth

  const db = createAdminClient()
  const { sesiId } = await req.json()
  if (!sesiId) return NextResponse.json({ error: 'sesiId diperlukan' }, { status: 400 })

  const { data: siswaUjian } = await db
    .from('siswa_ujian')
    .select('status, status_essay, waktu_mulai_essay')
    .eq('sesi_id', sesiId)
    .eq('nis', user.nis!)
    .single()

  if (!siswaUjian) return NextResponse.json({ error: 'Data ujian Anda tidak ditemukan' }, { status: 404 })

  if (siswaUjian.status === 'TERKUNCI' || siswaUjian.status === 'RESET') {
    return NextResponse.json(
      { error: 'Akses ujian Anda sedang dikunci/menunggu reset.' },
      { status: 403 }
    )
  }

  if (siswaUjian.status_essay === 'SUDAH_KIRIM' || siswaUjian.status_essay === 'TIDAK_MENGERJAKAN') {
    return NextResponse.json({ error: 'Essay sudah selesai dikerjakan' }, { status: 409 })
  }

  // Idempotent: kalau sudah pernah mulai (mis. refresh halaman), JANGAN reset
  // waktu_mulai_essay — ini referensi timer yang tidak boleh berubah, sama
  // seperti pola waktu_mulai_awal untuk PG.
  if (siswaUjian.status_essay === 'MENGERJAKAN' && siswaUjian.waktu_mulai_essay) {
    return NextResponse.json({ waktuMulaiEssay: siswaUjian.waktu_mulai_essay })
  }

  const waktuMulaiEssay = new Date().toISOString()
  const { error } = await db
    .from('siswa_ujian')
    .update({ status_essay: 'MENGERJAKAN', waktu_mulai_essay: waktuMulaiEssay })
    .eq('sesi_id', sesiId)
    .eq('nis', user.nis!)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ waktuMulaiEssay })
}
