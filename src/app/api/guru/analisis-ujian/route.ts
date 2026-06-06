import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'

export async function GET(req: NextRequest) {
  const auth = requireRole(req, ['GURU'])
  if ('error' in auth) return auth.error
  const { user } = auth

  const db = createAdminClient()
  const { searchParams } = new URL(req.url)
  const sesiId = searchParams.get('sesi_id') ?? ''

  // Ambil mapel yang diajar guru ini
  const { data: guruMapel } = await db
    .from('mapel')
    .select('id, nama')
    .eq('guru_id', user.username)

  const mapelIds = (guruMapel ?? []).map(m => m.id)
  if (!mapelIds.length) return NextResponse.json({ data: [], sesiList: [], mapelList: [] })

  // Ambil daftar sesi ujian yang sudah SELESAI untuk mapel guru ini
  const { data: sesiList } = await db
    .from('sesi_ujian')
    .select('id, mapel_id, kelas, waktu_mulai, waktu_selesai, jumlah_peserta')
    .in('mapel_id', mapelIds)
    .eq('status', 'SELESAI')
    .order('waktu_mulai', { ascending: false })

  if (!sesiId) {
    // Hanya kembalikan daftar sesi untuk dropdown
    const mapelMap = Object.fromEntries((guruMapel ?? []).map(m => [m.id, m.nama]))
    const enrichedSesi = (sesiList ?? []).map(s => ({
      ...s,
      nama_mapel: mapelMap[s.mapel_id] ?? s.mapel_id,
    }))
    return NextResponse.json({ data: [], sesiList: enrichedSesi, mapelList: guruMapel ?? [] })
  }

  // Validasi: sesi ini harus milik mapel guru
  const sesi = (sesiList ?? []).find(s => s.id === sesiId)
  if (!sesi) return NextResponse.json({ error: 'Sesi tidak ditemukan atau bukan mapel Anda' }, { status: 403 })

  // Ambil semua jawaban di sesi ini
  const { data: jawabanAll, error: jawabanErr } = await db
    .from('jawaban')
    .select('soal_id, nis, jawaban')
    .eq('sesi_id', sesiId)

  if (jawabanErr) return NextResponse.json({ error: jawabanErr.message }, { status: 500 })

  // Ambil soal-soal yang ada di jawaban ini
  const soalIds = [...new Set((jawabanAll ?? []).map(j => j.soal_id))]
  if (!soalIds.length) {
    return NextResponse.json({ data: [], sesiList: sesiList ?? [], mapelList: guruMapel ?? [], sesi })
  }

  const { data: soalList } = await db
    .from('soal')
    .select('id, teks, kunci, opsi_a, opsi_b, opsi_c, opsi_d, opsi_e, tingkat, jumlah_opsi')
    .in('id', soalIds)

  // Ambil data siswa yang ikut sesi ini
  const nisSet = [...new Set((jawabanAll ?? []).map(j => j.nis))]
  const { data: siswaList } = await db
    .from('siswa')
    .select('nis, nama')
    .in('nis', nisSet)

  const siswaMap = Object.fromEntries((siswaList ?? []).map(s => [s.nis, s.nama]))
  const soalMap = Object.fromEntries((soalList ?? []).map(s => [s.id, s]))

  // Hitung distribusi per soal
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

    // Distribusi jumlah per opsi
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

    // Siswa yang tidak menjawab
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

  // Urutkan: % salah terbanyak di atas
  analisis.sort((a, b) => (b!.persenSalah - a!.persenSalah))

  // Ringkasan
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

  const mapelMap = Object.fromEntries((guruMapel ?? []).map(m => [m.id, m.nama]))
  const sesiEnriched = { ...sesi, nama_mapel: mapelMap[sesi.mapel_id] ?? sesi.mapel_id }
  const sesiListEnriched = (sesiList ?? []).map(s => ({ ...s, nama_mapel: mapelMap[s.mapel_id] ?? s.mapel_id }))

  return NextResponse.json({
    data: analisis,
    sesiList: sesiListEnriched,
    mapelList: guruMapel ?? [],
    sesi: sesiEnriched,
    ringkasan,
  })
}
