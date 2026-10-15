import { NextRequest, NextResponse } from 'next/server'
import { tenantDb, yayasanIdDari } from '@/lib/tenant'
import { requireRole } from '@/lib/auth'

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = requireRole(req, ['GURU'])
  if ('error' in auth) return auth.error
  const { user } = auth

  const db = tenantDb(yayasanIdDari(auth.user))

  // Verifikasi kepemilikan paket
  const { data: paket } = await db
    .from('paket_soal')
    .select('guru_id')
    .eq('id', params.id)
    .single()

  if (!paket || paket.guru_id !== user.username) {
    return NextResponse.json({ error: 'Tidak memiliki izin' }, { status: 403 })
  }

  const { data, error } = await db
    .from('soal')
    .select('*')
    .eq('paket_id', params.id)
    .order('created_at')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ data: data ?? [] })
}
