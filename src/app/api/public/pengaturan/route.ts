import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

export async function GET() {
  const db = createAdminClient()

  const { data, error } = await db
    .from('pengaturan')
    .select('key, value')
    .in('key', ['namaSekolah', 'kota', 'logoUrl', 'batasPelanggaran'])

  if (error) {
    return NextResponse.json({ data: {} })
  }

  const result: Record<string, string> = {}
  data?.forEach(({ key, value }: { key: string; value: string }) => { result[key] = value ?? '' })

  return NextResponse.json({ data: result }, {
    headers: {
      'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
      'Pragma': 'no-cache',
      'Surrogate-Control': 'no-store',
    }
  })
}
