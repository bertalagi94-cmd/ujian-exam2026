import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'
import { getKepsekScope } from '@/lib/kepsek-scope'

export async function GET(req: NextRequest) {
  const auth = requireRole(req, ['KEPSEK', 'ADMIN'])
  if ('error' in auth) return auth.error

  const db = createAdminClient()

  // Batasi data ke kelas-kelas di sekolah/jenjang yang diawasi Kepsek.
  // ADMIN tidak dibatasi (kelasScope = null artinya "semua kelas").
  let kelasScope: string[] | null = null
  if (auth.user.role === 'KEPSEK') {
    const scope = await getKepsekScope(auth.user.username)
    if (scope.noScope) {
      return NextResponse.json({
        scopeWarning: 'Akun Kepsek Anda belum diset sekolah/jenjangnya oleh Admin. Hubungi Admin untuk mengatur ini di menu Data Pengguna.',
        stats: { totalSiswa: 0, totalGuru: 0, totalUjian: 0, rataRata: 0 },
        nilaiPerKelas: [], nilaiPerMapel: [], ujianHariIni: [], sedangBerlangsung: [], siswaTidakHadir: [],
      })
    }
    kelasScope = scope.kelasList
    if (kelasScope.length === 0) {
      return NextResponse.json({
        stats: { totalSiswa: 0, totalGuru: 0, totalUjian: 0, rataRata: 0 },
        nilaiPerKelas: [], nilaiPerMapel: [], ujianHariIni: [], sedangBerlangsung: [], siswaTidakHadir: [],
      })
    }
  }

  // Rentang "hari ini" berdasarkan tanggal lokal (kolom `tanggal` adalah DATE)
  const now = new Date()
  const todayStr = now.toISOString().slice(0, 10)

  // ── Hitung Total Guru sesuai scope sekolah/jenjang Kepsek ──────────────────
  // BUG SEBELUMNYA: totalGuru dihitung dari SEMUA users role=GURU tanpa
  // filter apa pun, jadi Kepsek MTs dan Kepsek MA sama-sama melihat angka
  // total guru se-aplikasi, bukan angka guru yang benar-benar mengajar di
  // jenjangnya.
  //
  // Guru TIDAK punya kolom sekolah_id sendiri (beda dari Kepsek), karena
  // satu guru bisa mengajar di lebih dari satu jenjang sekaligus (kasus
  // nyata di sekolah ini). Sumber kebenaran yang sudah konsisten dipakai
  // di seluruh aplikasi (lihat src/lib/rangkuman.ts, src/lib/soal-status.ts,
  // halaman Wali Kelas) adalah kolom `mapel.kelas_list` — daftar nama kelas
  // yang diampu oleh `mapel.guru_id`.
  //
  // Jadi: guru dihitung masuk ke sekolah/jenjang Kepsek HANYA JIKA salah
  // satu kelas di kelas_list-nya ada di kelasScope Kepsek tersebut. Guru
  // yang mengajar di kedua jenjang akan ikut terhitung di KEDUA dashboard
  // Kepsek — ini disengaja, bukan duplikasi data, karena dia memang relevan
  // untuk diawasi oleh kedua Kepsek tersebut.
  let totalGuru = 0
  if (kelasScope) {
    const { data: mapelGuruRows } = await db
      .from('mapel')
      .select('guru_id, kelas_list')
      .not('guru_id', 'is', null)

    const guruIdSet = new Set<string>()
    for (const m of (mapelGuruRows ?? []) as { guru_id: string; kelas_list: string | null }[]) {
      const kelasDiampu = (m.kelas_list ?? '').split(',').map(s => s.trim()).filter(Boolean)
      if (kelasDiampu.some(k => kelasScope!.includes(k))) guruIdSet.add(m.guru_id)
    }

    if (guruIdSet.size > 0) {
      const { count } = await db
        .from('users')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'AKTIF')
        .eq('role', 'GURU')
        .in('username', [...guruIdSet])
      totalGuru = count ?? 0
    }
  } else {
    // ADMIN: tidak dibatasi, hitung semua guru aktif seperti semula
    const { count } = await db
      .from('users')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'AKTIF')
      .eq('role', 'GURU')
    totalGuru = count ?? 0
  }
  // ─────────────────────────────────────────────────────────────────────────

  const [
    { count: totalSiswa },
    { count: totalUjian },
    { data: nilaiAll },
    { data: jadwalHariIni },
    { data: sesiBerjalan },
  ] = await Promise.all([
    kelasScope
      ? db.from('siswa').select('*', { count: 'exact', head: true }).eq('status', 'AKTIF').in('kelas', kelasScope)
      : db.from('siswa').select('*', { count: 'exact', head: true }).eq('status', 'AKTIF'),
    kelasScope
      ? db.from('nilai').select('*', { count: 'exact', head: true }).in('kelas', kelasScope)
      : db.from('nilai').select('*', { count: 'exact', head: true }),
    kelasScope
      ? db.from('nilai').select('nilai, kelas, mapel_id, lulus').in('kelas', kelasScope)
      : db.from('nilai').select('nilai, kelas, mapel_id, lulus'),
    kelasScope
      ? db.from('jadwal').select('*').eq('tanggal', todayStr).in('kelas', kelasScope).order('sesi', { ascending: true })
      : db.from('jadwal').select('*').eq('tanggal', todayStr).order('sesi', { ascending: true }),
    kelasScope
      ? db.from('sesi_ujian').select('*').eq('status', 'BERJALAN').in('kelas', kelasScope).order('waktu_mulai', { ascending: false })
      : db.from('sesi_ujian').select('*').eq('status', 'BERJALAN').order('waktu_mulai', { ascending: false }),
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
  let sesiBaruSelesaiQuery = db
    .from('sesi_ujian')
    .select('id, mapel_id, kelas, waktu_selesai')
    .eq('status', 'SELESAI')
    .gte('waktu_selesai', since)
  if (kelasScope) sesiBaruSelesaiQuery = sesiBaruSelesaiQuery.in('kelas', kelasScope)
  const { data: sesiBaruSelesai } = await sesiBaruSelesaiQuery

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
