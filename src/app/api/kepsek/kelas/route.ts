import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'
import { getKepsekScope } from '@/lib/kepsek-scope'

// GET /api/kepsek/kelas
//
// FITUR BARU: Kepsek butuh lihat siapa wali kelas dari setiap kelas di
// jenjangnya, dan siapa saja siswa di kelas-kelas itu — sebagai informasi
// tambahan untuk pengawasan jenjang (di luar nilai/jadwal/monitoring yang
// sudah ada di endpoint lain).
//
// Sama seperti endpoint kepsek lain: dibatasi ke kelasScope (kelas-kelas di
// sekolah/jenjang yang ditugaskan ke akun Kepsek tersebut). ADMIN tidak
// dibatasi (kelasScope = null = semua kelas).
export async function GET(req: NextRequest) {
  const auth = requireRole(req, ['KEPSEK', 'ADMIN'])
  if ('error' in auth) return auth.error

  const db = createAdminClient()

  let kelasScope: string[] | null = null
  if (auth.user.role === 'KEPSEK') {
    const scope = await getKepsekScope(auth.user.username)
    if (scope.noScope) {
      return NextResponse.json({
        scopeWarning: 'Akun Kepsek Anda belum diset sekolah/jenjangnya oleh Admin. Hubungi Admin untuk mengatur ini di menu Data Pengguna.',
        data: [],
      })
    }
    kelasScope = scope.kelasList
    if (kelasScope.length === 0) {
      return NextResponse.json({ data: [] })
    }
  }

  // 1. Ambil baris kelas (id, nama, jurusan, wali_kelas) sesuai scope.
  //    Kolom `kelas.nama` adalah sumber nama kelas yang juga dipakai sebagai
  //    nilai TEXT di `siswa.kelas` — lihat catatan di kepsek-scope.ts.
  const kelasQuery = db.from('kelas').select('id, nama, jurusan, wali_kelas')
  const { data: kelasRows, error: kelasError } = kelasScope
    ? await kelasQuery.in('nama', kelasScope)
    : await kelasQuery

  if (kelasError) return NextResponse.json({ error: kelasError.message }, { status: 500 })

  if (!kelasRows || kelasRows.length === 0) {
    return NextResponse.json({ data: [] })
  }

  const kelasNamaList = kelasRows.map(k => k.nama)

  // 2. Ambil nama lengkap wali kelas dari username di kolom kelas.wali_kelas.
  //    `wali_kelas` BUKAN foreign key formal (lihat dokumentasi proyek),
  //    jadi join manual lewat lookup map seperti pola di admin/kelas/page.tsx.
  const waliUsernames = [...new Set(
    kelasRows.map(k => k.wali_kelas).filter((w): w is string => !!w)
  )]

  let waliMap: Record<string, string> = {}
  if (waliUsernames.length > 0) {
    const { data: waliUsers } = await db
      .from('users')
      .select('username, nama')
      .in('username', waliUsernames)
    waliMap = Object.fromEntries((waliUsers ?? []).map(u => [u.username, u.nama]))
  }

  // 3. Ambil siswa AKTIF (exclude tester) untuk semua kelas di scope ini,
  //    sekaligus — lalu di-group per kelas di server (hindari N query per kelas).
  const { data: siswaRows, error: siswaError } = await db
    .from('siswa')
    .select('nis, nama, kelas')
    .in('kelas', kelasNamaList)
    .eq('status', 'AKTIF')
    .neq('is_tester', 'YES')
    .order('nama')

  if (siswaError) return NextResponse.json({ error: siswaError.message }, { status: 500 })

  const siswaPerKelas: Record<string, { nis: string; nama: string }[]> = {}
  for (const s of siswaRows ?? []) {
    if (!siswaPerKelas[s.kelas]) siswaPerKelas[s.kelas] = []
    siswaPerKelas[s.kelas].push({ nis: s.nis, nama: s.nama })
  }

  // 4. Susun hasil akhir per kelas, urut alfanumerik (7A, 7B, 8A, ... bukan
  //    urut string biasa yang akan salah untuk angka 2 digit).
  const result = kelasRows
    .map(k => ({
      id: k.id,
      nama: k.nama,
      jurusan: k.jurusan ?? null,
      wali_kelas: k.wali_kelas ?? null,
      wali_kelas_nama: k.wali_kelas ? (waliMap[k.wali_kelas] ?? k.wali_kelas) : null,
      jumlah_siswa: siswaPerKelas[k.nama]?.length ?? 0,
      siswa: siswaPerKelas[k.nama] ?? [],
    }))
    .sort((a, b) => a.nama.localeCompare(b.nama, 'id', { numeric: true }))

  return NextResponse.json({ data: result })
}
