import { NextRequest, NextResponse } from 'next/server'
import { tenantDb, yayasanIdDari } from '@/lib/tenant'
import { requireRoleAktif } from '@/lib/status-akun'
import { getBkScope, PESAN_BK_BELUM_ADA_KELAS } from '@/lib/bk-scope'
import { ambilSemuaBaris } from '@/lib/ambil-semua'
import { petakanEssayAktifPerSesi } from '@/app/api/guru/kirim-nilai/route'

export const dynamic = 'force-dynamic'

// Siswa ditandai "perlu perhatian" bila nilainya di bawah KKM, atau tertinggal
// sedikitnya ini poin dari rata-rata kelasnya pada mapel yang sama.
const SELISIH_PERHATIAN = 15

// GET /api/bk/nilai — HANYA BACA.
//   ?mode=opsi                     -> daftar kelas binaan + mapel yang sudah punya nilai
//   ?kelas=..&mapel_id=..          -> tabel nilai satu kelas untuk satu mapel
// Guru BK tidak dapat mengubah nilai; tidak ada method selain GET di file ini.
export async function GET(req: NextRequest) {
  const auth = await requireRoleAktif(req, ['BK'])
  if ('error' in auth) return auth.error

  const yayasanId = yayasanIdDari(auth.user)
  const db = tenantDb(yayasanId)
  const { searchParams } = new URL(req.url)
  const kelas = searchParams.get('kelas')
  const mapelId = searchParams.get('mapel_id')

  const scope = await getBkScope(auth.user.username, yayasanId)
  if (scope.noScope) {
    return NextResponse.json({ scopeWarning: PESAN_BK_BELUM_ADA_KELAS, kelasList: [], mapelPerKelas: {} })
  }
  if (kelas && !scope.kelasList.includes(kelas)) {
    return NextResponse.json({ error: 'Kelas ini bukan kelas binaan Anda' }, { status: 403 })
  }

  // Mode "opsi": kombinasi kelas+mapel yang sudah punya nilai, supaya dropdown hanya berisi pilihan valid.
  if (searchParams.get('mode') === 'opsi') {
    const { data: nilaiRows, error } = await ambilSemuaBaris<{ id: string; kelas: string; mapel_id: string }>((dari, sampai) =>
      db.from('nilai')
        .select('id, kelas, mapel_id')
        .in('kelas', scope.kelasList)
        .order('id', { ascending: true })
        .range(dari, sampai)
    )
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    const kelasSet = new Set<string>()
    const comboSet = new Set<string>()
    for (const n of nilaiRows) {
      if (n.kelas) kelasSet.add(n.kelas)
      if (n.kelas && n.mapel_id) comboSet.add(`${n.kelas}__${n.mapel_id}`)
    }

    const mapelIds = [...new Set([...comboSet].map(c => c.split('__')[1]))]
    const { data: mapelListRaw } = mapelIds.length
      ? await db.from('mapel').select('id, nama').in('id', mapelIds)
      : { data: [] as { id: string; nama: string }[] }
    const mapelMap = Object.fromEntries((mapelListRaw ?? []).map((m: { id: string; nama: string }) => [m.id, m.nama]))

    const mapelPerKelas: Record<string, { id: string; nama: string }[]> = {}
    for (const combo of comboSet) {
      const [k, m] = combo.split('__')
      if (!mapelPerKelas[k]) mapelPerKelas[k] = []
      mapelPerKelas[k].push({ id: m, nama: mapelMap[m] ?? m })
    }
    for (const k of Object.keys(mapelPerKelas)) {
      mapelPerKelas[k].sort((a, b) => a.nama.localeCompare(b.nama))
    }

    return NextResponse.json({
      kelasList: [...kelasSet].sort((a, b) => a.localeCompare(b, 'id', { numeric: true })),
      mapelPerKelas,
    })
  }

  if (!kelas || !mapelId) {
    return NextResponse.json({ error: 'Parameter kelas dan mapel_id wajib diisi' }, { status: 400 })
  }

  const { data, error } = await db
    .from('nilai')
    .select('*')
    .eq('kelas', kelas)
    .eq('mapel_id', mapelId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const rows = (data ?? []) as {
    id: string; nis: string; sesi_id: string | null; nilai: number; grade: string; benar: number
    total: number; lulus: boolean; kkm: number; timestamp: string
    nilai_essay?: number | null; nilai_total?: number | null; dirilis?: boolean
  }[]

  const nisSet = [...new Set(rows.map(r => r.nis))]
  const [{ data: siswaList }, { data: mapelRow }, essayAktifMap] = await Promise.all([
    db.from('siswa').select('nis, nama').in('nis', nisSet.length ? nisSet : ['__']).neq('is_tester', 'YES'),
    db.from('mapel').select('id, nama').eq('id', mapelId).maybeSingle(),
    petakanEssayAktifPerSesi(db, rows.map(r => r.sesi_id)),
  ])
  const siswaMap = Object.fromEntries((siswaList ?? []).map((s: { nis: string; nama: string }) => [s.nis, s.nama]))

  // Nilai efektif sama seperti rekap Kepsek/Admin: nilai gabungan PG+Essay bila essay aktif dan sudah dirilis.
  const nilaiEfektif = (r: (typeof rows)[number]) => {
    const essayAktif = r.sesi_id ? (essayAktifMap.get(r.sesi_id) ?? false) : false
    return (essayAktif && r.dirilis && r.nilai_total != null) ? Number(r.nilai_total) : Number(r.nilai)
  }

  const dasar = rows
    .filter(r => siswaMap[r.nis]) // buang tester
    .map(r => {
      const essayAktif = r.sesi_id ? (essayAktifMap.get(r.sesi_id) ?? false) : false
      return {
        ...r,
        nama_siswa: siswaMap[r.nis] ?? r.nis,
        essay_aktif: essayAktif,
        essay_belum_dirilis: essayAktif && r.dirilis !== true,
        nilai_efektif: nilaiEfektif(r),
      }
    })

  const nums = dasar.map(r => r.nilai_efektif)
  const rataRata = nums.length ? Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 100) / 100 : 0

  const enriched = dasar
    .map(r => {
      const selisih = Math.round((r.nilai_efektif - rataRata) * 100) / 100
      const dibawahKkm = r.nilai_efektif < Number(r.kkm ?? 0)
      return {
        ...r,
        selisih_rata: selisih,
        perlu_perhatian: dibawahKkm || selisih <= -SELISIH_PERHATIAN,
      }
    })
    .sort((a, b) => b.nilai_efektif - a.nilai_efektif)
    .map((r, i) => ({ ...r, rank: i + 1 }))

  const summary = {
    jumlahSiswa: enriched.length,
    rataRata,
    nilaiTertinggi: nums.length ? Math.max(...nums) : 0,
    nilaiTerendah: nums.length ? Math.min(...nums) : 0,
    jumlahLulus: enriched.filter(r => r.lulus).length,
    jumlahTidakLulus: enriched.filter(r => !r.lulus).length,
    jumlahPerluPerhatian: enriched.filter(r => r.perlu_perhatian).length,
  }

  return NextResponse.json({
    data: enriched,
    summary,
    selisihPerhatian: SELISIH_PERHATIAN,
    nama_mapel: (mapelRow as { id: string; nama: string } | null)?.nama ?? mapelId,
  })
}
