import { NextRequest, NextResponse } from 'next/server'
import { tenantDb, yayasanIdDari } from '@/lib/tenant'
import { requireRoleAktif } from '@/lib/status-akun'
import { getBkScope, ambilSiswaBinaan, PESAN_BK_BELUM_ADA_KELAS } from '@/lib/bk-scope'
import { ambilSemuaBaris } from '@/lib/ambil-semua'

export const dynamic = 'force-dynamic'

const HARI_MS = 24 * 60 * 60 * 1000
// Siswa dianggap "berulang kali melanggar" bila punya sedikitnya ini pelanggaran
// dalam 30 hari terakhir.
const BATAS_BERULANG = 3

interface RingkasanKosong {
  scope: { jumlahKelas: number; jumlahSiswa: number; kelas: string[] }
  pelanggaran: { mingguIni: number; bulanIni: number; belumDitindak: number }
  berulang: unknown[]
  nilaiRendah: { jumlahSiswa: number; daftar: unknown[] }
}

const KOSONG: RingkasanKosong = {
  scope: { jumlahKelas: 0, jumlahSiswa: 0, kelas: [] },
  pelanggaran: { mingguIni: 0, bulanIni: 0, belumDitindak: 0 },
  berulang: [],
  nilaiRendah: { jumlahSiswa: 0, daftar: [] },
}

// GET /api/bk/dashboard
// Ringkasan siswa yang perlu perhatian, HANYA dari kelas binaan guru BK ini.
export async function GET(req: NextRequest) {
  const auth = await requireRoleAktif(req, ['BK'])
  if ('error' in auth) return auth.error

  const yayasanId = yayasanIdDari(auth.user)
  const db = tenantDb(yayasanId)

  const scope = await getBkScope(auth.user.username, yayasanId)
  if (scope.noScope) {
    return NextResponse.json({ ...KOSONG, scopeWarning: PESAN_BK_BELUM_ADA_KELAS })
  }

  const siswa = await ambilSiswaBinaan(yayasanId, scope.kelasList)
  const nisList = siswa.map(s => s.nis)
  const infoSiswa = new Map(siswa.map(s => [s.nis, s]))

  const base = {
    scope: { jumlahKelas: scope.kelasList.length, jumlahSiswa: siswa.length, kelas: [...scope.kelasList].sort((a, b) => a.localeCompare(b, 'id', { numeric: true })) },
  }
  if (nisList.length === 0) return NextResponse.json({ ...KOSONG, ...base })

  const sekarang = Date.now()
  const sejak7 = sekarang - 7 * HARI_MS
  const sejak30Iso = new Date(sekarang - 30 * HARI_MS).toISOString()

  const [pelanggaranBulan, belumRes, nilaiRes] = await Promise.all([
    ambilSemuaBaris<{ id: string; nis: string; status: string; created_at: string }>((dari, sampai) =>
      db.from('pelanggaran')
        .select('id, nis, status, created_at')
        .in('nis', nisList)
        .gte('created_at', sejak30Iso)
        .order('id', { ascending: true })
        .range(dari, sampai)
    ),
    db.from('pelanggaran')
      .select('id', { count: 'exact', head: true })
      .in('nis', nisList)
      .eq('status', 'BELUM_DITINDAKLANJUTI'),
    ambilSemuaBaris<{ id: string; nis: string; lulus: boolean | null }>((dari, sampai) =>
      db.from('nilai')
        .select('id, nis, lulus')
        .in('kelas', scope.kelasList)
        .order('id', { ascending: true })
        .range(dari, sampai)
    ),
  ])
  if (pelanggaranBulan.error) return NextResponse.json({ error: pelanggaranBulan.error.message }, { status: 500 })
  if (belumRes.error) return NextResponse.json({ error: belumRes.error.message }, { status: 500 })
  if (nilaiRes.error) return NextResponse.json({ error: nilaiRes.error.message }, { status: 500 })

  // ── Pelanggaran ──
  let mingguIni = 0
  const perSiswa = new Map<string, { jumlah: number; belum: number }>()
  for (const p of pelanggaranBulan.data) {
    if (new Date(p.created_at).getTime() >= sejak7) mingguIni++
    const e = perSiswa.get(p.nis) ?? { jumlah: 0, belum: 0 }
    e.jumlah++
    if (p.status === 'BELUM_DITINDAKLANJUTI') e.belum++
    perSiswa.set(p.nis, e)
  }
  const berulang = [...perSiswa.entries()]
    .filter(([, e]) => e.jumlah >= BATAS_BERULANG)
    .map(([nis, e]) => ({
      nis,
      nama: infoSiswa.get(nis)?.nama ?? nis,
      kelas: infoSiswa.get(nis)?.kelas ?? '-',
      jumlah: e.jumlah,
      belum_ditindak: e.belum,
    }))
    .sort((a, b) => b.jumlah - a.jumlah || a.nama.localeCompare(b.nama, 'id'))

  // ── Nilai: siswa dengan mapel yang tidak lulus ──
  const tidakLulusPerSiswa = new Map<string, number>()
  for (const n of nilaiRes.data) {
    if (n.lulus === false && infoSiswa.has(n.nis)) {
      tidakLulusPerSiswa.set(n.nis, (tidakLulusPerSiswa.get(n.nis) ?? 0) + 1)
    }
  }
  const nilaiRendahDaftar = [...tidakLulusPerSiswa.entries()]
    .map(([nis, jumlahMapel]) => ({
      nis,
      nama: infoSiswa.get(nis)?.nama ?? nis,
      kelas: infoSiswa.get(nis)?.kelas ?? '-',
      jumlah_mapel_tidak_lulus: jumlahMapel,
    }))
    .sort((a, b) => b.jumlah_mapel_tidak_lulus - a.jumlah_mapel_tidak_lulus || a.nama.localeCompare(b.nama, 'id'))

  return NextResponse.json({
    ...base,
    pelanggaran: {
      mingguIni,
      bulanIni: pelanggaranBulan.data.length,
      belumDitindak: belumRes.count ?? 0,
    },
    batasBerulang: BATAS_BERULANG,
    berulang: berulang.slice(0, 10),
    jumlahBerulang: berulang.length,
    nilaiRendah: {
      jumlahSiswa: nilaiRendahDaftar.length,
      daftar: nilaiRendahDaftar.slice(0, 10),
    },
  })
}
