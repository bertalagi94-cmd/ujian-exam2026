import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export async function GET() {
  const db = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  const { data, error } = await db
    .from('pengaturan')
    .select('key, value')
    .in('key', ['namaSekolah', 'kota', 'logoUrl'])

  if (error) {
    return NextResponse.json({ data: {} })
  }

  const result: Record<string, string> = {}
  data?.forEach(({ key, value }) => { result[key] = value ?? '' })

  return NextResponse.json({ data: result })
}
