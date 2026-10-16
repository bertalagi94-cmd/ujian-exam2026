import { NextRequest, NextResponse } from 'next/server'
import { tenantDb, yayasanIdPublik } from '@/lib/tenant'

export const dynamic = 'force-dynamic'

// GET /api/public/layar-pantau-status
//
// Publik (dipakai form login Layar Pantau SEBELUM login) — hanya mengembalikan
// JUMLAH kelas yang sedang ujian, tanpa nama kelas/siswa/mapel, supaya aman
// tanpa autentikasi. Tanpa yayasan yang jelas (mode multi-yayasan tanpa Kode
// Sekolah) jawabannya `jumlahKelas: null` (fail-closed), bukan gabungan semua yayasan.
export async function GET(req: NextRequest) {
  const noStore = { 'Cache-Control': 'no-store' }
  try {
    const yys = await yayasanIdPublik(req)
    if (!yys) return NextResponse.json({ jumlahKelas: null }, { headers: noStore })

    const db = tenantDb(yys.id)
    const { data, error } = await db.from('sesi_ujian').select('kelas').eq('status', 'BERJALAN')
    if (error) return NextResponse.json({ jumlahKelas: null }, { headers: noStore })

    const kelas = new Set((data ?? []).map((r: { kelas: string | null }) => r.kelas).filter(Boolean))
    return NextResponse.json({ jumlahKelas: kelas.size }, { headers: noStore })
  } catch {
    return NextResponse.json({ jumlahKelas: null }, { headers: noStore })
  }
}
