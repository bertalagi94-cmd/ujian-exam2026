import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireDeveloper, YAYASAN_AWAL_ID } from '@/lib/tenant'
import { cacheDelPrefix } from '@/lib/cache'

// Aktif/nonaktifkan yayasan. Yayasan awal tidak boleh dinonaktifkan.
export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const auth = requireDeveloper(req)
  if ('error' in auth) return auth.error

  const { status } = await req.json().catch(() => ({}))
  if (!['AKTIF', 'NONAKTIF'].includes(status)) {
    return NextResponse.json({ error: 'Status harus AKTIF atau NONAKTIF' }, { status: 400 })
  }
  if (params.id === YAYASAN_AWAL_ID && status === 'NONAKTIF') {
    return NextResponse.json({ error: 'Yayasan awal tidak boleh dinonaktifkan' }, { status: 400 })
  }

  const { error } = await createAdminClient().from('yayasan').update({ status }).eq('id', params.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  cacheDelPrefix('yayasan:')
  return NextResponse.json({ message: 'Status diperbarui' })
}
