import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'

export async function GET(req: NextRequest) {
  const auth = requireRole(req, ['ADMIN'])
  if ('error' in auth) return auth.error

  const db = createAdminClient()
  const { data, error } = await db.from('pengaturan').select('*').order('key')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ data: data ?? [] })
}

export async function PUT(req: NextRequest) {
  const auth = requireRole(req, ['ADMIN'])
  if ('error' in auth) return auth.error

  const db = createAdminClient()
  const { settings } = await req.json()

  if (!Array.isArray(settings)) {
    return NextResponse.json({ error: 'Format tidak valid' }, { status: 400 })
  }

  const updates = settings.map(({ key, value }: { key: string; value: string }) =>
    db.from('pengaturan').upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: 'key' })
  )

  await Promise.all(updates)
  return NextResponse.json({ message: 'Pengaturan berhasil disimpan' })
}
