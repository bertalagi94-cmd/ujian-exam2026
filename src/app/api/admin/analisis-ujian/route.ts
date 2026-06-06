import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'

export async function GET(req: NextRequest) {
  const auth = requireRole(req, ['ADMIN', 'KEPSEK'])
  if ('error' in auth) return auth.error

  const db = createAdminClient()
  const { searchParams } = new URL(req.url)
  const filterMapel = searchParams.get('mapel_id') ?? ''
  const onlyMapel   = searchParams.get('only_mapel') === '1'
  const latest      = searchParams.get('latest') === '1'

  // Ambil semua mapel
  let mapelQuery = db.from('mapel').select('id, nama, guru_id')
  if (filterMapel) mapelQuery = mapelQuery.eq('id', filterMapel)
  const { data: mapelList } = await mapelQuery.order('nama')

  // Jika hanya butuh daftar mapel (load awal)
  if (onlyMapel) {
    // Hanya tampilkan mapel yang punya minimal satu sesi SELESAI
    const { data: sesiSelesai } = await db
      .from('sesi_ujian')
      .select('mapel_id')
      .eq('status', 'SELESAI')

    const mapelIdAda = new Set((sesiSelesai ?? []).map(s => s.mapel_id))
    const filtered   = (mapelList ?? []).filter(m => mapelIdAda.has(m.id))
    return NextResponse.json({
      mapelList: filtered,
      adaSesi: mapelIdAda.size > 0,
    })
  }

  // Harus ada mapel yang dipilih
  if (!filterMapel) {
    return NextResponse.json({ data: [], mapelList: mapelList ?? [] })
  }

  // Ambil sesi terbaru yang SELESAI untuk mapel ini
  const { data: sesiList } = await db
    .from('sesi_ujian')
    .select('id, mapel_id, kelas, waktu_mulai, waktu_selesai, jumlah_peserta')
    .eq('status', 'SELESAI')
    .eq('mapel_id', filterMapel)
    .order('waktu_mulai', { ascending: false })
    .limit(1)

  const sesiAll = sesiList?.[0] ?? null

  if (!sesiAll) {
    return NextResponse.json({ data: [], mapelList: mapelList ?? [] })
  }

  // Ambil semua jawaban di sesi ini
  const { data: jawabanAll, error: jawabanErr } = await db
    .from('jawaban')
    .select('soal_id, nis, jawaban')
    .eq('sesi_id', sesiAll.id)

  if (jawabanErr) return NextResponse.json({ error: jawabanErr.message }, { status: 500 })

  const soalIds = [...new Set((jawabanAll ?? []).map(j => j.soal_id))]
  if (!soalIds.length) {
    const mapelMap = Object.fromEntries((mapelList ?? []).map(m => [m.id, m.nama]))
    const sesiEnriched = { ...sesiAll, nama_mapel: mapelMap[sesiAll.mapel_id] ?? sesiAll.mapel_id }
    return NextResponse.json({ data: [], mapelList: mapelList ?? [], sesi: sesiEnriched })
  }

  const { data: soalList } = await db
    .from('soal')
    .select('id, teks, kunci, opsi_a, opsi_b, opsi_c, opsi_d, opsi_e, tingkat, jumlah_opsi')
    .in('id', soalIds)

  // nisSet = siswa yang SUDAH mengerjakan (punya jawaban di sesi ini)
  const nisSet = [...new Set((jawabanAll ?? []).map(j => j.nis))]

  // Ambil semua siswa yang terdaftar di sesi ini (jumlah_peserta dari jadwal/sesi)
  // Gunakan tabel peserta_sesi jika ada, fallback ke siswa yang punya jawaban
  const { data: pesertaSesi } = await db
    .from('peserta_sesi')
    .select('nis')
    .eq('sesi_id', sesiAll.id)

  // NIS semua peserta terdaftar (atau fallback ke yang punya jawaban)
  const semuaNis = pesertaSesi?.length
    ? pesertaSesi.map(p => p.nis)
    : nisSet

  // Siswa yang belum ujian = terdaftar tapi tidak punya satu pun jawaban
  const nisUdahUjian  = new Set(nisSet)
  const nisBelumUjian = semuaNis.filter(n => !nisUdahUjian.has(n))

  // Ambil nama semua siswa yang relevan
  const allNis = [...new Set([...nisSet, ...nisBelumUjian])]
  const { data: siswaList } = await db
    .from('siswa')
    .select('nis, nama')
    .in('nis', allNis)

  const siswaMap = Object.fromEntries((siswaList ?? []).map(s => [s.nis, s.nama]))
  const soalMap  = Object.fromEntries((soalList  ?? []).map(s => [s.id,  s]))

  const jawabanBySoal: Record<string, { opsi: string; nis: string }[]> = {}
  for (const j of jawabanAll ?? []) {
    if (!jawabanBySoal[j.soal_id]) jawabanBySoal[j.soal_id] = []
    if (j.jawaban) jawabanBySoal[j.soal_id].push({ opsi: j.jawaban, nis: j.nis })
  }

  const totalSiswa = nisSet.length  // hanya yang sudah ujian

  const analisis = soalIds.map((soalId, idx) => {
    const soal = soalMap[soalId]
    if (!soal) return null

    const jawaban      = jawabanBySoal[soalId] ?? []
    const totalDijawab = jawaban.length
    const benar        = jawaban.filter(j => j.opsi === soal.kunci).length
    const salah        = totalDijawab - benar
    const persenBenar  = totalDijawab > 0 ? Math.round((benar / totalDijawab) * 100) : 0
    const persenSalah  = totalDijawab > 0 ? 100 - persenBenar : 0

    const opsiList = ['A', 'B', 'C', 'D', 'E'].slice(0, soal.jumlah_opsi ?? 4)
    const distribusiJumlah: Record<string, number> = {}
    const distribusiSiswa:  Record<string, { nis: string; nama: string }[]> = {}

    for (const o of opsiList) {
      distribusiJumlah[o] = 0
      distribusiSiswa[o]  = []
    }

    for (const j of jawaban) {
      if (distribusiJumlah[j.opsi] !== undefined) {
        distribusiJumlah[j.opsi]++
        distribusiSiswa[j.opsi].push({ nis: j.nis, nama: siswaMap[j.nis] ?? j.nis })
      }
    }

    return {
      nomor: idx + 1,
      id: soalId,
      teks: soal.teks,
      kunci: soal.kunci,
      tingkat: soal.tingkat,
      opsi: { A: soal.opsi_a, B: soal.opsi_b, C: soal.opsi_c, D: soal.opsi_d, E: soal.opsi_e },
      opsiList,
      totalDijawab,
      totalSiswa,
      benar,
      salah,
      persenBenar,
      persenSalah,
      distribusiJumlah,
      distribusiSiswa,
    }
  }).filter(Boolean)

  analisis.sort((a, b) => (b!.persenSalah - a!.persenSalah))

  const dijawab  = analisis.filter(a => a!.totalDijawab > 0)
  const ringkasan = {
    totalSoal:        analisis.length,
    totalSiswa,
    totalPeserta:     semuaNis.length,
    rataPersenBenar: dijawab.length
      ? Math.round(dijawab.reduce((s, a) => s + a!.persenBenar, 0) / dijawab.length)
      : 0,
    soalMudah:  dijawab.filter(a => a!.persenBenar >= 70).length,
    soalSedang: dijawab.filter(a => a!.persenBenar >= 40 && a!.persenBenar < 70).length,
    soalSulit:  dijawab.filter(a => a!.persenBenar < 40).length,
    siswaBelumUjian: nisBelumUjian.map(n => ({ nis: n, nama: siswaMap[n] ?? n })),
  }

  const mapelMap     = Object.fromEntries((mapelList ?? []).map(m => [m.id, m.nama]))
  const sesiEnriched = { ...sesiAll, nama_mapel: mapelMap[sesiAll.mapel_id] ?? sesiAll.mapel_id }

  return NextResponse.json({
    data:      analisis,
    mapelList: mapelList ?? [],
    sesi:      sesiEnriched,
    ringkasan,
  })
}
