import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'

export async function GET(req: NextRequest) {
  const auth = requireRole(req, ['SISWA'])
  if ('error' in auth) return auth.error
  const { user } = auth
  const db = createAdminClient()

  const { data: nilaiList, error } = await db
    .from('nilai')
    .select('*')
    .eq('nis', user.nis!)
    .order('timestamp', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const mapelIds = [...new Set((nilaiList ?? []).map(r => r.mapel_id).filter(Boolean))]
  const { data: mapelList } = await db.from('mapel').select('id, nama').in('id', mapelIds.length ? mapelIds : ['__'])
  const mapelMap = Object.fromEntries((mapelList ?? []).map(m => [m.id, m.nama]))

  const enriched = (nilaiList ?? []).map(n => ({
    ...n,
    nama_mapel: mapelMap[n.mapel_id] ?? n.mapel_id,
  }))

  const nums = enriched.map(n => n.nilai || 0)
  const stats = {
    totalUjian: nums.length,
    rataRata: nums.length ? Math.round(nums.reduce((a, b) => a + b, 0) / nums.length) : 0,
    nilaiTertinggi: nums.length ? Math.max(...nums) : 0,
    nilaiTerendah: nums.length ? Math.min(...nums) : 0,
  }

  return NextResponse.json({ data: enriched, stats })
}
