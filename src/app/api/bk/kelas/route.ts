import { NextRequest, NextResponse } from 'next/server'
import { tenantDb, yayasanIdDari } from '@/lib/tenant'
import { requireRoleAktif } from '@/lib/status-akun'
import { getBkScope, PESAN_BK_BELUM_ADA_KELAS } from '@/lib/bk-scope'
import { ambilSemuaBaris } from '@/lib/ambil-semua'

export const dynamic = 'force-dynamic'

// GET /api/bk/kelas — HANYA BACA.
// Kelas binaan guru BK ini, lengkap dengan wali kelas dan profil singkat siswa.
// Data yang dikirim sengaja minim: NISN, nama, jenis kelamin. Tidak ada
// kata sandi, perangkat, atau data pribadi lain.
export async function GET(req: NextRequest) {
  const auth = await requireRoleAktif(req, ['BK'])
  if ('error' in auth) return auth.error

  const yayasanId = yayasanIdDari(auth.user)
  const db = tenantDb(yayasanId)

  const scope = await getBkScope(auth.user.username, yayasanId)
  if (scope.noScope) {
    return NextResponse.json({ scopeWarning: PESAN_BK_BELUM_ADA_KELAS, data: [] })
  }

  const { data: kelasRows, error: kelasError } = await db
    .from('kelas')
    .select('id, nama, jurusan, wali_kelas')
    .in('id', scope.kelasIds)
  if (kelasError) return NextResponse.json({ error: kelasError.message }, { status: 500 })
  if (!kelasRows || kelasRows.length === 0) return NextResponse.json({ data: [] })

  const kelasNamaList = kelasRows.map((k: { nama: string }) => k.nama)

  // Nama lengkap wali kelas (kelas.wali_kelas berisi username, bukan foreign key formal).
  const waliUsernames = [...new Set(
    kelasRows.map((k: { wali_kelas: string | null }) => k.wali_kelas).filter((w: string | null): w is string => !!w)
  )] as string[]
  let waliMap: Record<string, string> = {}
  if (waliUsernames.length > 0) {
    const { data: waliUsers } = await db.from('users').select('username, nama').in('username', waliUsernames)
    waliMap = Object.fromEntries((waliUsers ?? []).map((u: { username: string; nama: string }) => [u.username, u.nama]))
  }

  const { data: siswaRows, error: siswaError } = await ambilSemuaBaris<{ nis: string; nama: string; kelas: string; jenis_kelamin: string | null }>((dari, sampai) =>
    db.from('siswa')
      .select('nis, nama, kelas, jenis_kelamin')
      .in('kelas', kelasNamaList)
      .eq('status', 'AKTIF')
      .neq('is_tester', 'YES')
      .order('nama', { ascending: true })
      .order('nis', { ascending: true })
      .range(dari, sampai)
  )
  if (siswaError) return NextResponse.json({ error: siswaError.message }, { status: 500 })

  const siswaPerKelas: Record<string, { nis: string; nama: string; jenis_kelamin: string | null }[]> = {}
  for (const s of siswaRows) {
    (siswaPerKelas[s.kelas] ??= []).push({ nis: s.nis, nama: s.nama, jenis_kelamin: s.jenis_kelamin ?? null })
  }

  const result = kelasRows
    .map((k: { id: string; nama: string; jurusan: string | null; wali_kelas: string | null }) => ({
      id: k.id,
      nama: k.nama,
      jurusan: k.jurusan ?? null,
      wali_kelas: k.wali_kelas ?? null,
      wali_kelas_nama: k.wali_kelas ? (waliMap[k.wali_kelas] ?? k.wali_kelas) : null,
      jumlah_siswa: siswaPerKelas[k.nama]?.length ?? 0,
      siswa: siswaPerKelas[k.nama] ?? [],
    }))
    .sort((a: { nama: string }, b: { nama: string }) => a.nama.localeCompare(b.nama, 'id', { numeric: true }))

  return NextResponse.json({ data: result })
}
