import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'
import { sidDipantauUntuk } from '@/lib/dipantau'

export const dynamic = 'force-dynamic'

// GET /api/siswa/dipantau → { dipantau: boolean, sid?: string }
// Dipakai banner "Anda sedang dipantau admin" di luar halaman ujian (di halaman
// ujian status yang sama ikut di respons cek-sesi). Ringan: hanya baca peta
// yang di-cache 4 detik, bukan query per siswa.
export async function GET(req: NextRequest) {
  const auth = requireRole(req, ['SISWA'])
  if ('error' in auth) return auth.error
  const { user } = auth
  if (user.viewAs) return NextResponse.json({ dipantau: false })

  const sid = await sidDipantauUntuk(createAdminClient(), user.nis!)
  return NextResponse.json({ dipantau: !!sid, sid: sid ?? undefined })
}
