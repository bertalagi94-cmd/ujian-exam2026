import { NextRequest, NextResponse } from 'next/server'
import { requireRoleAktif } from '@/lib/status-akun'
import { yayasanIdDari } from '@/lib/tenant'
import { getRangkumanJadwal } from '@/lib/rangkuman'

// GET /api/admin/jadwal/rangkuman
// Rangkuman kesiapan ujian untuk admin (lihat src/lib/rangkuman.ts untuk detail logika)
export async function GET(req: NextRequest) {
  const auth = await requireRoleAktif(req, ['ADMIN'])
  if ('error' in auth) return auth.error

  const data = await getRangkumanJadwal(yayasanIdDari(auth.user))
  return NextResponse.json(data)
}
