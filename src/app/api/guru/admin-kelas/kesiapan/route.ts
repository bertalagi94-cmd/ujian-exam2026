import { NextRequest } from 'next/server'
import { kesiapanAdminKelas } from '@/lib/admin-kelas-api'

export const dynamic = 'force-dynamic'

// GET /api/guru/admin-kelas/kesiapan — papan kesiapan ujian kelas wilayah (hanya baca).
export const GET = (req: NextRequest) => kesiapanAdminKelas(req)
