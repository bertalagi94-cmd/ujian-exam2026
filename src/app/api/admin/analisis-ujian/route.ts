import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'

export async function GET(req: NextRequest) {
  const auth = requireRole(req, ['ADMIN', 'KEPSEK'])
  if ('error' in auth) return auth.error

  const db = createAdminClient()
  const { searchParams } = new URL(req.url)
  const sesiId = searchParams.get('sesi_id') ?? ''
  const filterMapel = searchParams.get('mapel_id') ?? ''

  // Ambil semua mapel
  let mapelQuery = db.from('mapel').select('id, nama, guru_id')
  if (filterMapel) mapelQuery = mapelQuery.eq('id', filterMapel)
  const { data: mapelList } = await mapelQuery.order('nama')

  const mapelIds = (mapelList ?? []).map(m => m.id)

  // Ambil daftar sesi ujian SELESAI
  let sesiQuery = db
    .from('sesi_ujian')
    .select('id, mapel_id, kelas, waktu_mulai, waktu_selesai, jumlah_peserta')
    .eq('status', 'SELESAI')
    .order('waktu_mulai', { ascending: false })

  if (mapelIds.length) sesiQuery = sesiQuery.in('mapel_id', mapelIds)

  const { data: sesiList } = await sesiQuery

  if (!sesiId) {
    const mapelMap = Object.fromEntries((mapelList ?? []).map(m => [m.id, m.nama]))
    const enrichedSesi = (sesiList ?? []).map(s => ({
      ...s,
      nama_mapel: mapelMap[s.mapel_id] ?? s.mapel_id,
    }))
    return NextResponse.json({ data: [], sesiList: enrichedSesi, mapelList: mapelList ?? [] })
  }

  // Validasi sesi
  const { data: sesiAll } = await db
    .from('sesi_ujian')
    .select('id, mapel_id, kelas, waktu_mulai, waktu_selesai, jumlah_peserta')
    .eq('id', sesiId)
    .single()

  if (!sesiAll) return NextResponse.json({ error: 'Sesi tidak ditemukan' }, { status: 404 })

  // Ambil semua jawaban di sesi ini
  const { data: jawabanAll, error: jawabanErr } = await db
    .from('jawaban')
    .select('soal_id, nis, jawaban')
    .eq('sesi_id', sesiId)

  if (jawabanErr) return NextResponse.json({ error: jawabanErr.message }, { status: 500 })

  const soalIds = [...new Set((jawabanAll ?? []).map(j => j.soal_id))]
  if (!soalIds.length) {
    const mapelMap = Object.fromEntries((mapelList ?? []).map(m => [m.id, m.nama]))
    const sesiListEnriched = (sesiList ?? []).map(s => ({ ...s, nama_mapel: mapelMap[s.mapel_id] ?? s.mapel_id }))
    return NextResponse.json({ data: [], sesiList: sesiListEnriched, mapelList: mapelList ?? [], sesi: sesiAll })
  }

  const { data: soalList } = await db
    .from('soal')
    .select('id, teks, kunci, opsi_a, opsi_b, opsi_c, opsi_d, opsi_e, tingkat, jumlah_opsi')
    .in('id', soalIds)

  const nisSet = [...new Set((jawabanAll ?? []).map(j => j.nis))]
  const { data: siswaList } = await db
    .from('siswa')
    .select('nis, nama')
    .in('nis', nisSet)

  const siswaMap = Object.fromEntries((siswaList ?? []).map(s => [s.nis, s.nama]))
  const soalMap = Object.fromEntries((soalList ?? []).map(s => [s.id, s]))

  const jawabanBySoal: Record<string, { opsi: string; nis: string }[]> = {}
  for (const j of jawabanAll ?? []) {
    if (!jawabanBySoal[j.soal_id]) jawabanBySoal[j.soal_id] = []
    if (j.jawaban) jawabanBySoal[j.soal_id].push({ opsi: j.jawaban, nis: j.nis })
  }

  const totalSiswa = nisSet.length

  const analisis = soalIds.map((soalId, idx) => {
    const soal = soalMap[soalId]
    if (!soal) return null

    const jawaban = jawabanBySoal[soalId] ?? []
    const totalDijawab = jawaban.length
    const benar = jawaban.filter(j => j.opsi === soal.kunci).length
    const salah = totalDijawab - benar
    const persenBenar = totalDijawab > 0 ? Math.round((benar / totalDijawab) * 100) : 0
    const persenSalah = totalDijawab > 0 ? 100 - persenBenar : 0

    const opsiList = ['A', 'B', 'C', 'D', 'E'].slice(0, soal.jumlah_opsi ?? 4)
    const distribusiJumlah: Record<string, number> = {}
    const distribusiSiswa: Record<string, { nis: string; nama: string }[]> = {}

    for (const o of opsiList) {
      distribusiJumlah[o] = 0
      distribusiSiswa[o] = []
    }

    for (const j of jawaban) {
      if (distribusiJumlah[j.opsi] !== undefined) {
        distribusiJumlah[j.opsi]++
        distribusiSiswa[j.opsi].push({ nis: j.nis, nama: siswaMap[j.nis] ?? j.nis })
      }
    }

    const nisMenjawab = new Set(jawaban.map(j => j.nis))
    const tidakMenjawab = nisSet
      .filter(n => !nisMenjawab.has(n))
      .map(n => ({ nis: n, nama: siswaMap[n] ?? n }))

    return {
      nomor: idx + 1,
      id: soalId,
      teks: soal.teks,
      kunci: soal.kunci,
      tingkat: soal.tingkat,
      opsi: {
        A: soal.opsi_a,
        B: soal.opsi_b,
        C: soal.opsi_c,
        D: soal.opsi_d,
        E: soal.opsi_e,
      },
      opsiList,
      totalDijawab,
      totalSiswa,
      benar,
      salah,
      persenBenar,
      persenSalah,
      distribusiJumlah,
      distribusiSiswa,
      tidakMenjawab,
    }
  }).filter(Boolean)

  analisis.sort((a, b) => (b!.persenSalah - a!.persenSalah))

  const dijawab = analisis.filter(a => a!.totalDijawab > 0)
  const ringkasan = {
    totalSoal: analisis.length,
    totalSiswa,
    rataPersenBenar: dijawab.length
      ? Math.round(dijawab.reduce((s, a) => s + a!.persenBenar, 0) / dijawab.length)
      : 0,
    soalMudah: dijawab.filter(a => a!.persenBenar >= 70).length,
    soalSedang: dijawab.filter(a => a!.persenBenar >= 40 && a!.persenBenar < 70).length,
    soalSulit: dijawab.filter(a => a!.persenBenar < 40).length,
  }

  const mapelMap = Object.fromEntries((mapelList ?? []).map(m => [m.id, m.nama]))
  const sesiListEnriched = (sesiList ?? []).map(s => ({ ...s, nama_mapel: mapelMap[s.mapel_id] ?? s.mapel_id }))
  const sesiEnriched = { ...sesiAll, nama_mapel: mapelMap[sesiAll.mapel_id] ?? sesiAll.mapel_id }

  return NextResponse.json({
    data: analisis,
    sesiList: sesiListEnriched,
    mapelList: mapelList ?? [],
    sesi: sesiEnriched,
    ringkasan,
  })
}
