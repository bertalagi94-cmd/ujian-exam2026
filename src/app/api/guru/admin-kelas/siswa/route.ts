import { NextRequest } from 'next/server'
import { daftarSiswaAdminKelas } from '@/lib/admin-kelas-api'

export const dynamic = 'force-dynamic'

// GET /api/guru/admin-kelas/siswa — siswa di kelas wilayah (untuk reset password).
export const GET = (req: NextRequest) => daftarSiswaAdminKelas(req)
