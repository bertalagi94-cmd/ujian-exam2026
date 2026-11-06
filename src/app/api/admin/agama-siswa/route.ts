import { NextRequest, NextResponse } from 'next/server'
import { tenantDb, yayasanIdDari } from '@/lib/tenant'
import { requireRoleAktif } from '@/lib/status-akun'
import { ringkasanAgamaSiswa } from '@/lib/agama'

// Agama yang ada pada siswa aktif yayasan ini (beserta jumlahnya). Dipakai form
// Mata Pelajaran > Khusus Agama supaya pilihan agama berasal dari data siswa,
// bukan daftar yang dibuat sendiri.
export async function GET(req: NextRequest) {
  const auth = await requireRoleAktif(req, ['ADMIN'])
  if ('error' in auth) return auth.error

  const db = tenantDb(yayasanIdDari(auth.user))
  try {
    const data = await ringkasanAgamaSiswa(db)
    return NextResponse.json({ data })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Gagal membaca agama siswa' }, { status: 500 })
  }
}
