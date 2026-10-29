// app/api/admin/pengaturan/batas-soal/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { tenantDb, yayasanIdDari } from '@/lib/tenant'
import { requireRole } from '@/lib/auth'
import { cacheDelPrefix } from '@/lib/cache'
import {
  KUNCI_BATAS_MIN_SOAL,
  normNamaMapel,
  parseBatasMinSoal,
  validasiBatasMinSoal,
} from '@/lib/batas-soal'

/**
 * GET  -> { data: BatasMinSoal, mapel: string[] }  (mapel = nama unik untuk daftar centang)
 * PUT  -> simpan seluruh konfigurasi { aktif, pg:[{min,mapel[]}], essay:[...] }
 *
 * Hanya memengaruhi PENGIRIMAN paket berikutnya; paket yang sudah
 * MENUNGGU/DISETUJUI tidak disentuh, jadi aman diubah kapan saja
 * (tidak perlu menunggu sesi ujian selesai).
 */
export async function GET(req: NextRequest) {
  const auth = requireRole(req, ['ADMIN'])
  if ('error' in auth) return auth.error
  const db = tenantDb(yayasanIdDari(auth.user))

  const [{ data: p, error: e1 }, { data: m, error: e2 }] = await Promise.all([
    db.from('pengaturan').select('value').eq('key', KUNCI_BATAS_MIN_SOAL).maybeSingle(),
    db.from('mapel').select('nama'),
  ])
  if (e1 || e2) {
    return NextResponse.json({ error: (e1 ?? e2)!.message }, { status: 500 })
  }

  const unik = new Map<string, string>()
  for (const r of (m ?? []) as { nama: string | null }[]) {
    if (r.nama && !unik.has(normNamaMapel(r.nama))) unik.set(normNamaMapel(r.nama), r.nama.trim())
  }
  const mapel = [...unik.values()].sort((a, b) => a.localeCompare(b, 'id'))

  return NextResponse.json({ data: parseBatasMinSoal(p?.value), mapel })
}

export async function PUT(req: NextRequest) {
  const auth = requireRole(req, ['ADMIN'])
  if ('error' in auth) return auth.error
  const db = tenantDb(yayasanIdDari(auth.user))

  const body = await req.json().catch(() => null)
  const v = validasiBatasMinSoal(body)
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 })

  const { error } = await db
    .from('pengaturan')
    .upsert(
      [{ key: KUNCI_BATAS_MIN_SOAL, value: JSON.stringify(v.data), updated_at: new Date().toISOString() }],
      { onConflict: 'yayasan_id,key' }
    )
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  cacheDelPrefix('pengaturan:')
  return NextResponse.json({
    message: v.data.aktif ? 'Batas minimal soal disimpan dan aktif' : 'Batas minimal soal disimpan (nonaktif)',
    data: v.data,
  })
}
