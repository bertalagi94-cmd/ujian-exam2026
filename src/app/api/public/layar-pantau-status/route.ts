import { NextRequest, NextResponse } from 'next/server'
import { tenantDb, yayasanIdPublik } from '@/lib/tenant'
import { cachedFetch } from '@/lib/cache'

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

    // HEMAT VERCEL (10 Nov 2026, tahap 3): jumlah ini sama untuk semua pengunjung
    // satu yayasan, jadi di-cache 20 dtk per yayasan (per instance) alih-alih satu
    // query per polling per pengunjung. Hasil galat (null) tidak di-cache.
    const jumlah = await cachedFetch<number | null>(`layar-pantau-status:${yys.id}`, 20, async () => {
      const db = tenantDb(yys.id)
      const { data, error } = await db.from('sesi_ujian').select('kelas').eq('status', 'BERJALAN')
      if (error) return null
      const kelas = new Set((data ?? []).map((r: { kelas: string | null }) => r.kelas).filter(Boolean))
      return kelas.size
    })
    return NextResponse.json({ jumlahKelas: jumlah }, { headers: noStore })
  } catch {
    return NextResponse.json({ jumlahKelas: null }, { headers: noStore })
  }
}
