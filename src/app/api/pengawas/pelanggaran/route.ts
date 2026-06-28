import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'
import { verifySesiOwnership } from '@/lib/sesi-ownership'

export async function GET(req: NextRequest) {
  const auth = requireRole(req, ['GURU', 'ADMIN'])
  if ('error' in auth) return auth.error

  const db = createAdminClient()
  const { searchParams } = new URL(req.url)
  const sesiId = searchParams.get('sesiId')

  // FIX: sebelumnya GURU bisa memanggil endpoint ini tanpa sesiId (atau
  // dengan sesiId milik guru lain) dan tetap mendapat data pelanggaran —
  // tidak ada pengecekan kepemilikan sesi. ADMIN tetap tidak dibatasi.
  if (auth.user.role === 'GURU') {
    if (!sesiId) {
      return NextResponse.json({ error: 'sesiId diperlukan' }, { status: 400 })
    }
    const sah = await verifySesiOwnership(db, sesiId, auth.user.username)
    if (!sah) {
      return NextResponse.json({ error: 'Anda bukan pengawas sesi ini' }, { status: 403 })
    }
  }

  let query = db
    .from('pelanggaran')
    .select('id, sesi_id, nis, jenis, level, detail, status, created_at')
    .order('created_at', { ascending: false })
    .limit(50)

  if (sesiId) query = query.eq('sesi_id', sesiId)

  const { data: pelanggaran, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!pelanggaran?.length) return NextResponse.json({ data: [] })

  // Ambil nama siswa
  const nisList = [...new Set(pelanggaran.map(p => p.nis).filter(Boolean))]
  const { data: siswaList } = await db
    .from('siswa')
    .select('nis, nama')
    .in('nis', nisList)
  const siswaMap = Object.fromEntries((siswaList ?? []).map(s => [s.nis, s.nama]))

  return NextResponse.json({
    data: pelanggaran.map(p => ({
      ...p,
      nama_siswa: siswaMap[p.nis] ?? p.nis,
    }))
  })
}
