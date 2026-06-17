import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'

export async function GET(req: NextRequest) {
  const auth = requireRole(req, ['KEPSEK', 'ADMIN'])
  if ('error' in auth) return auth.error

  const db = createAdminClient()
  const { searchParams } = new URL(req.url)
  const kelasFilter = searchParams.get('kelas')

  // Sumber kebenaran "mapel sudah diujiankan di kelas ini" = ada sesi_ujian SELESAI
  // untuk kombinasi mapel + kelas tersebut (konsisten dengan logika di admin/analisis-ujian).
  let sesiQuery = db
    .from('sesi_ujian')
    .select('id, mapel_id, kelas, waktu_mulai, waktu_selesai, jumlah_peserta')
    .eq('status', 'SELESAI')
    .order('waktu_selesai', { ascending: false })
  if (kelasFilter) sesiQuery = sesiQuery.eq('kelas', kelasFilter)

  const { data: sesiSelesai, error } = await sesiQuery
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  if (!sesiSelesai?.length) {
    return NextResponse.json({ kelasList: [], data: [] })
  }

  const sesiRows = sesiSelesai as { id: string; mapel_id: string; kelas: string; waktu_mulai: string; waktu_selesai: string; jumlah_peserta: number }[]

  // Ambil siswa AKTIF untuk semua kelas yang relevan
  const kelasIds = [...new Set(sesiRows.map(s => s.kelas))]
  const mapelIds = [...new Set(sesiRows.map(s => s.mapel_id))]

  const [{ data: siswaAll }, { data: mapelList }, { data: nilaiAll }] = await Promise.all([
    db.from('siswa').select('nis, nama, kelas').in('kelas', kelasIds).eq('status', 'AKTIF').neq('is_tester', 'YES'),
    db.from('mapel').select('id, nama').in('id', mapelIds),
    db.from('nilai').select('nis, kelas, mapel_id').in('kelas', kelasIds).in('mapel_id', mapelIds),
  ])

  const mapelMap = Object.fromEntries(((mapelList ?? []) as { id: string; nama: string }[]).map(m => [m.id, m.nama]))
  const siswaByKelas: Record<string, { nis: string; nama: string }[]> = {}
  for (const s of ((siswaAll ?? []) as { nis: string; nama: string; kelas: string }[])) {
    if (!siswaByKelas[s.kelas]) siswaByKelas[s.kelas] = []
    siswaByKelas[s.kelas].push({ nis: s.nis, nama: s.nama })
  }

  const sudahNilaiSet = new Set(
    ((nilaiAll ?? []) as { nis: string; kelas: string; mapel_id: string }[]).map(n => `${n.kelas}__${n.mapel_id}__${n.nis}`)
  )

  // Group per kombinasi kelas+mapel (ambil sesi terbaru saja per kombinasi, jaga-jaga ada ujian susulan/duplikat)
  const comboMap = new Map<string, { kelas: string; mapel_id: string; waktu_selesai: string; jumlah_peserta: number }>()
  for (const s of sesiRows) {
    const key = `${s.kelas}__${s.mapel_id}`
    const existing = comboMap.get(key)
    if (!existing || new Date(s.waktu_selesai) > new Date(existing.waktu_selesai)) {
      comboMap.set(key, { kelas: s.kelas, mapel_id: s.mapel_id, waktu_selesai: s.waktu_selesai, jumlah_peserta: s.jumlah_peserta })
    }
  }

  const data = [...comboMap.values()].map(combo => {
    const siswaKelas = siswaByKelas[combo.kelas] ?? []
    const totalSiswa = siswaKelas.length
    const siswaBelum = siswaKelas.filter(s => !sudahNilaiSet.has(`${combo.kelas}__${combo.mapel_id}__${s.nis}`))
    const jumlahSudah = totalSiswa - siswaBelum.length

    return {
      kelas: combo.kelas,
      mapel_id: combo.mapel_id,
      nama_mapel: mapelMap[combo.mapel_id] ?? combo.mapel_id,
      waktu_selesai: combo.waktu_selesai,
      totalSiswa,
      jumlahSudah,
      jumlahBelum: siswaBelum.length,
      siswaBelum: siswaBelum.sort((a, b) => a.nama.localeCompare(b.nama)),
    }
  }).sort((a, b) => a.kelas.localeCompare(b.kelas) || a.nama_mapel.localeCompare(b.nama_mapel))

  const kelasList = [...new Set((await db.from('siswa').select('kelas').eq('status', 'AKTIF').neq('is_tester', 'YES')).data?.map(s => s.kelas) ?? [])].sort()

  return NextResponse.json({ kelasList, data })
}
