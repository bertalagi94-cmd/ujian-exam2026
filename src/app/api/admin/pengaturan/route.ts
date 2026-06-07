import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'
import { revalidatePath } from 'next/cache'

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

  const errors: string[] = []

  for (const { key, value } of settings as { key: string; value: string }[]) {
    // Cek apakah baris sudah ada
    const { data: existing } = await db
      .from('pengaturan')
      .select('key')
      .eq('key', key)
      .single()

    if (existing) {
      // UPDATE jika sudah ada
      const { error } = await db
        .from('pengaturan')
        .update({ value, updated_at: new Date().toISOString() })
        .eq('key', key)
      if (error) errors.push(`Gagal update ${key}: ${error.message}`)
    } else {
      // INSERT jika belum ada
      const { error } = await db
        .from('pengaturan')
        .insert({ key, value, updated_at: new Date().toISOString() })
      if (error) errors.push(`Gagal insert ${key}: ${error.message}`)
    }
  }

  if (errors.length > 0) {
    return NextResponse.json({ error: errors.join(', ') }, { status: 500 })
  }

  // Batalkan cache Next.js agar perubahan langsung tampil
  revalidatePath('/', 'layout')   // revalidate root layout (generateMetadata)
  revalidatePath('/login')        // revalidate halaman login
  revalidatePath('/admin')        // revalidate halaman admin

  return NextResponse.json({ message: 'Pengaturan berhasil disimpan' })
}
