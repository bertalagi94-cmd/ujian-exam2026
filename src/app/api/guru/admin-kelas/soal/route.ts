import { NextRequest } from 'next/server'
import { daftarPaketAdminKelas, aksiPaketAdminKelas } from '@/lib/admin-kelas-api'

export const dynamic = 'force-dynamic'

export const GET = (req: NextRequest) => daftarPaketAdminKelas(req, 'PG')
export const POST = (req: NextRequest) => aksiPaketAdminKelas(req, 'PG')
