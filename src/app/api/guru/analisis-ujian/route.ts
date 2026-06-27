import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'

export async function GET(req: NextRequest) {
  const auth = requireRole(req, ['GURU'])
  if ('error' in auth) return auth.error
  const { user } = auth

  const db = createAdminClient()
  const { searchParams } = new URL(req.url)
  const filterMapel = searchParams.get('mapel_id') ?? ''
  const filterKelas = searchParams.get('kelas') ?? ''
  const onlyMapel = searchParams.get('only_mapel') === '1'
  const onlyKelas = searchParams.get('only_kelas') === '1'

  // Ambil mapel yang diajar guru ini — semua endpoint di bawah dibatasi ke mapelIdsGuru
  // ini, jadi guru tidak akan pernah melihat data analisis mapel guru lain.
  const { data: guruMapelAll } = await db
    .from('mapel')
    .select('id, nama, guru_id')
    .eq('guru_id', user.username)

  const mapelIdsGuru = (guruMapelAll ?? []).map(m => m.id)

  // PENTING: rute ini HARUS mengikuti kontrak yang sama dengan
  // /api/admin/analisis-ujian (dipakai oleh komponen AnalisisUjianView yang sama):
  //   - ?only_kelas=1            -> { kelasList, adaSesi }
  //   - ?only_mapel=1[&kelas=]   -> { mapelList, adaSesi }
  //   - ?mapel_id=...[&kelas=&sesi_id=] -> { data, sesi, sesiList, mapelList, ringkasan }
  // Versi lama rute ini HANYA mengenal parameter `sesi_id` dan tidak pernah
  // mengembalikan field `adaSesi`/`kelasList`. Akibatnya AnalisisUjianView selalu
  // menerima `adaSesi: undefined` -> di-default-kan ke `false` -> halaman guru
  // selalu menampilkan "Belum ada ujian yang selesai" walau sesinya sudah SELESAI.

  if (!mapelIdsGuru.length) {
    if (onlyKelas) return NextResponse.json({ kelasList: [], adaSesi: false })
    if (onlyMapel) return NextResponse.json({ mapelList: [], adaSesi: false })
    return NextResponse.json({ data: [], mapelList: [] })
  }

  // Jika hanya butuh daftar kelas yang punya sesi SELESAI (untuk mapel guru ini)
  if (onlyKelas) {
    const { data: sesiSelesai } = await db
      .from('sesi_ujian')
      .select('kelas')
      .in('mapel_id', mapelIdsGuru)
      .eq('status', 'SELESAI')

    const kelasSet = [...new Set((sesiSelesai ?? []).map(s => s.kelas).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b, 'id', { numeric: true }))
    return NextResponse.json({
      kelasList: kelasSet,
      adaSesi: kelasSet.length > 0,
    })
  }

  // Jika hanya butuh daftar mapel (load awal) — bisa difilter per kelas.
  // Hanya tampilkan mapel (milik guru ini) yang punya minimal satu sesi SELESAI.
  if (onlyMapel) {
    let sesiQuery = db.from('sesi_ujian').select('mapel_id').in('mapel_id', mapelIdsGuru).eq('status', 'SELESAI')
    if (filterKelas) sesiQuery = sesiQuery.eq('kelas', filterKelas)
    const { data: sesiSelesai } = await sesiQuery

    const mapelIdAda = new Set((sesiSelesai ?? []).map(s => s.mapel_id))
    const filtered = (guruMapelAll ?? []).filter(m => mapelIdAda.has(m.id))
    return NextResponse.json({
      mapelList: filtered,
      adaSesi: mapelIdAda.size > 0,
    })
  }

  // Harus ada mapel yang dipilih
  if (!filterMapel) {
    return NextResponse.json({ data: [], mapelList: guruMapelAll ?? [] })
  }

  // Validasi: mapel yang diminta harus benar-benar diampu guru ini
  if (!mapelIdsGuru.includes(filterMapel)) {
    return NextResponse.json({ error: 'Mata pelajaran ini bukan milik Anda' }, { status: 403 })
  }

  const filterSesiId = searchParams.get('sesi_id') ?? ''

  // Ambil SEMUA sesi SELESAI untuk mapel ini agar semua sesi bisa dipilih (lihat juga
  // catatan yang sama di /api/admin/analisis-ujian — jangan pakai .limit(1) di sini).
  let sesiQuery2 = db
    .from('sesi_ujian')
    .select('id, mapel_id, kelas, waktu_mulai, waktu_selesai, jumlah_peserta')
    .eq('status', 'SELESAI')
    .eq('mapel_id', filterMapel)
  if (filterKelas) sesiQuery2 = sesiQuery2.eq('kelas', filterKelas)
  const { data: sesiList } = await sesiQuery2.order('waktu_mulai', { ascending: false })

  // Jika ada sesi_id spesifik (dipilih dari dropdown), gunakan itu; jika tidak, ambil terbaru
  const sesiAll = filterSesiId
    ? (sesiList ?? []).find(s => s.id === filterSesiId) ?? sesiList?.[0] ?? null
    : sesiList?.[0] ?? null

  if (!sesiAll) {
    return NextResponse.json({
      data: [],
      mapelList: guruMapelAll ?? [],
      sesi: null,
    })
  }

  // Ambil semua jawaban di sesi ini
  const { data: jawabanAll, error: jawabanErr } = await db
    .from('jawaban')
    .select('soal_id, nis, jawaban')
    .eq('sesi_id', sesiAll.id)

  if (jawabanErr) return NextResponse.json({ error: jawabanErr.message }, { status: 500 })

  const soalIds = [...new Set((jawabanAll ?? []).map(j => j.soal_id))]
  if (!soalIds.length) {
    const mapelMap = Object.fromEntries((guruMapelAll ?? []).map(m => [m.id, m.nama]))
    const sesiEnriched = { ...sesiAll, nama_mapel: mapelMap[sesiAll.mapel_id] ?? sesiAll.mapel_id }
    return NextResponse.json({
      data: [],
      mapelList: guruMapelAll ?? [],
      sesi: sesiEnriched,
      sesiList: (sesiList ?? []).map(s => ({ ...s, nama_mapel: mapelMap[s.mapel_id] ?? s.mapel_id })),
    })
  }

  const { data: soalList } = await db
    .from('soal')
    .select('id, teks, kunci, opsi_a, opsi_b, opsi_c, opsi_d, opsi_e, tingkat, jumlah_opsi')
    .in('id', soalIds)

  // nisSet = siswa yang SUDAH mengerjakan (punya jawaban di sesi ini)
  const nisSet = [...new Set((jawabanAll ?? []).map(j => j.nis))]

  // Sumber kebenaran untuk "total peserta seharusnya" adalah seluruh siswa AKTIF
  // di kelas tersebut (tabel `siswa`), bukan hanya yang sempat tercatat di siswa_ujian.
  // (Lihat catatan yang sama di /api/admin/analisis-ujian.)
  const { data: siswaKelasList } = await db
    .from('siswa')
    .select('nis, nama')
    .eq('kelas', sesiAll.kelas)
    .eq('status', 'AKTIF')
    .neq('is_tester', 'YES')

  const { data: siswaUjianList } = await db
    .from('siswa_ujian')
    .select('nis, status')
    .eq('sesi_id', sesiAll.id)

  const semuaNis = (siswaKelasList ?? []).length
    ? [...new Set((siswaKelasList ?? []).map(s => s.nis))]
    : [...new Set([...(siswaUjianList ?? []).map(p => p.nis), ...nisSet])]

  const nisPernahMasuk = new Set((siswaUjianList ?? []).map(p => p.nis))
  const nisSudahJawab = new Set(nisSet)

  // Belum ujian sama sekali = tidak pernah masuk sesi DAN tidak punya jawaban apa pun.
  const nisBelumUjian = semuaNis.filter(n => !nisPernahMasuk.has(n) && !nisSudahJawab.has(n))

  // Sudah masuk/mengerjakan tapi belum sempat mengirim jawaban (mis. sesi ditutup
  // paksa oleh pengawas sebelum siswa selesai).
  const nisBelumKirim = (siswaUjianList ?? [])
    .filter(p => p.status !== 'SELESAI' && !nisSudahJawab.has(p.nis))
    .map(p => p.nis)
    .filter(n => !nisBelumUjian.includes(n))

  const allNis = [...new Set([...nisSet, ...nisBelumUjian, ...nisBelumKirim, ...semuaNis])]
  const { data: siswaList } = await db
    .from('siswa')
    .select('nis, nama')
    .in('nis', allNis)
    .neq('is_tester', 'YES')

  const siswaMap = Object.fromEntries((siswaList ?? []).map(s => [s.nis, s.nama]))
  const soalMap = Object.fromEntries((soalList ?? []).map(s => [s.id, s]))

  // Hitung distribusi per soal
  const jawabanBySoal: Record<string, { opsi: string; nis: string }[]> = {}
  for (const j of jawabanAll ?? []) {
    if (!jawabanBySoal[j.soal_id]) jawabanBySoal[j.soal_id] = []
    if (j.jawaban) jawabanBySoal[j.soal_id].push({ opsi: j.jawaban, nis: j.nis })
  }

  const totalSiswa = nisSet.length // hanya yang sudah ujian

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

  // Urutkan: % salah terbanyak di atas
  analisis.sort((a, b) => (b!.persenSalah - a!.persenSalah))

  const dijawab = analisis.filter(a => a!.totalDijawab > 0)
  const ringkasan = {
    totalSoal: analisis.length,
    totalSiswa,
    totalPeserta: semuaNis.length,
    rataPersenBenar: dijawab.length
      ? Math.round(dijawab.reduce((s, a) => s + a!.persenBenar, 0) / dijawab.length)
      : 0,
    soalMudah: dijawab.filter(a => a!.persenBenar >= 70).length,
    soalSedang: dijawab.filter(a => a!.persenBenar >= 40 && a!.persenBenar < 70).length,
    soalSulit: dijawab.filter(a => a!.persenBenar < 40).length,
    siswaBelumUjian: nisBelumUjian.map(n => ({ nis: n, nama: siswaMap[n] ?? n })),
    siswaBelumKirim: nisBelumKirim.map(n => ({ nis: n, nama: siswaMap[n] ?? n })),
  }

  const mapelMap = Object.fromEntries((guruMapelAll ?? []).map(m => [m.id, m.nama]))
  const sesiEnriched = { ...sesiAll, nama_mapel: mapelMap[sesiAll.mapel_id] ?? sesiAll.mapel_id }

  return NextResponse.json({
    data: analisis,
    mapelList: guruMapelAll ?? [],
    sesi: sesiEnriched,
    sesiList: (sesiList ?? []).map(s => ({ ...s, nama_mapel: mapelMap[s.mapel_id] ?? s.mapel_id })),
    ringkasan,
  })
}
