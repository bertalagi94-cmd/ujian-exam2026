import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { getRangkumanJadwal } from '@/lib/rangkuman'

// GET /api/admin/jadwal/rangkuman
// Rangkuman kesiapan ujian untuk admin (lihat src/lib/rangkuman.ts untuk detail logika)
export async function GET(req: NextRequest) {
  const auth = requireRole(req, ['ADMIN'])
  if ('error' in auth) return auth.error

  const data = await getRangkumanJadwal()
  return NextResponse.json(data)
}
