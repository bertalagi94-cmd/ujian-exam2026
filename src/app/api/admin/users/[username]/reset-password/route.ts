import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { tenantDb, yayasanIdDari } from '@/lib/tenant'
import { requireRole } from '@/lib/auth'

export async function POST(req: NextRequest, props: { params: Promise<{ username: string }> }) {
  const params = await props.params;
  const auth = requireRole(req, ['ADMIN'])
  if ('error' in auth) return auth.error

  const db = tenantDb(yayasanIdDari(auth.user))
  const password_hash = await bcrypt.hash(params.username, 10)

  // .select('username') agar akun yang tidak ada / bukan milik yayasan ini
  // (0 baris terubah) dijawab 404, bukan "berhasil".
  const { data, error } = await db
    .from('users')
    .update({ password_hash })
    .eq('username', params.username)
    .select('username')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data || data.length === 0) {
    return NextResponse.json({ error: 'Pengguna tidak ditemukan' }, { status: 404 })
  }
  return NextResponse.json({ message: 'Password direset ke username' })
}
