import { NextRequest } from 'next/server'
import { soalPaketAdminKelas } from '@/lib/admin-kelas-api'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params
  return soalPaketAdminKelas(req, 'ESSAY', id)
}
