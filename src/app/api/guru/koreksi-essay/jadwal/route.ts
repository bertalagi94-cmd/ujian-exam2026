// Taruh di: src/app/api/guru/koreksi-essay/jadwal/route.ts
//
// FIX BUG: halaman "Koreksi Essay" sebelumnya memuat daftar sesi dari
// /api/guru/jadwal-pengawasan, yang isinya sesi-sesi di mana guru ini
// bertugas sebagai PENGAWAS RUANGAN. Akibatnya, guru pengampu mapel yang
// TIDAK kebagian jaga ruangan (mis. sesi diawasi guru piket lain) tidak
// pernah melihat sesi mapelnya sendiri di daftar ini, walau ada endpoint
// GET /api/guru/koreksi-essay yang sudah diperbaiki mengizinkan akses guru
// pengampu — daftar sesinya tetap tidak pernah muncul.
//
// GET — daftar jadwal ujian utk mapel yang DIAMPU guru ini (mapel.guru_id),
// yang sesi_ujian-nya sudah mengaktifkan essay, TANPA syarat siapa
// pengawasnya.
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'

export async function GET(req: NextRequest) {
  const auth = requireRole(req, ['GURU'])
  if ('error' in auth) return auth.error
  const { user } = auth

  const db = createAdminClient()

  const { data: mapelSaya } = await db
    .from('mapel')
    .select('id')
    .eq('guru_id', user.username)
  const mapelIds = (mapelSaya ?? []).map(m => m.id)
  if (!mapelIds.length) return NextResponse.json({ data: [] })

  const { data: jadwalList, error } = await db
    .from('jadwal')
    .select('id, tanggal, sesi, mapel_id, kelas')
    .in('mapel_id', mapelIds)
    .order('tanggal', { ascending: true })
    .order('sesi')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!jadwalList?.length) return NextResponse.json({ data: [] })

  const kelasIds = [...new Set(jadwalList.map(j => j.kelas).filter(Boolean))]
  const [{ data: mapelList }, { data: kelasList }] = await Promise.all([
    db.from('mapel').select('id, nama').in('id', mapelIds),
    db.from('kelas').select('id, nama').in('id', kelasIds),
  ])
  const mapelMap = Object.fromEntries((mapelList ?? []).map(m => [m.id, m.nama]))
  const kelasMap = Object.fromEntries((kelasList ?? []).map(k => [k.id, k.nama]))

  const jadwalIds = jadwalList.map(j => j.id)
  const { data: sesiList } = await db
    .from('sesi_ujian')
    .select('id, jadwal_id, status, info_json')
    .in('jadwal_id', jadwalIds)
    .order('waktu_mulai', { ascending: false })

  // Sesi terbaru per jadwal (data sudah diurutkan terbaru dulu).
  const sesiMap: Record<string, { id: string; status: string; info_json: Record<string, unknown> | null }> = {}
  for (const s of sesiList ?? []) {
    if (!sesiMap[s.jadwal_id]) sesiMap[s.jadwal_id] = s
  }

  const enriched = jadwalList
    .map(j => {
      const tanggal = j.tanggal?.slice(0, 10) ?? j.tanggal
      const sesi = sesiMap[j.id]
      return {
        id: j.id,
        tanggal,
        mapel_id: j.mapel_id,
        kelas: j.kelas,
        nama_mapel: mapelMap[j.mapel_id] ?? j.mapel_id,
        nama_kelas: kelasMap[j.kelas] ?? j.kelas,
        sesi_ujian: sesi ? { id: sesi.id, status: sesi.status, info_json: sesi.info_json } : null,
      }
    })
    // Hanya sesi yang essay-nya sudah aktif (soal essay disetujui & sesi sudah dibuka).
    .filter(j => j.sesi_ujian && (j.sesi_ujian.info_json as { essay_aktif?: boolean } | null)?.essay_aktif)

  return NextResponse.json({ data: enriched })
}
