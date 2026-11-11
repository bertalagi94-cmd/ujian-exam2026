import { NextRequest, NextResponse } from 'next/server'
import { yayasanIdDari } from '@/lib/tenant'
import { requireRoleAktif } from '@/lib/status-akun'
import { getBkScope, PESAN_BK_BELUM_ADA_KELAS } from '@/lib/bk-scope'
import { hitungSiswaTidakUjian, ringkasTidakUjian } from '@/lib/bk-tidak-ujian'

export const dynamic = 'force-dynamic'

// GET /api/bk/tidak-ujian — HANYA BACA.
//   (tanpa parameter) -> daftar lengkap siswa tidak mengikuti ujian + ringkasan
//   ?ringkas=1        -> hanya angka ringkasan (untuk kartu di Dashboard BK)
// Cakupan dibatasi ke kelas binaan guru BK ini; aturan hitungnya ada di
// src/lib/bk-tidak-ujian.ts. Data diambil dari semua jadwal yang sesinya sudah
// dibuka (sedang berjalan atau sudah selesai).
export async function GET(req: NextRequest) {
  const auth = await requireRoleAktif(req, ['BK'])
  if ('error' in auth) return auth.error

  const yayasanId = yayasanIdDari(auth.user)
  const { searchParams } = new URL(req.url)
  const hanyaRingkas = searchParams.get('ringkas') === '1'

  try {
    const scope = await getBkScope(auth.user.username, yayasanId)
    if (scope.noScope) {
      return NextResponse.json({
        scopeWarning: PESAN_BK_BELUM_ADA_KELAS,
        data: [],
        ringkasan: ringkasTidakUjian([], 0),
      })
    }

    const { baris, ringkasan } = await hitungSiswaTidakUjian(yayasanId, scope.kelasList)
    if (hanyaRingkas) return NextResponse.json({ ringkasan })
    return NextResponse.json({ data: baris, ringkasan })
  } catch (e) {
    const pesan = e instanceof Error ? e.message : 'Gagal memuat daftar siswa tidak mengikuti ujian'
    return NextResponse.json({ error: pesan }, { status: 500 })
  }
}
