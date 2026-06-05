import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'

// GET /api/siswa/ujian/cek-sesi?sesiId=xxx
// Digunakan siswa untuk polling apakah sesi masih BERJALAN atau sudah SELESAI
export async function GET(req: NextRequest) {
  const auth = requireRole(req, ['SISWA'])
  if ('error' in auth) return auth.error
  const { user } = auth

  const db = createAdminClient()
  const { searchParams } = new URL(req.url)
  const sesiId = searchParams.get('sesiId')

  if (!sesiId) return NextResponse.json({ error: 'sesiId diperlukan' }, { status: 400 })

  const { data: sesi } = await db
    .from('sesi_ujian')
    .select('id, status')
    .eq('id', sesiId)
    .single()

  if (!sesi) return NextResponse.json({ sesi_status: 'TIDAK_DITEMUKAN' })

  // Cek juga apakah siswa di-reset atau di-kunci
  const { data: siswaUjian } = await db
    .from('siswa_ujian')
    .select('status')
    .eq('sesi_id', sesiId)
    .eq('nis', user.nis!)
    .single()

  return NextResponse.json({
    sesi_status: sesi.status,
    siswa_status: siswaUjian?.status ?? 'TIDAK_TERDAFTAR',
  })
}
