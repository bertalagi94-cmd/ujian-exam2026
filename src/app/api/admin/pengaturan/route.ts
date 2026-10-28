import { NextRequest, NextResponse } from 'next/server'
import { tenantDb, yayasanIdDari } from '@/lib/tenant'
import { requireRole } from '@/lib/auth'
import { revalidatePath } from 'next/cache'
import { cacheDelPrefix } from '@/lib/cache'

// Kunci yang BUKAN milik sekolah: diatur developer (lihat src/lib/pengaturan-global.ts).
// Dibuang dari penulisan supaya admin sekolah tidak bisa mengubahnya lewat endpoint ini.
const KUNCI_HANYA_DEVELOPER = new Set(['logoAplikasi'])

export async function GET(req: NextRequest) {
  const auth = requireRole(req, ['ADMIN'])
  if ('error' in auth) return auth.error

  const db = tenantDb(yayasanIdDari(auth.user))
  const { data, error } = await db.from('pengaturan').select('*').order('key')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ data: data ?? [] })
}

export async function PUT(req: NextRequest) {
  const auth = requireRole(req, ['ADMIN'])
  if ('error' in auth) return auth.error

  const db = tenantDb(yayasanIdDari(auth.user))
  const { settings } = await req.json()

  if (!Array.isArray(settings)) {
    return NextResponse.json({ error: 'Format tidak valid' }, { status: 400 })
  }

  // Sebelumnya: loop N × (select + insert/update) = N*2 query serial.
  // Sekarang: 1 upsert batch untuk semua settings sekaligus.
  const now = new Date().toISOString()
  const records = (settings as { key: string; value: string }[])
    .filter(({ key }) => !KUNCI_HANYA_DEVELOPER.has(String(key)))
    .map(({ key, value }) => ({ key, value, updated_at: now }))

  if (records.length === 0) {
    return NextResponse.json({ message: 'Pengaturan berhasil disimpan' })
  }

  const { error } = await db
    .from('pengaturan')
    .upsert(records, { onConflict: 'yayasan_id,key' })

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
