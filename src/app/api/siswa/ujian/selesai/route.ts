import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'
import { generateId } from '@/lib/utils'

export async function POST(req: NextRequest) {
  const auth = requireRole(req, ['SISWA'])
  if ('error' in auth) return auth.error
  const { user } = auth

  const db = createAdminClient()
  const { sesiId, nis, isTimeout } = await req.json()

  if (nis !== user.nis) return NextResponse.json({ error: 'NIS tidak sesuai' }, { status: 403 })

  // Check already submitted
  const { data: nilaiExist } = await db
    .from('nilai')
    .select('id, nilai, grade, benar, total, lulus')
    .eq('sesi_id', sesiId)
    .eq('nis', nis)
    .single()

  if (nilaiExist) {
    return NextResponse.json({
      nilai: nilaiExist.nilai,
      grade: nilaiExist.grade,
      benar: nilaiExist.benar,
      total: nilaiExist.total,
      lulus: nilaiExist.lulus,
    })
  }

  // Get sesi info
  const { data: sesi } = await db
    .from('sesi_ujian')
    .select('mapel_id, kelas')
    .eq('id', sesiId)
    .single()

  if (!sesi) return NextResponse.json({ error: 'Sesi tidak ditemukan' }, { status: 404 })

  // Get KKM
  const { data: mapel } = await db
    .from('mapel')
    .select('kkm')
    .eq('id', sesi.mapel_id)
    .single()
  const kkm = mapel?.kkm ?? 75

  // Get all jawaban siswa
  const { data: jawabanSiswa } = await db
    .from('jawaban')
    .select('soal_id, jawaban')
    .eq('sesi_id', sesiId)
    .eq('nis', nis)

  if (!jawabanSiswa?.length) {
    // No answers submitted
    const nilaiData = { id: generateId('NIL'), sesi_id: sesiId, nis, mapel_id: sesi.mapel_id,
      kelas: sesi.kelas, benar: 0, total: 0, nilai: 0, grade: 'E', lulus: false, kkm, timestamp: new Date().toISOString() }
    await db.from('nilai').insert(nilaiData)
    await db.from('siswa_ujian').update({ status: 'SELESAI', waktu_selesai: new Date().toISOString() })
      .eq('sesi_id', sesiId).eq('nis', nis)
    return NextResponse.json({ nilai: 0, grade: 'E', benar: 0, total: 0, lulus: false })
  }

  // Get correct answers
  const soalIds = jawabanSiswa.map(j => j.soal_id)
  const { data: soalKunci } = await db
    .from('soal')
    .select('id, kunci')
    .in('id', soalIds)

  const kunciMap: Record<string, string> = Object.fromEntries(
    (soalKunci ?? []).map(s => [s.id, s.kunci])
  )

  let benar = 0
  const total = soalIds.length
  for (const j of jawabanSiswa) {
    if (j.jawaban && kunciMap[j.soal_id] === j.jawaban) benar++
  }

  const nilaiAngka = total > 0 ? Math.round((benar / total) * 100) : 0
  const grade = nilaiAngka >= 90 ? 'A' : nilaiAngka >= 80 ? 'B' : nilaiAngka >= 70 ? 'C' : nilaiAngka >= 60 ? 'D' : 'E'
  const lulus = nilaiAngka >= kkm

  // Save nilai
  const nilaiData = {
    id: generateId('NIL'),
    sesi_id: sesiId,
    nis,
    mapel_id: sesi.mapel_id,
    kelas: sesi.kelas,
    benar,
    total,
    nilai: nilaiAngka,
    grade,
    lulus,
    kkm,
    timestamp: new Date().toISOString(),
  }

  await db.from('nilai').insert(nilaiData)
  await db.from('siswa_ujian')
    .update({ status: 'SELESAI', waktu_selesai: new Date().toISOString() })
    .eq('sesi_id', sesiId)
    .eq('nis', nis)

  return NextResponse.json({ nilai: nilaiAngka, grade, benar, total, lulus })
}
