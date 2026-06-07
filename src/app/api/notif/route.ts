// GET /api/notif
// Mengembalikan badge counts untuk sidebar sesuai role:
// - ADMIN: jumlah paket soal menunggu persetujuan
// - GURU: jumlah paket soal milik guru yang sudah DISETUJUI atau DITOLAK (belum dilihat)
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const auth = requireRole(req, ['ADMIN', 'GURU'])
  if ('error' in auth) return auth.error
  const { user } = auth

  const db = createAdminClient()

  if (user.role === 'ADMIN') {
    // Hitung paket soal yang menunggu validasi
    const { count } = await db
      .from('paket_soal')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'MENUNGGU')

    return NextResponse.json({
      validasiSoal: count ?? 0,
    })
  }

  if (user.role === 'GURU') {
    // Hitung paket soal milik guru yang baru disetujui atau ditolak
    // (status DISETUJUI atau DITOLAK yang belum di-acknowledge)
    // Pakai kolom notif_dibaca: jika null/false = belum dilihat
    const { count: disetujui } = await db
      .from('paket_soal')
      .select('*', { count: 'exact', head: true })
      .eq('guru_id', user.username)
      .in('status', ['DISETUJUI', 'DITOLAK'])
      .eq('notif_dibaca', false)

    return NextResponse.json({
      bankSoal: disetujui ?? 0,
    })
  }

  return NextResponse.json({})
}

// POST /api/notif — tandai notifikasi sudah dibaca (guru)
export async function POST(req: NextRequest) {
  const auth = requireRole(req, ['GURU'])
  if ('error' in auth) return auth.error
  const { user } = auth

  const db = createAdminClient()

  await db
    .from('paket_soal')
    .update({ notif_dibaca: true })
    .eq('guru_id', user.username)
    .in('status', ['DISETUJUI', 'DITOLAK'])
    .eq('notif_dibaca', false)

  return NextResponse.json({ message: 'Notifikasi ditandai sudah dibaca' })
}
