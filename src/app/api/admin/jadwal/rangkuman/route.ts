import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'

// GET /api/admin/jadwal/rangkuman
// Rangkuman kesiapan ujian untuk admin:
// 1. belum_dijadwalkan   -> kombinasi mapel x kelas (dari kelas_list mapel) yang belum punya jadwal
// 2. belum_ada_soal      -> kombinasi mapel x kelas yang belum punya paket soal DISETUJUI
// 3. guru_belum_mengawas -> guru aktif yang belum pernah ditugaskan sebagai pengawas di jadwal manapun
export async function GET(req: NextRequest) {
  const auth = requireRole(req, ['ADMIN'])
  if ('error' in auth) return auth.error

  const db = createAdminClient()

  const [{ data: mapelRaw }, { data: jadwalRaw }, { data: paketRaw }, { data: guruRaw }] = await Promise.all([
    (db as any).from('mapel').select('id, nama, kelas_list'),
    (db as any).from('jadwal').select('mapel_id, kelas, pengawas'),
    (db as any).from('paket_soal').select('mapel_id, kelas_id, status'),
    (db as any).from('users').select('username, nama, status').eq('role', 'GURU'),
  ])

  const mapelList = (mapelRaw ?? []) as { id: string; nama: string; kelas_list: string | null }[]
  const jadwalList = (jadwalRaw ?? []) as { mapel_id: string; kelas: string; pengawas: string | null }[]
  const paketList = (paketRaw ?? []) as { mapel_id: string; kelas_id: string; status: string }[]
  const guruList = (guruRaw ?? []) as { username: string; nama: string; status: string }[]

  // Ambil semua nama kelas yang dipakai di kelas_list mapel, untuk mapping nama -> id
  const semuaNamaKelas = new Set<string>()
  for (const m of mapelList) {
    if (m.kelas_list) {
      m.kelas_list.split(',').map(k => k.trim()).filter(Boolean).forEach(k => semuaNamaKelas.add(k))
    }
  }
  const { data: kelasRaw } = semuaNamaKelas.size > 0
    ? await (db as any).from('kelas').select('id, nama').in('nama', [...semuaNamaKelas])
    : { data: [] }
  const kelasList = (kelasRaw ?? []) as { id: string; nama: string }[]
  const namaKeId = Object.fromEntries(kelasList.map(k => [k.nama, k.id]))

  // Set kombinasi mapel_id__kelasNama yang sudah terjadwal
  const sudahTerjadwal = new Set(jadwalList.map(j => `${j.mapel_id}__${j.kelas}`))

  // Status paket soal terbaik per mapel_id__kelas_id
  const statusPriority: Record<string, number> = { DISETUJUI: 4, MENUNGGU: 3, DITOLAK: 2, DRAFT: 1 }
  const paketStatusMap: Record<string, string> = {}
  for (const p of paketList) {
    const key = `${p.mapel_id}__${p.kelas_id}`
    const existing = paketStatusMap[key]
    if (!existing || (statusPriority[p.status] ?? 0) > (statusPriority[existing] ?? 0)) {
      paketStatusMap[key] = p.status
    }
  }

  const belumDijadwalkan: { mapel_id: string; nama_mapel: string; kelas: string }[] = []
  const belumAdaSoal: { mapel_id: string; nama_mapel: string; kelas: string; status_soal: string }[] = []

  for (const m of mapelList) {
    const kelasNamaArr = m.kelas_list ? m.kelas_list.split(',').map(k => k.trim()).filter(Boolean) : []
    for (const namaKelas of kelasNamaArr) {
      if (!sudahTerjadwal.has(`${m.id}__${namaKelas}`)) {
        belumDijadwalkan.push({ mapel_id: m.id, nama_mapel: m.nama, kelas: namaKelas })
      }

      const kelasId = namaKeId[namaKelas]
      const statusSoal = kelasId ? (paketStatusMap[`${m.id}__${kelasId}`] ?? 'BELUM_ADA') : 'BELUM_ADA'
      if (statusSoal !== 'DISETUJUI') {
        belumAdaSoal.push({ mapel_id: m.id, nama_mapel: m.nama, kelas: namaKelas, status_soal: statusSoal })
      }
    }
  }

  // Guru aktif yang belum pernah ditugaskan mengawas di jadwal manapun
  const guruPernahMengawas = new Set(jadwalList.map(j => j.pengawas).filter(Boolean))
  const guruBelumMengawas = guruList
    .filter(g => g.status !== 'NONAKTIF' && !guruPernahMengawas.has(g.username))
    .map(g => ({ username: g.username, nama: g.nama }))

  return NextResponse.json({
    belum_dijadwalkan: belumDijadwalkan,
    belum_ada_soal: belumAdaSoal,
    guru_belum_mengawas: guruBelumMengawas,
  })
}
