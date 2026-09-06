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

  // Ambil mapel yang diajar guru ini
  const { data: guruMapel } = await db
    .from('mapel')
    .select('id, nama')
    .eq('guru_id', user.username)

  const mapelIds = (guruMapel ?? []).map(m => m.id)
  if (!mapelIds.length) return NextResponse.json({ data: [], stats: null, mapelList: [] })

  let query = db
    .from('nilai')
    .select('*')
    .in('mapel_id', mapelIds)
    .order('timestamp', { ascending: false })

  if (filterMapel) query = query.eq('mapel_id', filterMapel)
  if (filterKelas) query = query.eq('kelas', filterKelas)

  const { data: nilaiDataRaw, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  const nilaiData = nilaiDataRaw ?? []

  const mapelMap = Object.fromEntries((guruMapel ?? []).map(m => [m.id, m.nama]))

  // Enrich dengan nama siswa
  const nisSet = [...new Set(nilaiData.map(r => r.nis))]
  const { data: siswaList } = nisSet.length
    ? await db.from('siswa').select('nis, nama').in('nis', nisSet)
    : { data: [] as { nis: string; nama: string }[] }
  const siswaMap = Object.fromEntries((siswaList ?? []).map(s => [s.nis, s.nama]))

  const enriched = nilaiData.map(r => ({
    ...r,
    nama_siswa: siswaMap[r.nis] ?? r.nis,
    nama_mapel: mapelMap[r.mapel_id] ?? r.mapel_id,
  }))

  // Stats — HANYA dari siswa yang benar-benar sudah ujian (nilaiData asli),
  // bukan dari placeholder "belum ujian" yang ditambahkan di bawah.
  // Tetap `null` kalau belum ada nilai sama sekali (sama seperti perilaku
  // lama) supaya kartu statistik di UI tidak muncul dengan angka 0 palsu.
  const vals = enriched.map(r => r.nilai)
  const stats = enriched.length === 0 ? null : {
    total: enriched.length,
    rataRata: Math.round(vals.reduce((a, b) => a + b, 0) / vals.length),
    tertinggi: Math.max(...vals),
    terendah: Math.min(...vals),
    lulus: enriched.filter(r => r.lulus).length,
    tidakLulus: enriched.filter(r => !r.lulus).length,
  }

  // ── Roster siswa yang BELUM ujian ───────────────────────────────────────
  // BUG SEBELUMNYA: endpoint ini hanya query tabel `nilai`, jadi siswa yang
  // sama sekali belum mengerjakan ujian mapel ini (tidak punya baris nilai)
  // tidak pernah muncul di rekap, seolah-olah tidak terdaftar.
  //
  // FIX: pakai tabel `jadwal` (mapel_id + kelas) sebagai sumber "kelas mana
  // saja yang seharusnya ujian mapel ini" — sama seperti pola yang sudah
  // dipakai di /api/guru/wali-kelas (kelas_mapel tidak selalu terisi kalau
  // jadwal dibuat lewat menu Jadwal Ujian biasa). Lalu selisihkan dengan
  // siswa yang sudah py nilai untuk mendapat daftar yang belum ujian.
  const { data: jadwalList } = await db
    .from('jadwal')
    .select('mapel_id, kelas')
    .in('mapel_id', mapelIds)

  const pasanganMap = new Map<string, { mapel_id: string; kelas: string }>()
  for (const j of jadwalList ?? []) {
    if (!j.mapel_id || !j.kelas) continue
    pasanganMap.set(`${j.mapel_id}__${j.kelas}`, { mapel_id: j.mapel_id, kelas: j.kelas })
  }
  let pasangan = Array.from(pasanganMap.values())
  // Ikutkan filter mapel/kelas yang sedang aktif di halaman, supaya konsisten
  // dengan hasil query nilai di atas.
  if (filterMapel) pasangan = pasangan.filter(p => p.mapel_id === filterMapel)
  if (filterKelas) pasangan = pasangan.filter(p => p.kelas === filterKelas)

  const kelasSet = [...new Set(pasangan.map(p => p.kelas))]
  const { data: siswaRoster } = kelasSet.length
    ? await db.from('siswa').select('nis, nama, kelas').in('kelas', kelasSet).eq('status', 'AKTIF').neq('is_tester', 'YES')
    : { data: [] as { nis: string; nama: string; kelas: string }[] }

  // Set nis+mapel yang sudah py nilai — dari HASIL QUERY nilai (nilaiData),
  // bukan dari seluruh tabel, supaya tetap konsisten dengan filter yang aktif.
  const sudahAdaSet = new Set(nilaiData.map(n => `${n.mapel_id}__${n.nis}`))

  const belumUjianRows: Record<string, unknown>[] = []
  for (const p of pasangan) {
    const siswaKelasIni = (siswaRoster ?? []).filter(s => s.kelas === p.kelas)
    for (const s of siswaKelasIni) {
      const kunci = `${p.mapel_id}__${s.nis}`
      if (sudahAdaSet.has(kunci)) continue
      sudahAdaSet.add(kunci) // hindari duplikat kalau ada >1 jadwal mapel+kelas yang sama
      belumUjianRows.push({
        id: `BELUM__${p.mapel_id}__${s.nis}`,
        sesi_id: '',
        nis: s.nis,
        mapel_id: p.mapel_id,
        kelas: p.kelas,
        benar: 0,
        total: 0,
        nilai: 0,
        grade: '-',
        timestamp: '',
        lulus: false,
        kkm: 0,
        nama_siswa: s.nama,
        nama_mapel: mapelMap[p.mapel_id] ?? p.mapel_id,
        belum_ujian: true,
      })
    }
  }

  return NextResponse.json({ data: [...enriched, ...belumUjianRows], stats, mapelList: guruMapel })
}
