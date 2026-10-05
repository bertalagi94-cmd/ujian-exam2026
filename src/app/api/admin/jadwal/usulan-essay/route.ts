import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'

// GET /api/admin/jadwal/usulan-essay?mapel_id=...&kelas=...
//
// Dipakai form jadwal admin untuk menampilkan USULAN durasi essay dari guru
// untuk kombinasi mapel+kelas yang sedang dipilih (jadwal barunya belum
// tersimpan, jadi tidak bisa diambil dari daftar jadwal).
// Hanya membaca. Keputusan durasi tetap diisi admin di jadwal.essay_durasi_menit.
export async function GET(req: NextRequest) {
  const auth = requireRole(req, ['ADMIN'])
  if ('error' in auth) return auth.error

  const { searchParams } = new URL(req.url)
  const mapelId = searchParams.get('mapel_id')
  const kelasNama = searchParams.get('kelas')
  if (!mapelId || !kelasNama) {
    return NextResponse.json({ data: { ada: false, durasi: null, status: null } })
  }

  const db = createAdminClient()
  const { data: kelasRow } = await (db as any)
    .from('kelas')
    .select('id')
    .eq('nama', String(kelasNama))
    .maybeSingle()
  const kelasId = kelasRow?.id ?? String(kelasNama)

  const { data: paketList, error } = await (db as any)
    .from('paket_essay')
    .select('durasi_menit, status')
    .eq('mapel_id', mapelId)
    .eq('kelas_id', kelasId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const prioritas: Record<string, number> = { DISETUJUI: 4, MENUNGGU: 3, DRAFT: 2, DITOLAK: 1 }
  const terbaik = ((paketList ?? []) as { durasi_menit: number | null; status: string }[])
    .sort((a, b) => (prioritas[b.status] ?? 0) - (prioritas[a.status] ?? 0))[0]

  return NextResponse.json({
    data: {
      ada: !!terbaik,
      durasi: terbaik?.durasi_menit ?? null,
      status: terbaik?.status ?? null,
    },
  })
}
