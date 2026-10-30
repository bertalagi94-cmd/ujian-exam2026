// GET /api/guru/admin-kelas/saya
// Apakah guru ini ditunjuk sebagai Admin Kelas, dan kelas mana saja.
// Dipakai sidebar untuk menampilkan/menyembunyikan menu "Admin Kelas".
import { NextRequest, NextResponse } from 'next/server'
import { requireRoleAktif } from '@/lib/status-akun'
import { tenantDb, yayasanIdDari } from '@/lib/tenant'
import { getKelasAdminKelas } from '@/lib/admin-kelas'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const auth = await requireRoleAktif(req, ['GURU'])
  if ('error' in auth) return auth.error
  const db = tenantDb(yayasanIdDari(auth.user))
  const kelas = await getKelasAdminKelas(db, auth.user.username)
  return NextResponse.json({ isAdminKelas: kelas.length > 0, kelas })
}
