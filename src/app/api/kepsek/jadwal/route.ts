import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'
import { getZonaWaktuSekolah } from '@/lib/pengaturan-waktu'

export async function GET(req: NextRequest) {
  const auth = requireRole(req, ['KEPSEK', 'ADMIN'])
  if ('error' in auth) return auth.error

  const db = createAdminClient()
  const { searchParams } = new URL(req.url)
  const status = searchParams.get('status')
  const kelas = searchParams.get('kelas')

  let query = db.from('jadwal').select('*').order('tanggal', { ascending: false }).order('sesi')
  if (status) query = query.eq('status', status)
  if (kelas) query = query.eq('kelas', kelas)

  const { data: rawData, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const zonaWaktu = await getZonaWaktuSekolah()

  if (!rawData?.length) return NextResponse.json({ data: [], zonaWaktu })

  const data = rawData as { id: string; tanggal: string; sesi: number; jam_mulai: string; jam_selesai: string; mapel_id: string; kelas: string; pengawas?: string; durasi: number; status: string }[]

  const mapelIds = [...new Set(data.map(r => r.mapel_id).filter(Boolean))]
  const { data: mapelListRaw } = mapelIds.length > 0 ? await db.from('mapel').select('id, nama').in('id', mapelIds) : { data: [] }
  const mapelList = (mapelListRaw ?? []) as { id: string; nama: string }[]
  const mapelMap = Object.fromEntries(mapelList.map(m => [m.id, m.nama]))

  const pengawasIds = [...new Set(data.map(r => r.pengawas).filter(Boolean))]
  const guruMap: Record<string, string> = {}
  if (pengawasIds.length > 0) {
    const { data: guruListRaw } = await db.from('users').select('username, nama').in('username', pengawasIds)
    const guruList = (guruListRaw ?? []) as { username: string; nama: string }[]
    for (const g of guruList) guruMap[g.username] = g.nama
  }

  // Hitung jumlah siswa yang sudah punya nilai untuk kombinasi mapel+kelas pada jadwal SELESAI,
  // supaya kepsek bisa lihat progres tanpa perlu masuk ke halaman lain.
  const selesaiData = data.filter(r => r.status === 'SELESAI')
  const nilaiAggMap: Record<string, number> = {}
  if (selesaiData.length) {
    const pasangan = [...new Set(selesaiData.map(r => `${r.mapel_id}__${r.kelas}`))]
    const orFilter = pasangan
      .map(p => {
        const idx = p.indexOf('__')
        const mapelId = p.slice(0, idx)
        const kelas = p.slice(idx + 2)
        return `and(mapel_id.eq.${mapelId},kelas.eq.${kelas})`
      })
      .join(',')
    const { data: nilaiRows } = await db
      .from('nilai')
      .select('mapel_id, kelas')
      .or(orFilter)
    for (const n of ((nilaiRows ?? []) as { mapel_id: string; kelas: string }[])) {
      const key = `${n.mapel_id}__${n.kelas}`
      nilaiAggMap[key] = (nilaiAggMap[key] ?? 0) + 1
    }
  }

  const enriched = data.map(r => ({
    ...r,
    nama_mapel: mapelMap[r.mapel_id] ?? r.mapel_id,
    nama_pengawas: r.pengawas ? (guruMap[r.pengawas] ?? r.pengawas) : null,
    jumlah_sudah_nilai: r.status === 'SELESAI' ? (nilaiAggMap[`${r.mapel_id}__${r.kelas}`] ?? 0) : null,
  }))

  return NextResponse.json({ data: enriched, zonaWaktu })
}
