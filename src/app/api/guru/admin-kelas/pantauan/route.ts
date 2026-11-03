import { NextRequest } from 'next/server'
import { pantauanAdminKelas } from '@/lib/admin-kelas-api'

export const dynamic = 'force-dynamic'

// GET /api/guru/admin-kelas/pantauan — siswa terkunci & sesi bermasalah di kelas wilayah (hanya baca).
export const GET = (req: NextRequest) => pantauanAdminKelas(req)
