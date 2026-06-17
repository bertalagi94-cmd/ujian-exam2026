import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'

export async function GET(req: NextRequest) {
  const auth = requireRole(req, ['KEPSEK', 'ADMIN'])
  if ('error' in auth) return auth.error

  const db = createAdminClient()

  // Rentang "hari ini" berdasarkan tanggal lokal (kolom `tanggal` adalah DATE)
  const now = new Date()
  const todayStr = now.toISOString().slice(0, 10)

  const [
    { count: totalSiswa },
    { count: totalGuru },
    { count: totalUjian },
    { data: nilaiAll },
    { data: jadwalHariIni },
    { data: sesiBerjalan },
  ] = await Promise.all([
    db.from('siswa').select('*', { count: 'exact', head: true }).eq('status', 'AKTIF'),
    db.from('users').select('*', { count: 'exact', head: true }).eq('status', 'AKTIF').eq('role', 'GURU'),
    db.from('nilai').select('*', { count: 'exact', head: true }),
    db.from('nilai').select('nilai, kelas, mapel_id, lulus'),
    db.from('jadwal').select('*').eq('tanggal', todayStr).order('sesi', { ascending: true }),
    db.from('sesi_ujian').select('*').eq('status', 'BERJALAN').order('waktu_mulai', { ascending: false }),
  ])

  // Enrich nama_mapel & nama_pengawas untuk jadwal hari ini
  const jadwalMapelIds = [...new Set((jadwalHariIni ?? []).map(j => j.mapel_id).filter(Boolean))]
  const pengawasIds = [...new Set((jadwalHariIni ?? []).map(j => j.pengawas).filter(Boolean))]
  const [{ data: jadwalMapelList }, { data: pengawasList }] = await Promise.all([
    db.from('mapel').select('id, nama').in('id', jadwalMapelIds.length ? jadwalMapelIds : ['__']),
    db.from('users').select('username, nama').in('username', pengawasIds.length ? pengawasIds : ['__']),
  ])
  const jadwalMapelMap = Object.fromEntries((jadwalMapelList ?? []).map(m => [m.id, m.nama]))
  const pengawasMap = Object.fromEntries((pengawasList ?? []).map(p => [p.username, p.nama]))

  const ujianHariIni = (jadwalHariIni ?? []).map(j => ({
    ...j,
    nama_mapel: jadwalMapelMap[j.mapel_id] ?? j.mapel_id,
    nama_pengawas: j.pengawas ? (pengawasMap[j.pengawas] ?? j.pengawas) : null,
  }))

  // Enrich sesi berjalan dengan nama mapel + sisa waktu (detik), dihitung di server
  const sesiMapelIds = [...new Set((sesiBerjalan ?? []).map(s => s.mapel_id).filter(Boolean))]
  const { data: sesiMapelList } = await db.from('mapel').select('id, nama').in('id', sesiMapelIds.length ? sesiMapelIds : ['__'])
  const sesiMapelMap = Object.fromEntries((sesiMapelList ?? []).map(m => [m.id, m.nama]))

  const nowMs = Date.now()
  const sedangBerlangsung = (sesiBerjalan ?? []).map(s => {
    const mulaiMs = new Date(s.waktu_mulai).getTime()
    const totalDetik = (s.durasi ?? 0) * 60
    const terpakaiDetik = Math.floor((nowMs - mulaiMs) / 1000)
    const sisaDetik = Math.max(0, totalDetik - terpakaiDetik)
    return {
      id: s.id,
      mapel_id: s.mapel_id,
      nama_mapel: sesiMapelMap[s.mapel_id] ?? s.mapel_id,
      kelas: s.kelas,
      waktu_mulai: s.waktu_mulai,
      durasi: s.durasi,
      jumlah_peserta: s.jumlah_peserta,
      sisaDetik,
      lewatWaktu: sisaDetik <= 0,
    }
  })

  // Siswa tidak hadir: sesi yang BARU SELESAI (selesai dalam 24 jam terakhir),
  // siswa terdaftar (siswa_ujian) tapi tidak punya baris nilai untuk sesi itu
  // (konsisten dengan cara sistem menandai "sudah mengerjakan" di tempat lain)
  const since = new Date(nowMs - 24 * 60 * 60 * 1000).toISOString()
  const { data: sesiBaruSelesai } = await db
    .from('sesi_ujian')
    .select('id, mapel_id, kelas, waktu_selesai')
    .eq('status', 'SELESAI')
    .gte('waktu_selesai', since)

  let siswaTidakHadir: { nis: string; nama: string; kelas: string; mapel_id: string; nama_mapel: string; sesi_id: string }[] = []

  if (sesiBaruSelesai?.length) {
    const sesiIds = sesiBaruSelesai.map(s => s.id)
    const [{ data: pesertaList }, { data: nilaiSesiList }] = await Promise.all([
      db.from('siswa_ujian').select('sesi_id, nis').in('sesi_id', sesiIds),
      db.from('nilai').select('sesi_id, nis').in('sesi_id', sesiIds),
    ])

    const sudahNilaiSet = new Set((nilaiSesiList ?? []).map(n => `${n.sesi_id}__${n.nis}`))
    const belumList = (pesertaList ?? []).filter(p => !sudahNilaiSet.has(`${p.sesi_id}__${p.nis}`))

    if (belumList.length) {
      const nisSet = [...new Set(belumList.map(b => b.nis))]
      const { data: siswaList } = await db.from('siswa').select('nis, nama').in('nis', nisSet).neq('is_tester', 'YES')
      const siswaMap = Object.fromEntries((siswaList ?? []).map(s => [s.nis, s.nama]))
      const sesiMap = Object.fromEntries(sesiBaruSelesai.map(s => [s.id, s]))

      siswaTidakHadir = belumList
        .filter(b => siswaMap[b.nis]) // exclude tester / siswa tidak ditemukan
        .map(b => {
          const sesi = sesiMap[b.sesi_id]
          return {
            nis: b.nis,
            nama: siswaMap[b.nis] ?? b.nis,
            kelas: sesi?.kelas ?? '-',
            mapel_id: sesi?.mapel_id ?? '-',
            nama_mapel: sesiMapelMap[sesi?.mapel_id] ?? jadwalMapelMap[sesi?.mapel_id] ?? sesi?.mapel_id ?? '-',
            sesi_id: b.sesi_id,
          }
        })
    }
  }

  // Lengkapi nama_mapel siswaTidakHadir yang belum ter-resolve dari dua map di atas
  const missingMapelIds = [...new Set(siswaTidakHadir.filter(s => s.nama_mapel === s.mapel_id).map(s => s.mapel_id))]
  if (missingMapelIds.length) {
    const { data: extraMapel } = await db.from('mapel').select('id, nama').in('id', missingMapelIds)
    const extraMap = Object.fromEntries((extraMapel ?? []).map(m => [m.id, m.nama]))
    siswaTidakHadir = siswaTidakHadir.map(s => ({ ...s, nama_mapel: extraMap[s.mapel_id] ?? s.nama_mapel }))
  }

  const nums = (nilaiAll ?? []).map(n => n.nilai || 0)
  const rataRata = nums.length ? Math.round(nums.reduce((a, b) => a + b, 0) / nums.length) : 0

  // Per kelas
  const kelasAgg: Record<string, { sum: number; total: number; lulus: number }> = {}
  for (const n of (nilaiAll ?? [])) {
    const k = String(n.kelas)
    if (!kelasAgg[k]) kelasAgg[k] = { sum: 0, total: 0, lulus: 0 }
    kelasAgg[k].sum += n.nilai || 0
    kelasAgg[k].total++
    if (n.lulus) kelasAgg[k].lulus++
  }
  const nilaiPerKelas = Object.entries(kelasAgg)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([kelas, agg]) => ({
      kelas,
      rata: Math.round(agg.sum / agg.total),
      total: agg.total,
      lulus: agg.lulus,
    }))

  // Per mapel
  const mapelAgg: Record<string, { sum: number; total: number }> = {}
  for (const n of (nilaiAll ?? [])) {
    if (!n.mapel_id) continue
    if (!mapelAgg[n.mapel_id]) mapelAgg[n.mapel_id] = { sum: 0, total: 0 }
    mapelAgg[n.mapel_id].sum += n.nilai || 0
    mapelAgg[n.mapel_id].total++
  }

  const mapelIds = Object.keys(mapelAgg)
  const { data: mapelList } = await db.from('mapel').select('id, nama').in('id', mapelIds.length ? mapelIds : ['__'])
  const mapelMap = Object.fromEntries((mapelList ?? []).map(m => [m.id, m.nama]))

  const nilaiPerMapel = Object.entries(mapelAgg)
    .sort((a, b) => b[1].total - a[1].total)
    .slice(0, 15)
    .map(([id, agg]) => ({
      nama: mapelMap[id] ?? id,
      rata: Math.round(agg.sum / agg.total),
      total: agg.total,
    }))

  return NextResponse.json({
    stats: { totalSiswa: totalSiswa ?? 0, totalGuru: totalGuru ?? 0, totalUjian: totalUjian ?? 0, rataRata },
    nilaiPerKelas,
    nilaiPerMapel,
    ujianHariIni,
    sedangBerlangsung,
    siswaTidakHadir,
  })
}
