import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'
import { revalidatePath } from 'next/cache'
import { cacheDelPrefix } from '@/lib/cache'

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

  // Sebelumnya: loop N × (select + insert/update) = N*2 query serial.
  // Sekarang: 1 upsert batch untuk semua settings sekaligus.
  const now = new Date().toISOString()
  const records = (settings as { key: string; value: string }[]).map(({ key, value }) => ({
    key, value, updated_at: now,
  }))

  const { error } = await db
    .from('pengaturan')
    .upsert(records, { onConflict: 'key' })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Invalidasi in-memory cache agar perubahan langsung aktif
  cacheDelPrefix('pengaturan:')

  // Batalkan cache Next.js agar perubahan langsung tampil
  revalidatePath('/', 'layout')
  revalidatePath('/login')
  revalidatePath('/admin')

  return NextResponse.json({ message: 'Pengaturan berhasil disimpan' })
}
