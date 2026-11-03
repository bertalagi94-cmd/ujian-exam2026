import { NextRequest } from 'next/server'
import { resetPasswordSiswaAdminKelas } from '@/lib/admin-kelas-api'

export const dynamic = 'force-dynamic'

// POST /api/guru/admin-kelas/siswa/[nis]/reset-password
// Hanya siswa di kelas wilayah Admin Kelas; dicatat di log_aktivitas.
export async function POST(req: NextRequest, props: { params: Promise<{ nis: string }> }) {
  const { nis } = await props.params
  return resetPasswordSiswaAdminKelas(req, nis)
}
