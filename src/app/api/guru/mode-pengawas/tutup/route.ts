import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'
import { verifySesiOwnership } from '@/lib/sesi-ownership'

export async function POST(req: NextRequest) {
  const auth = requireRole(req, ['GURU'])
  if ('error' in auth) return auth.error

  const db = createAdminClient()
  const { sesiId } = await req.json()

  // FIX: sebelumnya endpoint ini hanya mengecek role GURU, tidak mengecek
  // apakah guru pemanggil memang pengawas sesi ini — sehingga guru mana pun
  // bisa menutup (dan memicu auto-grade) sesi ujian milik guru lain kalau
  // memanggil API ini langsung.
  const sah = await verifySesiOwnership(db, sesiId, auth.user.username)
  if (!sah) {
    return NextResponse.json({ error: 'Anda bukan pengawas sesi ini' }, { status: 403 })
  }

  const { data: sesi } = await db
    .from('sesi_ujian')
    .select('jadwal_id')
    .eq('id', sesiId)
    .single()

  if (!sesi) return NextResponse.json({ error: 'Sesi tidak ditemukan' }, { status: 404 })

  await db.from('sesi_ujian').update({
    status: 'SELESAI',
    waktu_selesai: new Date().toISOString(),
  }).eq('id', sesiId)

  if (sesi.jadwal_id) {
    await db.from('jadwal').update({ status: 'SELESAI' }).eq('id', sesi.jadwal_id)
  }

  // FIX: tambahkan 'RESET' agar siswa yang sedang di-reset juga ikut diselesaikan
  await db.from('siswa_ujian')
    .update({ status: 'SELESAI', waktu_selesai: new Date().toISOString() })
    .eq('sesi_id', sesiId)
    .in('status', ['AKTIF', 'RESET'])   // ← FIX: was .eq('status', 'AKTIF')

  return NextResponse.json({ message: 'Sesi berhasil ditutup' })
}
