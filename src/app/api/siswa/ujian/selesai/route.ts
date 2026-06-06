import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'
import { generateId } from '@/lib/utils'

export async function POST(req: NextRequest) {
  const auth = requireRole(req, ['SISWA'])
  if ('error' in auth) return auth.error
  const { user } = auth

  const db = createAdminClient()
  const { sesiId, nis } = await req.json()

  if (nis !== user.nis) return NextResponse.json({ error: 'NIS tidak sesuai' }, { status: 403 })

  // Cek dulu apakah sudah pernah submit — early return
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

  // Ambil sesi dulu (butuh mapel_id dan kelas untuk query berikutnya)
  const { data: sesi } = await db
    .from('sesi_ujian')
    .select('mapel_id, kelas')
    .eq('id', sesiId)
    .single()

  if (!sesi) return NextResponse.json({ error: 'Sesi tidak ditemukan' }, { status: 404 })

  // Query mapel, paket, jawaban siswa — semua PARALEL (tidak saling bergantung)
  const [
    { data: mapel },
    { data: paketData },
    { data: jawabanSiswa },
  ] = await Promise.all([
    db.from('mapel').select('kkm').eq('id', sesi.mapel_id).single(),
    db.from('paket_soal')
      .select('id, jumlah_soal')
      .eq('mapel_id', sesi.mapel_id)
      .eq('kelas_id', sesi.kelas)
      .eq('status', 'DISETUJUI')
      .limit(1)
      .single(),
    db.from('jawaban').select('soal_id, jawaban').eq('sesi_id', sesiId).eq('nis', nis),
  ])

  const kkm = mapel?.kkm ?? 75

  // Hitung jumlah soal & ambil kunci — PARALEL
  const [{ count: totalSoalCount }, { data: soalKunci }] = await Promise.all([
    db.from('soal')
      .select('*', { count: 'exact', head: true })
      .eq('mapel_id', sesi.mapel_id)
      .eq('status', 'DISETUJUI')
      .eq('paket_id', paketData?.id ?? ''),
    jawabanSiswa?.length
      ? db.from('soal').select('id, kunci').in('id', jawabanSiswa.map(j => j.soal_id))
      : Promise.resolve({ data: [] }),
  ])

  const totalSoal = totalSoalCount ?? paketData?.jumlah_soal ?? 0

  // Hitung nilai
  const kunciMap: Record<string, string> = Object.fromEntries(
    (soalKunci ?? []).map(s => [s.id, s.kunci])
  )
  let benar = 0
  const total = totalSoal > 0 ? totalSoal : (jawabanSiswa?.length ?? 0)

  if (jawabanSiswa?.length) {
    for (const j of jawabanSiswa) {
      if (j.jawaban && kunciMap[j.soal_id] === j.jawaban) benar++
    }
  }

  const nilaiAngka = total > 0 ? Math.round((benar / total) * 100) : 0
  const grade = nilaiAngka >= 90 ? 'A' : nilaiAngka >= 80 ? 'B' : nilaiAngka >= 70 ? 'C' : nilaiAngka >= 60 ? 'D' : 'E'
  const lulus = nilaiAngka >= kkm

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

  // Simpan nilai + update status — PARALEL
  await Promise.all([
    db.from('nilai').insert(nilaiData),
    db.from('siswa_ujian')
      .update({ status: 'SELESAI', waktu_selesai: new Date().toISOString() })
      .eq('sesi_id', sesiId)
      .eq('nis', nis),
  ])

  return NextResponse.json({ nilai: nilaiAngka, grade, benar, total, lulus })
}
