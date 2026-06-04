import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = requireRole(req, ['PENGAWAS', 'ADMIN'])
  if ('error' in auth) return auth.error

  const db = createAdminClient()
  const sesiId = params.id

  const { data: sesi } = await db
    .from('sesi_ujian')
    .select('jadwal_id, mapel_id, kelas, durasi')
    .eq('id', sesiId)
    .single()

  if (!sesi) return NextResponse.json({ error: 'Sesi tidak ditemukan' }, { status: 404 })

  // Close sesi
  await db.from('sesi_ujian').update({
    status: 'SELESAI',
    waktu_selesai: new Date().toISOString(),
  }).eq('id', sesiId)

  // Update jadwal status
  if (sesi.jadwal_id) {
    await db.from('jadwal').update({ status: 'SELESAI' }).eq('id', sesi.jadwal_id)
  }

  // Force-finish any still-active siswa
  await db.from('siswa_ujian')
    .update({ status: 'SELESAI', waktu_selesai: new Date().toISOString() })
    .eq('sesi_id', sesiId)
    .eq('status', 'AKTIF')

  return NextResponse.json({ message: 'Sesi berhasil ditutup' })
}
