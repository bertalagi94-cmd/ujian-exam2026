import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { cachedFetch } from '@/lib/cache'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    // In-memory cache 60 dtk — menggantikan query DB setiap halaman load.
    // Jika admin update pengaturan, cache expire dalam maks 60 dtk.
    const result = await cachedFetch<Record<string, string>>('pengaturan:public', 60, async () => {
      const db = createAdminClient()
      const { data, error } = await db
        .from('pengaturan')
        .select('key, value')
        .in('key', ['namaSekolah', 'tahunAjaran', 'kota', 'logoUrl', 'batasPelanggaran', 'jumlahOpsi'])

      if (error) return {}
      const map: Record<string, string> = {}
      data?.forEach(({ key, value }: { key: string; value: string }) => { map[key] = value ?? '' })
      return map
    })

    return NextResponse.json({ data: result }, {
      headers: {
        // CDN Vercel cache 60 dtk, stale-while-revalidate 5 menit
        // Sebelumnya: no-store → query DB setiap request
        'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300',
      },
    })
  } catch {
    return NextResponse.json({ data: {} })
  }
}
