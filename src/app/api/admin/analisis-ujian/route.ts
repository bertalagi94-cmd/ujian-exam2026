import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'

export async function GET(req: NextRequest) {
  const auth = requireRole(req, ['ADMIN', 'KEPSEK'])
  if ('error' in auth) return auth.error

  const db = createAdminClient()
  const { searchParams } = new URL(req.url)
  const filterMapel = searchParams.get('mapel_id') ?? ''
  const filterKelas = searchParams.get('kelas') ?? ''
  const onlyMapel   = searchParams.get('only_mapel') === '1'
  const onlyKelas   = searchParams.get('only_kelas') === '1'
  const latest      = searchParams.get('latest') === '1'

  // Jika hanya butuh daftar kelas yang punya sesi SELESAI
  if (onlyKelas) {
    const { data: sesiSelesai } = await db
      .from('sesi_ujian')
      .select('kelas')
      .eq('status', 'SELESAI')

    const kelasSet = [...new Set((sesiSelesai ?? []).map(s => s.kelas).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b, 'id', { numeric: true }))
    return NextResponse.json({
      kelasList: kelasSet,
      adaSesi: kelasSet.length > 0,
    })
  }

  // Ambil semua mapel
  let mapelQuery = db.from('mapel').select('id, nama, guru_id')
  if (filterMapel) mapelQuery = mapelQuery.eq('id', filterMapel)
  const { data: mapelList } = await mapelQuery.order('nama')

  // Jika hanya butuh daftar mapel (load awal) — bisa difilter per kelas
  if (onlyMapel) {
    // Hanya tampilkan mapel yang punya minimal satu sesi SELESAI (untuk kelas yg dipilih)
    let sesiQuery = db.from('sesi_ujian').select('mapel_id').eq('status', 'SELESAI')
    if (filterKelas) sesiQuery = sesiQuery.eq('kelas', filterKelas)
    const { data: sesiSelesai } = await sesiQuery

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

  // FIX: ambil SEMUA sesi SELESAI untuk mapel ini agar semua sesi bisa dipilih di dropdown.
  // Sebelumnya .limit(1) menyebabkan hanya sesi terbaru yang tampil — sesi lama tidak bisa dianalisis.
  // filterKelas sudah memfilter per kelas, jadi hasil tetap relevan.
  const filterSesiId = searchParams.get('sesi_id') ?? ''

  let sesiQuery2 = db
    .from('sesi_ujian')
    .select('id, mapel_id, kelas, waktu_mulai, waktu_selesai, jumlah_peserta')
    .eq('status', 'SELESAI')
    .eq('mapel_id', filterMapel)
  if (filterKelas) sesiQuery2 = sesiQuery2.eq('kelas', filterKelas)
  const { data: sesiList } = await sesiQuery2
    .order('waktu_mulai', { ascending: false })
  // .limit(1)  ← DIHAPUS: limit ini menyebabkan sesi lama tidak pernah tampil

  // Jika ada sesi_id spesifik (dipilih dari dropdown), gunakan itu; jika tidak, ambil terbaru
  const sesiAll = filterSesiId
    ? (sesiList ?? []).find(s => s.id === filterSesiId) ?? sesiList?.[0] ?? null
    : sesiList?.[0] ?? null

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

  // FIX: siswa_ujian hanya mencatat siswa yang SEMPAT masuk/membuka sesi ujian.
  // Siswa yang sama sekali belum pernah membuka sesi (mis. belum login / belum klik mulai)
  // TIDAK akan ada di siswa_ujian sama sekali — sehingga sebelumnya mereka tidak pernah
  // terhitung sebagai "belum ujian". Akibatnya jumlah "belum ujian" jadi jauh lebih kecil
  // dari kenyataan (mis. tertulis 1/2 padahal seharusnya 7-8 dari 9 siswa di kelas).
  //
  // Sumber kebenaran untuk "total peserta seharusnya" adalah seluruh siswa AKTIF di kelas
  // tersebut (tabel `siswa`, filter kelas = kelas sesi ini), bukan hanya yang sempat
  // tercatat di siswa_ujian.
  const { data: siswaKelasList } = await db
    .from('siswa')
    .select('nis, nama')
    .eq('kelas', sesiAll.kelas)
    .eq('status', 'AKTIF')
    .neq('is_tester', 'YES')  // FIX: exclude siswa tester dari statistik analisis

  const { data: siswaUjianList } = await db
    .from('siswa_ujian')
    .select('nis, status')
    .eq('sesi_id', sesiAll.id)

  // semuaNis = SELURUH siswa aktif di kelas ini (total peserta yang seharusnya ujian),
  // bukan hanya yang tercatat masuk sesi.
  const semuaNis = (siswaKelasList ?? []).length
    ? [...new Set((siswaKelasList ?? []).map(s => s.nis))]
    : [...new Set([...(siswaUjianList ?? []).map(p => p.nis), ...nisSet])]

  // nisPernahMasuk = siswa yang sempat tercatat masuk sesi (siswa_ujian),
  // baik sudah selesai maupun sesinya ditutup paksa sebelum sempat mengirim jawaban.
  const nisPernahMasuk = new Set((siswaUjianList ?? []).map(p => p.nis))
  const nisSudahJawab  = new Set(nisSet)

  // Belum ujian sama sekali = tidak pernah masuk sesi DAN tidak punya jawaban apa pun.
  const nisBelumUjian = semuaNis.filter(n => !nisPernahMasuk.has(n) && !nisSudahJawab.has(n))

  // Sudah masuk/mengerjakan tapi belum sempat mengirim jawaban (mis. sesi ditutup paksa
  // oleh pengawas sebelum siswa selesai) — kategori berbeda dari "belum ujian sama sekali".
  const nisBelumKirim = (siswaUjianList ?? [])
    .filter(p => p.status !== 'SELESAI' && !nisSudahJawab.has(p.nis))
    .map(p => p.nis)
    .filter(n => !nisBelumUjian.includes(n))

  // Ambil nama semua siswa yang relevan
  const allNis = [...new Set([...nisSet, ...nisBelumUjian, ...nisBelumKirim, ...semuaNis])]
  const { data: siswaList } = await db
    .from('siswa')
    .select('nis, nama')
    .in('nis', allNis)
    .neq('is_tester', 'YES')  // FIX: exclude siswa tester dari statistik analisis

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
    // Belum ujian sama sekali (tidak pernah masuk sesi & tidak ada jawaban)
    siswaBelumUjian: nisBelumUjian.map(n => ({ nis: n, nama: siswaMap[n] ?? n })),
    // Sudah masuk/mengerjakan tapi belum sempat mengirim jawaban (mis. sesi ditutup
    // paksa oleh pengawas sebelum siswa selesai)
    siswaBelumKirim: nisBelumKirim.map(n => ({ nis: n, nama: siswaMap[n] ?? n })),
  }

  const mapelMap     = Object.fromEntries((mapelList ?? []).map(m => [m.id, m.nama]))
  const sesiEnriched = { ...sesiAll, nama_mapel: mapelMap[sesiAll.mapel_id] ?? sesiAll.mapel_id }

  return NextResponse.json({
    data:      analisis,
    mapelList: mapelList ?? [],
    sesi:      sesiEnriched,
    // FIX: kirim semua sesi SELESAI agar halaman admin bisa render dropdown pilihan sesi
    sesiList:  (sesiList ?? []).map(s => ({ ...s, nama_mapel: mapelMap[s.mapel_id] ?? s.mapel_id })),
    ringkasan,
  })
}
