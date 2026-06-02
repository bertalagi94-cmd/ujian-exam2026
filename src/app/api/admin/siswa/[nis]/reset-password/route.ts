import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { createAdminClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'

export async function POST(req: NextRequest, { params }: { params: { nis: string } }) {
  const auth = requireRole(req, ['ADMIN'])
  if ('error' in auth) return auth.error

  const db = createAdminClient()
  const password_hash = await bcrypt.hash(params.nis, 10)

  const { error } = await db
    .from('siswa')
    .update({ password_hash })
    .eq('nis', params.nis)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ message: 'Password berhasil direset ke NIS' })
}
