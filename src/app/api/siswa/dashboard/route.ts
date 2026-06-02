import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'

export async function GET(req: NextRequest) {
  const auth = requireRole(req, ['SISWA'])
  if ('error' in auth) return auth.error
  const { user } = auth
  const db = createAdminClient()
  const nis = user.nis!

  const [{ data: nilaiAll }, { data: jadwal }] = await Promise.all([
    db.from('nilai').select('*').eq('nis', nis).order('timestamp', { ascending: false }),
    db.from('jadwal').select('*').eq('kelas', user.kelas!).eq('status', 'AKTIF').order('tanggal').limit(5),
  ])

  const nums = (nilaiAll ?? []).map(n => n.nilai || 0)
  const stats = {
    totalUjian: nums.length,
    rataRata: nums.length ? Math.round(nums.reduce((a, b) => a + b, 0) / nums.length) : 0,
    nilaiTertinggi: nums.length ? Math.max(...nums) : 0,
    nilaiTerendah: nums.length ? Math.min(...nums) : 0,
  }

  // Enrich nilai with mapel names
  const recentNilai = (nilaiAll ?? []).slice(0, 6)
  const mapelIds = [...new Set(recentNilai.map(r => r.mapel_id).filter(Boolean))]
  const { data: mapelList } = await db.from('mapel').select('id, nama').in('id', mapelIds)
  const mapelMap = Object.fromEntries((mapelList ?? []).map(m => [m.id, m.nama]))

  const enrichedNilai = recentNilai.map(r => ({
    ...r,
    nama_mapel: mapelMap[r.mapel_id] ?? r.mapel_id,
  }))

  // Enrich jadwal
  const jMapelIds = [...new Set((jadwal ?? []).map(j => j.mapel_id).filter(Boolean))]
  const { data: jMapelList } = await db.from('mapel').select('id, nama').in('id', jMapelIds.length ? jMapelIds : ['__'])
  const jMapelMap = Object.fromEntries((jMapelList ?? []).map(m => [m.id, m.nama]))
  const enrichedJadwal = (jadwal ?? []).map(j => ({
    ...j,
    nama_mapel: jMapelMap[j.mapel_id] ?? j.mapel_id,
  }))

  return NextResponse.json({
    stats,
    nilaiTerbaru: enrichedNilai,
    jadwalMendatang: enrichedJadwal,
  })
}
